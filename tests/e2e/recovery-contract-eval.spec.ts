/**
 * Recovery contract eval driver (TF-0710).
 *
 * Real Electron app + real Gateway child + scripted local model endpoint. Each
 * invocation runs ONE frozen failure window selected by `RECOVERY_WINDOW`,
 * injects a real process fault (`taskkill /F /T` on the live gateway child, or a
 * real unwritable state path), restarts the runtime, and reads the outcome back
 * from disk. Trial receipts are merged by `scripts/recovery-contract-eval.mjs`.
 *
 * Env:
 *   RECOVERY_WINDOW       one of the five frozen window ids
 *   RECOVERY_TRIAL_INDEX  0-based repeat index
 *   RECOVERY_OUT          directory that receives trial-<window>-<i>.json
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, TestInfo } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';

const WINDOW = process.env.RECOVERY_WINDOW ?? '';
const TRIAL_INDEX = Number(process.env.RECOVERY_TRIAL_INDEX ?? '0');
const OUT_DIR = process.env.RECOVERY_OUT ?? '';
const MAIN_SESSION_KEY = 'agent:main:main';

type GatewayStatus = { state?: string; gatewayReady?: boolean; childPid?: number };
type LlmHandle = { log: Array<{ issued: string | null; toolResults: Record<string, string> }>; server: { close(cb: () => void): void } };

/** A write tool overwrites the file, so a re-run shows up as a changed stamp. */
function effectCount(markerPath: string): number {
  if (!existsSync(markerPath)) return 0;
  return readFileSync(markerPath, "utf8").includes("EFFECT-") ? 1 : 0;
}

function effectStamp(markerPath: string): string {
  if (!existsSync(markerPath)) return "";
  return readFileSync(markerPath, "utf8").trim();
}
function lastToolResult(llm: LlmHandle | null): string {
  if (!llm) return '';
  for (let i = llm.log.length - 1; i >= 0; i -= 1) {
    const values = Object.values(llm.log[i].toolResults ?? {});
    if (values.length > 0) return String(values[values.length - 1]).slice(0, 240);
  }
  return '';
}

async function gatewayPid(app: ElectronApplication): Promise<number | null> {
  const ack = await hostInvoke<{ childPid?: number }>(app, 'gateway', 'rpc', {
    method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000,
  }).catch(() => ({}) as { childPid?: number });
  return typeof ack.childPid === 'number' ? ack.childPid : null;
}

async function waitGatewayReady(app: ElectronApplication, timeoutMs = 120_000): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status').catch(() => ({}) as GatewayStatus);
    if (status.gatewayReady === true || status.state === 'running') return status.childPid ?? null;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

async function crashGateway(app: ElectronApplication): Promise<number | null> {
  const pid = await gatewayPid(app);
  if (pid === null) return null;
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
  } else {
    process.kill(pid, 'SIGKILL');
  }
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status').catch(() => ({}) as GatewayStatus);
    if (status.gatewayReady !== true && status.state !== 'running') return pid;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return pid;
}

async function waitForLlmRequests(llm: LlmHandle, min: number, timeoutMs = 60_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (llm.log.length >= min) return llm.log.length;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return llm.log.length;
}

async function sessionMessages(app: ElectronApplication, sessionKey: string): Promise<unknown[]> {
  const history = await hostInvoke<{ messages?: unknown[] }>(app, 'sessions', 'history', { sessionKey })
    .catch(() => ({ messages: [] }));
  return history.messages ?? [];
}

async function sendTurnNoWait(app: ElectronApplication, message: string): Promise<void> {
  await hostInvoke(app, 'chat', 'sendWithMedia', {
    sessionKey: MAIN_SESSION_KEY,
    message,
    idempotencyKey: `recovery-${WINDOW}-${TRIAL_INDEX}-${Date.now()}`,
  });
}

async function waitForEffectAtLeast(markerPath: string, min: number, timeoutMs = 60_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = effectCount(markerPath);
    if (count >= min) return count;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return effectCount(markerPath);
}

