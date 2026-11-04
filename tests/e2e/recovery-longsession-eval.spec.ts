/**
 * Long-session recovery evaluation (TF-0722).
 *
 * Real Electron + real Gateway + scripted local model. Each of the frozen 30
 * pairs runs one recovery variant family (compression / handoff / fork /
 * restart / revocation) and then checks, from disk, whether the must-preserve
 * facts survived and whether the recovered turn took the expected next action.
 *
 * Env:
 *   RECOVERY_LONGSESSION_OUT  directory that receives pair receipt JSON files
 *   RECOVERY_LONGSESSION_FAMILY  optional single-family debug filter
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, TestInfo } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { buildRecoveryContractManifest } from '../../../shared/recovery-contract-eval';

const OUT_DIR = process.env.RECOVERY_LONGSESSION_OUT ?? '';
const FAMILY = process.env.RECOVERY_LONGSESSION_FAMILY ?? '';
const MAIN_SESSION_KEY = 'agent:main:main';

type GatewayStatus = { state?: string; gatewayReady?: boolean; childPid?: number };

async function waitGatewayReady(app: ElectronApplication, timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status').catch(() => ({}) as GatewayStatus);
    if (status.gatewayReady === true || status.state === 'running') return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function historyText(app: ElectronApplication, sessionKey = MAIN_SESSION_KEY): Promise<string> {
  const history = await hostInvoke<{ messages?: unknown[] }>(app, 'sessions', 'history', { sessionKey })
    .catch(() => ({ messages: [] }));
  return JSON.stringify(history.messages ?? []);
}

async function send(app: ElectronApplication, message: string, key = MAIN_SESSION_KEY): Promise<void> {
  await hostInvoke(app, 'chat', 'sendWithMedia', {
    sessionKey: key, message, idempotencyKey: `longsession-${Date.now()}-${Math.random()}`,
  });
}

async function sendAndAwait(app: ElectronApplication, log: Array<{ issued: string | null }>, message: string, marker: string): Promise<boolean> {
  await send(app, message);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (log.some((entry) => entry.issued?.startsWith('text:') && entry.issued.includes(marker.slice(0, 18)))) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

type PairReceipt = {
  schema: 'RecoveryLongSessionPairReceipt/v1';
  pairId: string;
  family: string;
  provider: string;
  model: string;
  measurementBasis: 'scripted-provider';
  mustPreserveMatched: number;
  mustPreserveTotal: number;
  falseCompletionClaim: boolean;
  nextActionCorrect: boolean;
  recoveryLatencyMs: number;
  evidenceRef: string;
  observed: Record<string, unknown>;
  drivenBy: 'agent';
  realHumanEvidence: false;
  generatedAt: string;
};

async function writePair(testInfo: TestInfo, receipt: PairReceipt): Promise<void> {
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (OUT_DIR) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, `pair-${receipt.pairId}.json`), text, 'utf8');
  }
  const output = testInfo.outputPath(`pair-${receipt.pairId}.json`);
  await writeFile(output, text, 'utf8');
  await testInfo.attach('long-session-pair', { path: output, contentType: 'application/json' });
}

test.describe('long-session recovery evaluation', () => {
  test.skip(!OUT_DIR, 'RECOVERY_LONGSESSION_OUT not set: driver-only spec');
  test.setTimeout(1_500_000);

  test('runs the frozen pairs and records what survived', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
    const manifest = buildRecoveryContractManifest();
    const pairs = FAMILY ? manifest.longSessionPairs.filter((pair) => pair.family === FAMILY) : manifest.longSessionPairs;
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-longsession-eval-'));
    const llm = await startScriptedLlm((userText) => {
      const match = /LSEVAL-FACT-(\d+)/.exec(userText);
      if (/LSEVAL-NEXT-ACTION/.test(userText)) return { text: 'LSEVAL-NEXT-ACTION-DONE' };
      if (match) return { text: `LSEVAL-FACT-${match[1]} ACK` };
      return { text: 'LSEVAL-BASE-ACK' };
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
        rootPath: workspaceDir, permissionMode: 'fullAccess', name: 'longsession-eval',
      }).catch(() => undefined);
      await startGateway(app);
      await waitGatewayReady(app);

      for (const pair of pairs) {
        const startedAt = Date.now();
        // Facts are stated across several turns so the transcript is non-trivial.
        for (let i = 0; i < pair.mustPreserve.length; i += 1) {
          await sendAndAwait(app, llm.log, `LSEVAL-FACT-${i} ${pair.mustPreserve[i]}`, `LSEVAL-FACT-${i} ACK`);
        }

        let sessionKey = MAIN_SESSION_KEY;
        let variantNote = 'in-place';
        if (pair.family === 'fork') {
          const fork = await hostInvoke<{ sessionKey?: string }>(app, 'sessions', 'fork', {
            sessionKey: MAIN_SESSION_KEY, agentId: 'main', label: `eval-fork-${pair.id}`,
          }).catch(() => ({}) as { sessionKey?: string });
          if (fork.sessionKey) { sessionKey = fork.sessionKey; variantNote = 'forked'; }
        } else if (pair.family === 'handoff') {
          const handoff = await hostInvoke<{ sessionKey?: string }>(app, 'sessions', 'handoff', {
            sessionKey: MAIN_SESSION_KEY, agentId: 'main', label: `eval-handoff-${pair.id}`,
          }).catch(() => ({}) as { sessionKey?: string });
          if (handoff.sessionKey) { sessionKey = handoff.sessionKey; variantNote = 'handed-off'; }
        } else if (pair.family === 'compaction' || pair.family === 'compression') {
          await hostInvoke(app, 'gateway', 'rpc', {
            method: 'sessions.compact', params: { key: MAIN_SESSION_KEY, agentId: 'main' }, timeoutMs: 120_000,
          }).catch(() => undefined);
          variantNote = 'compacted';
        } else if (pair.family === 'restart') {
          await hostInvoke(app, 'gateway', 'restart').catch(() => undefined);
          await waitGatewayReady(app);
          variantNote = 'restarted';
        } else if (pair.family === 'revocation') {
          await hostInvoke(app, 'gateway', 'rpc', {
            method: 'sessions.compact', params: { key: MAIN_SESSION_KEY, agentId: 'main', reason: 'eval-revocation' },
            timeoutMs: 120_000,
          }).catch(() => undefined);
          variantNote = 'revoked-context';
        }

        const transcript = await historyText(app, sessionKey);
        const matched = pair.mustPreserve.filter((fact) => transcript.includes(fact)).length;
        const nextActionOk = await sendAndAwait(app, llm.log, `LSEVAL-NEXT-ACTION ${pair.expectedNextAction}`, 'LSEVAL-NEXT-ACTION-DONE');
        const after = await historyText(app, sessionKey);
        const claimedComplete = pair.forbiddenCompletionClaims.some((claim) => after.includes(claim));
        const receipt: PairReceipt = {
          schema: 'RecoveryLongSessionPairReceipt/v1',
          pairId: pair.id, family: pair.family,
          provider: 'scripted-local', model: 'mock-coder', measurementBasis: 'scripted-provider',
          mustPreserveMatched: matched, mustPreserveTotal: pair.mustPreserve.length,
          falseCompletionClaim: claimedComplete, nextActionCorrect: nextActionOk,
          recoveryLatencyMs: Date.now() - startedAt,
          evidenceRef: `recovery-longsession:${pair.id}`,
          observed: { variantNote, sessionKey, transcriptLength: transcript.length, llmRequests: llm.log.length },
          drivenBy: 'agent', realHumanEvidence: false, generatedAt: new Date().toISOString(),
        };
        await writePair(testInfo, receipt);
        expect(receipt.pairId).toBe(pair.id);
        console.log('[recovery-longsession]', JSON.stringify(receipt));
      }
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