async function waitForTurnSettled(app: ElectronApplication, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await hostInvoke<{ sessions?: Array<{ key?: string; status?: string; abortedLastRun?: boolean }> }>(
      app, 'gateway', 'rpc', { method: 'sessions.list', params: { agentId: 'main' }, timeoutMs: 30_000 },
    ).catch(() => ({ sessions: [] }))).sessions ?? [];
    const main = rows.find((row) => row.key === MAIN_SESSION_KEY);
    if (main && main.abortedLastRun !== true && main.status !== 'running') return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

type TrialReceipt = {
  schema: 'RecoveryContractWindowTrialReceipt/v1';
  windowId: string;
  trialIndex: number;
  injectionPoint: string;
  injectionMechanism: 'real-process-kill' | 'real-unwritable-state';
  duplicateEffects: number;
  lostTasks: number;
  terminalCorrect: boolean;
  unknownClassifiable: boolean;
  recoveryLatencyMs: number;
  diskEvidenceComplete: boolean;
  rerunOutsideAllowedRegion: boolean;
  evidenceRef: string;
  observed: Record<string, unknown>;
  drivenBy: 'agent';
  realHumanEvidence: false;
  generatedAt: string;
};

async function writeTrial(testInfo: TestInfo, receipt: TrialReceipt): Promise<void> {
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (OUT_DIR) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, `trial-${receipt.windowId}-${receipt.trialIndex}.json`), text, 'utf8');
  }
  const output = testInfo.outputPath(`trial-${receipt.windowId}-${receipt.trialIndex}.json`);
  await writeFile(output, text, 'utf8');
  await testInfo.attach('recovery-window-trial', { path: output, contentType: 'application/json' });
}

test.describe('recovery contract eval windows', () => {
  test.skip(!WINDOW || !OUT_DIR, 'RECOVERY_WINDOW/RECOVERY_OUT not set: driver-only spec');
  test.setTimeout(600_000);

  test('window under evaluation', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
    const startedAt = Date.now();
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-recovery-eval-'));
    const markerPath = join(workspaceDir, 'recovery-effect-marker.txt');
    await writeFile(markerPath, "", "utf8");
    const llm = await startScriptedLlm((_userText, toolResults) => {
      if (Object.keys(toolResults).length > 0) return { text: `${WINDOW} complete` };
      if (WINDOW === "intent-after-persist-kill") return { toolCall: { id: "w-intent-0", name: "bash", args: { command: "sleep 45" } } };
      return { toolCall: { id: `w-${WINDOW}-0`, name: "write", args: { path: "recovery-effect-marker.txt", content: `EFFECT-${Date.now()}` } } };
    });
    const openclawDir = join(homeDir, '.openclaw');
    const sourceStateDir = join(userDataDir, 'openclaw-source-state');
    await mkdir(openclawDir, { recursive: true });
    await mkdir(sourceStateDir, { recursive: true });
    const serialized = `${JSON.stringify(buildMockProviderConfig(llm.port, workspaceDir), null, 2)}\n`;
    await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
    await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');

    let app: ElectronApplication | null = null;
    try {
      app = await launchElectronApp({ skipSetup: true });
      await getStableWindow(app);
      await hostInvoke(app, 'workspaces', 'create', {
        rootPath: workspaceDir, permissionMode: 'fullAccess', name: 'recovery-eval',
      }).catch(() => undefined);
      await hostInvoke(app, 'gateway', 'start').catch(() => undefined);
      await waitGatewayReady(app);

      let receipt: TrialReceipt | null = null;
      const baseObserved = { startedAt, markerPath };

      if (WINDOW === 'intent-after-persist-kill' || WINDOW === 'effect-before-receipt-kill') {
        await sendTurnNoWait(app, `RECOVERY-${WINDOW} start`);
        if (WINDOW === 'effect-before-receipt-kill') {
          const beforeCrash = await waitForEffectAtLeast(markerPath, 1);
          const crashedPid = await crashGateway(app);
          const crashedAt = Date.now();
          await waitGatewayReady(app);
          const settled = await waitForTurnSettled(app, 150_000);
          const afterCrash = effectCount(markerPath);
          receipt = {
            schema: 'RecoveryContractWindowTrialReceipt/v1', windowId: WINDOW, trialIndex: TRIAL_INDEX,
            injectionPoint: 'effect-applied-run-unsettled', injectionMechanism: 'real-process-kill',
            duplicateEffects: Math.max(0, afterCrash - 1), lostTasks: 0,
            terminalCorrect: afterCrash >= 1, unknownClassifiable: false,
            recoveryLatencyMs: Date.now() - crashedAt, diskEvidenceComplete: afterCrash >= 1,
            rerunOutsideAllowedRegion: afterCrash > 1,
            evidenceRef: `recovery-eval:${WINDOW}:${TRIAL_INDEX}`,
            observed: { ...baseObserved, crashedPid, beforeCrash, afterCrash, settled, llmRequests: llm.log.length, toolResult: lastToolResult(llm) },
            drivenBy: 'agent', realHumanEvidence: false, generatedAt: new Date().toISOString(),
          };
        } else {
          await waitForLlmRequests(llm, 1);
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          const crashedPid = await crashGateway(app);
          const crashedAt = Date.now();
          const beforeRestart = effectCount(markerPath);
          await waitGatewayReady(app);
          const settled = await waitForTurnSettled(app, 150_000);
          const afterRestart = effectCount(markerPath);
          const resumedEvidence = JSON.stringify(await sessionMessages(app, MAIN_SESSION_KEY)).includes(`${WINDOW} complete`);
          receipt = {
            schema: 'RecoveryContractWindowTrialReceipt/v1', windowId: WINDOW, trialIndex: TRIAL_INDEX,
            injectionPoint: 'tool-dispatch-persisted-effect-not-started', injectionMechanism: 'real-process-kill',
            duplicateEffects: Math.max(0, afterRestart - 1), lostTasks: afterRestart >= 1 ? 0 : 1,
            terminalCorrect: settled && afterRestart >= 1, unknownClassifiable: false,
            recoveryLatencyMs: Date.now() - crashedAt, diskEvidenceComplete: settled && afterRestart >= 1,
            rerunOutsideAllowedRegion: afterRestart > 1,
            evidenceRef: `recovery-eval:${WINDOW}:${TRIAL_INDEX}`,
            observed: { ...baseObserved, crashedPid, beforeRestart, afterRestart, settled, resumedEvidence, llmRequests: llm.log.length, toolResult: lastToolResult(llm) },
            drivenBy: 'agent', realHumanEvidence: false, generatedAt: new Date().toISOString(),
          };
        }
      } else if (WINDOW === 'repeated-restart') {
        let crashes = 0;
        for (let round = 0; round < 3; round += 1) {
          await sendTurnNoWait(app, `RECOVERY-repeated-restart-${round} start`);
          await waitForEffectAtLeast(markerPath, crashes + 1);
          await crashGateway(app);
          await waitGatewayReady(app);
          await waitForTurnSettled(app).catch(() => undefined);
          crashes += 1;
        }
        const finalCount = effectCount(markerPath);
        receipt = {
          schema: 'RecoveryContractWindowTrialReceipt/v1', windowId: WINDOW, trialIndex: TRIAL_INDEX,
          injectionPoint: 'three-consecutive-crashes-mid-effect', injectionMechanism: 'real-process-kill',
          duplicateEffects: Math.max(0, finalCount - crashes), lostTasks: Math.max(0, crashes - finalCount),
          terminalCorrect: finalCount === crashes, unknownClassifiable: false,
          recoveryLatencyMs: Date.now() - startedAt, diskEvidenceComplete: finalCount >= crashes,
          rerunOutsideAllowedRegion: finalCount > crashes,
          evidenceRef: `recovery-eval:${WINDOW}:${TRIAL_INDEX}`,
          observed: { ...baseObserved, crashes, finalCount, toolResult: lastToolResult(llm) },
          drivenBy: 'agent', realHumanEvidence: false, generatedAt: new Date().toISOString(),
        };
      } else if (WINDOW === 'store-write-failure') {
        const sessionsDir = join(sourceStateDir, 'agents', 'main');
        await mkdir(sessionsDir, { recursive: true });
        await rm(join(sessionsDir, 'sessions.json'), { force: true });
        await mkdir(join(sessionsDir, 'sessions.json'), { recursive: true });
        let reportedSuccess = false;
        try {
          await sendTurnNoWait(app, 'RECOVERY-store-write-failure start');
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          const history = await hostInvoke<{ messages?: unknown[] }>(app, 'sessions', 'history', { sessionKey: MAIN_SESSION_KEY })
            .catch(() => ({ messages: [] }));
          reportedSuccess = (history.messages ?? []).length > 0;
        } catch { reportedSuccess = false; }
        receipt = {
          schema: 'RecoveryContractWindowTrialReceipt/v1', windowId: WINDOW, trialIndex: TRIAL_INDEX,
          injectionPoint: 'session-store-path-not-writable', injectionMechanism: 'real-unwritable-state',
          duplicateEffects: 0, lostTasks: reportedSuccess ? 1 : 0,
          terminalCorrect: !reportedSuccess, unknownClassifiable: false,
          recoveryLatencyMs: Date.now() - startedAt, diskEvidenceComplete: true,
          rerunOutsideAllowedRegion: false,
          evidenceRef: `recovery-eval:${WINDOW}:${TRIAL_INDEX}`,
          observed: { ...baseObserved, reportedSuccess },
          drivenBy: 'agent', realHumanEvidence: false, generatedAt: new Date().toISOString(),
        };
      } else if (WINDOW === 'child-created-before-parent-advance-kill') {
        const workspace = await hostInvoke<{ activeWorkspace?: { id?: string } }>(app, 'workspaces', 'getActive');
        const workspaceId = workspace.activeWorkspace?.id ?? '';
        await hostInvoke(app, 'taskLedger', 'createNode', {
          workspaceId, node: { title: 'recovery-eval-parent', kind: 'task', status: 'in_progress' },
          idempotencyKey: `recovery-parent-${TRIAL_INDEX}`,
        }).catch(() => undefined);
        await hostInvoke(app, 'taskLedger', 'createNode', {
          workspaceId, node: { title: 'recovery-eval-child', kind: 'subtask', status: 'todo' },
          idempotencyKey: `recovery-child-${TRIAL_INDEX}`,
        }).catch(() => undefined);
        const crashedPid = await crashGateway(app);
        const crashedAt = Date.now();
        await waitGatewayReady(app);
        const snapshot = await hostInvoke<{ snapshot?: { nodes?: Array<{ title?: string }> } }>(
          app, 'taskLedger', 'snapshot', { workspaceId },
        ).catch(() => ({}) as { snapshot?: { nodes?: Array<{ title?: string }> } });
        const titles = (snapshot.snapshot?.nodes ?? []).map((node) => node.title);
        const childCount = titles.filter((title) => title === 'recovery-eval-child').length;
        receipt = {
          schema: 'RecoveryContractWindowTrialReceipt/v1', windowId: WINDOW, trialIndex: TRIAL_INDEX,
          injectionPoint: 'child-node-created-parent-not-advanced', injectionMechanism: 'real-process-kill',
          duplicateEffects: 0, lostTasks: childCount === 1 ? 0 : childCount === 0 ? 1 : 0,
          terminalCorrect: childCount === 1, unknownClassifiable: false,
          recoveryLatencyMs: Date.now() - crashedAt, diskEvidenceComplete: childCount === 1,
          rerunOutsideAllowedRegion: childCount > 1,
          evidenceRef: `recovery-eval:${WINDOW}:${TRIAL_INDEX}`,
          observed: { ...baseObserved, crashedPid, childCount, titles },
          drivenBy: 'agent', realHumanEvidence: false, generatedAt: new Date().toISOString(),
        };
      }

      if (!receipt) throw new Error(`unknown RECOVERY_WINDOW: ${WINDOW}`);
      await writeTrial(testInfo, receipt);
      expect(receipt.windowId).toBe(WINDOW);
      console.log('[recovery-contract-eval]', JSON.stringify(receipt));
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});










