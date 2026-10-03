/**
 * FP-P1-05 G3: restart/recovery/live-kill/rollback against a real Electron app,
 * real gateway children, real agent tools, and a local HTTP model endpoint.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import {
  buildMockProviderConfig,
  hostInvoke,
  sendTurn,
  startGateway,
  startScriptedLlm,
  type LlmRequestLog,
} from './fixtures/fp-p1-harness';

const ORIGINAL = 'export const recovery = "before";\n';
const AFTER_GATEWAY_RESTART = 'export const recovery = "after-gateway-restart";\n';
const AFTER_APP_RESTART = 'export const recovery = "after-app-restart";\n';

type Ack = {
  childPid?: number;
  gatewayGeneration?: string;
  effectiveFlags?: Record<string, unknown>;
  turnEffectProbe?: { wouldChangeTurn?: boolean; killSwitchEngaged?: boolean };
  flagAttribution?: Record<string, { origin?: string }>;
};

type SessionRow = {
  key?: string;
  sessionId?: string;
  status?: string;
  abortedLastRun?: boolean;
};

function sanitizeCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}

function hasResult(results: Record<string, string>, callId: string): boolean {
  const wanted = sanitizeCallId(callId);
  return Object.keys(results).some((key) => key === wanted || new RegExp(`^${wanted}\\d+$`).test(key));
}

function toolResultFor(log: LlmRequestLog[], callId: string): string {
  const wanted = sanitizeCallId(callId);
  for (const entry of log) {
    const key = Object.keys(entry.toolResults)
      .find((candidate) => candidate === wanted || new RegExp(`^${wanted}\\d+$`).test(candidate));
    if (key) return entry.toolResults[key] ?? '';
  }
  return '';
}

function latestMarker(userText: string): string | null {
  const markers = [
    'WRITE-BEFORE-GATEWAY-RESTART',
    'CONTINUE-AFTER-GATEWAY-RESTART',
    'UNDO-AFTER-KILL',
    'WRITE-BEFORE-APP-RESTART',
    'UNDO-AFTER-APP-RESTART',
  ];
  return markers.reduce<{ marker: string | null; at: number }>((best, marker) => {
    const at = userText.lastIndexOf(marker);
    return at > best.at ? { marker, at } : best;
  }, { marker: null, at: -1 }).marker;
}

function nextModelAction(userText: string, results: Record<string, string>) {
  switch (latestMarker(userText)) {
    case 'WRITE-BEFORE-GATEWAY-RESTART':
      if (!hasResult(results, 'p105-read-1')) {
        return { toolCall: { id: 'p105-read-1', name: 'read', args: { path: 'recovery.ts' } } };
      }
      if (!hasResult(results, 'p105-edit-1')) {
        return {
          toolCall: {
            id: 'p105-edit-1',
            name: 'edit',
            args: {
              path: 'recovery.ts',
              edits: [{ oldText: ORIGINAL.trimEnd(), newText: AFTER_GATEWAY_RESTART.trimEnd() }],
            },
          },
        };
      }
      return { text: 'WRITE-BEFORE-GATEWAY-RESTART complete' };
    case 'CONTINUE-AFTER-GATEWAY-RESTART':
      if (!hasResult(results, 'p105-read-2')) {
        return { toolCall: { id: 'p105-read-2', name: 'read', args: { path: 'recovery.ts' } } };
      }
      return { text: 'CONTINUE-AFTER-GATEWAY-RESTART complete' };
    case 'UNDO-AFTER-KILL':
      if (!hasResult(results, 'p105-undo-1')) {
        return { toolCall: { id: 'p105-undo-1', name: 'undo_write', args: { steps: 1 } } };
      }
      return { text: 'UNDO-AFTER-KILL complete' };
    case 'WRITE-BEFORE-APP-RESTART':
      if (!hasResult(results, 'p105-edit-2')) {
        return {
          toolCall: {
            id: 'p105-edit-2',
            name: 'edit',
            args: {
              path: 'recovery.ts',
              edits: [{ oldText: ORIGINAL.trimEnd(), newText: AFTER_APP_RESTART.trimEnd() }],
            },
          },
        };
      }
      return { text: 'WRITE-BEFORE-APP-RESTART complete' };
    case 'UNDO-AFTER-APP-RESTART':
      if (!hasResult(results, 'p105-undo-2')) {
        return { toolCall: { id: 'p105-undo-2', name: 'undo_write', args: { steps: 1 } } };
      }
      return { text: 'UNDO-AFTER-APP-RESTART complete' };
    default:
      return { text: 'No FP-P1-05 action requested.' };
  }
}

async function writeConfig(
  openclawDir: string,
  sourceStateDir: string,
  config: Record<string, unknown>,
): Promise<void> {
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  await mkdir(openclawDir, { recursive: true });
  await mkdir(sourceStateDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
  await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');
}

async function readAck(app: ElectronApplication, timeoutMs = 120_000): Promise<Ack> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never answered';
  while (Date.now() < deadline) {
    try {
      return await hostInvoke<Ack>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000,
      });
    } catch (error) {
      lastError = String(error);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(`ack never returned: ${lastError}`);
}

async function restartAndAwaitNewChild(
  app: ElectronApplication,
  previousPid: number | undefined,
  timeoutMs = 180_000,
): Promise<Ack> {
  await hostInvoke<{ success: boolean }>(app, 'gateway', 'restart');
  const deadline = Date.now() + timeoutMs;
  let last: Ack | null = null;
  while (Date.now() < deadline) {
    try {
      last = await readAck(app, 35_000);
      if (typeof last.childPid === 'number' && last.childPid !== previousPid) return last;
    } catch {
      // The real child is between stop and ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`gateway never produced a new child: ${JSON.stringify({ previousPid, last })}`);
}

async function listMainSessions(app: ElectronApplication): Promise<SessionRow[]> {
  const result = await hostInvoke<{ sessions?: SessionRow[] }>(app, 'gateway', 'rpc', {
    method: 'sessions.list', params: { agentId: 'main' }, timeoutMs: 60_000,
  });
  return result.sessions ?? [];
}

async function waitForMainLayout(app: ElectronApplication): Promise<void> {
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
}

test.describe('FP-P1-05 restart / recovery / live kill / rollback', () => {
  test('resumes a persisted in-flight assistant turn after Gateway startup', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(300_000);
    const recoveryMarker = 'IN-FLIGHT-RESTART-RECOVERY complete';
    const llm = await startScriptedLlm((userText) => ({
      text: userText.includes('Your previous turn was interrupted by a gateway restart')
        ? recoveryMarker
        : 'Unexpected recovery prompt.',
    }));
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-restart-inflight-'));
    const openclawDir = join(homeDir, '.openclaw');
    const sourceStateDir = join(userDataDir, 'openclaw-source-state');
    const sessionsDir = join(sourceStateDir, 'agents', 'main', 'sessions');
    const sessionId = 'restart-inflight-session';
    const sessionFile = `${sessionId}.jsonl`;
    const now = Date.now();

    await writeConfig(
      openclawDir,
      sourceStateDir,
      buildMockProviderConfig(llm.port, workspaceDir),
    );
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'sessions.json'), `${JSON.stringify({
      'agent:main:main': {
        sessionId,
        sessionFile,
        status: 'running',
        abortedLastRun: true,
        startedAt: now - 1_000,
        updatedAt: now,
        modelProvider: 'openai',
        model: 'mock-coder',
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(sessionsDir, sessionFile), [
      JSON.stringify({
        type: 'session', version: 3, id: sessionId,
        timestamp: new Date(now - 2_000).toISOString(), cwd: workspaceDir,
      }),
      JSON.stringify({
        type: 'message', id: 'restart-user', parentId: null,
        timestamp: new Date(now - 1_500).toISOString(),
        message: {
          role: 'user', content: [{ type: 'text', text: 'Finish the interrupted task.' }],
          timestamp: now - 1_500,
        },
      }),
      JSON.stringify({
        type: 'message', id: 'restart-assistant', parentId: 'restart-user',
        timestamp: new Date(now - 1_000).toISOString(),
        message: {
          role: 'assistant', content: [{ type: 'text', text: 'Work in progress.' }],
          api: 'openai-completions', provider: 'openai', model: 'mock-coder',
          stopReason: 'aborted', timestamp: now - 1_000,
        },
      }),
      '',
    ].join('\n'), 'utf8');

    const app: ElectronApplication | null = await launchElectronApp({ skipSetup: true });
    try {
      await waitForMainLayout(app);
      await startGateway(app);

      const deadline = Date.now() + 120_000;
      let recoveredSession: SessionRow | undefined;
      let transcript = '';
      while (Date.now() < deadline) {
        recoveredSession = (await listMainSessions(app))
          .find((session) => session.key === 'agent:main:main');
        transcript = await readFile(join(sessionsDir, sessionFile), 'utf8');
        if (recoveredSession?.abortedLastRun === false && transcript.includes(recoveryMarker)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }

      expect(recoveredSession?.sessionId).toBe(sessionId);
      expect(recoveredSession?.abortedLastRun).toBe(false);
      expect(transcript).toContain(recoveryMarker);
      expect(llm.log.filter((entry) => entry.issued === `text:${recoveryMarker}`).length).toBe(1);
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('all seven live recovery scenarios remain explainable and fail closed', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(1_800_000);
    const llm = await startScriptedLlm(nextModelAction);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p1-05-'));
    const openclawDir = join(homeDir, '.openclaw');
    const sourceStateDir = join(userDataDir, 'openclaw-source-state');
    const sourceConfigPath = join(sourceStateDir, 'openclaw.json');
    const settingsPath = join(userDataDir, 'settings.json');
    const versionStatePath = join(userDataDir, 'app-version-state.json');
    await writeFile(join(workspaceDir, 'recovery.ts'), ORIGINAL, 'utf8');

    const enhancedConfig = buildMockProviderConfig(llm.port, workspaceDir, {
      contextBlock: {
        'working-memory': { enabled: true },
        'tool-registry': { enabled: true },
      },
      coding: { staleWriteGuard: { enabled: true } },
    });
    const baselineConfig = buildMockProviderConfig(llm.port, workspaceDir, {
      contextBlock: {
        'working-memory': { enabled: false },
        'tool-registry': { enabled: false },
      },
      coding: { staleWriteGuard: { enabled: false } },
    });
    await writeConfig(openclawDir, sourceStateDir, enhancedConfig);

    let app: ElectronApplication | null = await launchElectronApp({ skipSetup: true });
    try {
      await waitForMainLayout(app);
      await startGateway(app);
      const before = await readAck(app);
      expect(before.effectiveFlags?.['runtime.contextBlock.working_memory.enabled']).toBe(true);
      expect(before.turnEffectProbe?.wouldChangeTurn).toBe(true);

      // S1/S2: real edit creates the journal, then a new child continues the same session.
      await sendTurn(
        app, llm.log, 'WRITE-BEFORE-GATEWAY-RESTART recovery.ts',
        'WRITE-BEFORE-GATEWAY-RESTART complete',
      );
      expect(await readFile(join(workspaceDir, 'recovery.ts'), 'utf8')).toBe(AFTER_GATEWAY_RESTART);
      const journalRoot = join(workspaceDir, '.openclaw', 'journal');
      const journalSessions = await readdir(journalRoot);
      expect(journalSessions.length).toBeGreaterThan(0);
      const journalDir = join(journalRoot, journalSessions[0]!);
      const firstMetaName = (await readdir(journalDir)).find((name) => name.endsWith('.meta.json'));
      expect(firstMetaName).toBeTruthy();
      const firstMeta = JSON.parse(await readFile(join(journalDir, firstMetaName!), 'utf8')) as {
        lineage?: { sessionId?: string; gatewayGeneration?: string; requestId?: string };
      };
      expect(firstMeta.lineage?.gatewayGeneration).toBe(before.gatewayGeneration);
      expect(firstMeta.lineage?.requestId).toBeTruthy();

      const sessionBeforeRestart = (await listMainSessions(app))
        .find((session) => session.key === 'agent:main:main');
      const afterGatewayRestart = await restartAndAwaitNewChild(app, before.childPid);
      expect(afterGatewayRestart.childPid).not.toBe(before.childPid);
      expect(afterGatewayRestart.gatewayGeneration).not.toBe(before.gatewayGeneration);
      await sendTurn(
        app, llm.log, 'CONTINUE-AFTER-GATEWAY-RESTART read recovery.ts',
        'CONTINUE-AFTER-GATEWAY-RESTART complete',
      );
      expect(toolResultFor(llm.log, 'p105-read-2')).toContain('after-gateway-restart');

      // S3: config kill applies no later than the next child ack, before another turn.
      const killStartedAt = Date.now();
      await writeConfig(openclawDir, sourceStateDir, {
        ...enhancedConfig,
        runtime: {
          ...(enhancedConfig.runtime as Record<string, unknown>),
          contextEnhancement: { killSwitch: true },
        },
      });
      const killed = await restartAndAwaitNewChild(app, afterGatewayRestart.childPid);
      const killAppliedMs = Date.now() - killStartedAt;
      expect(killAppliedMs).toBeLessThanOrEqual(180_000);
      expect(killed.effectiveFlags?.['runtime.contextEnhancement.killSwitch']).toBe(true);
      expect(killed.effectiveFlags?.['runtime.contextBlock.working_memory.enabled']).toBe(false);
      expect(killed.effectiveFlags?.['runtime.contextBlock.tool_registry.enabled']).toBe(false);
      expect(killed.turnEffectProbe?.wouldChangeTurn).toBe(false);
      expect(killed.turnEffectProbe?.killSwitchEngaged).toBe(true);
      expect(killed.flagAttribution?.['runtime.contextBlock.working_memory.enabled']?.origin).toBe('kill');

      // S4: undo_write is a real tool call after kill, not a disk-only assertion.
      await sendTurn(app, llm.log, 'UNDO-AFTER-KILL the last edit', 'UNDO-AFTER-KILL complete');
      expect(await readFile(join(workspaceDir, 'recovery.ts'), 'utf8')).toBe(ORIGINAL);
      expect(toolResultFor(llm.log, 'p105-undo-1').replace(/\s+/g, '')).toContain('"ok":true');

      // S5: flag-off rollback returns to conservative baseline parity.
      await writeConfig(openclawDir, sourceStateDir, baselineConfig);
      const rolledBack = await restartAndAwaitNewChild(app, killed.childPid);
      expect(rolledBack.effectiveFlags?.['runtime.contextEnhancement.killSwitch']).toBe(false);
      expect(rolledBack.turnEffectProbe?.wouldChangeTurn).toBe(false);
      expect(rolledBack.effectiveFlags?.['runtime.coding.writeJournal.enabled']).toBe(true);
      expect(rolledBack.effectiveFlags?.['runtime.coding.worktree.backend']).toBe('inprocess');
      expect(rolledBack.effectiveFlags?.['runtime.coding.patchFlow.default']).toBe(false);

      // Application relaunch: session/workspace/journal survive the Electron process.
      await sendTurn(
        app, llm.log, 'WRITE-BEFORE-APP-RESTART recovery.ts',
        'WRITE-BEFORE-APP-RESTART complete',
      );
      expect(await readFile(join(workspaceDir, 'recovery.ts'), 'utf8')).toBe(AFTER_APP_RESTART);
      await hostInvoke<Record<string, unknown>>(app, 'workspaces', 'create', {
        rootPath: workspaceDir, permissionMode: 'acceptEdits',
      });
      await closeElectronApp(app);
      app = null;

      app = await launchElectronApp({ skipSetup: true });
      await waitForMainLayout(app);
      await startGateway(app);
      const sessionAfterRelaunch = (await listMainSessions(app))
        .find((session) => session.key === 'agent:main:main');
      expect(sessionAfterRelaunch?.sessionId).toBe(sessionBeforeRestart?.sessionId);
      await sendTurn(
        app, llm.log, 'UNDO-AFTER-APP-RESTART now',
        'UNDO-AFTER-APP-RESTART complete',
      );
      expect(await readFile(join(workspaceDir, 'recovery.ts'), 'utf8')).toBe(ORIGINAL);
      expect(toolResultFor(llm.log, 'p105-undo-2').replace(/\s+/g, '')).toContain('"ok":true');

      // N -> N-1 simulation: persist a future marker and ON flags, then relaunch
      // the current binary. Ordinary data stays; every preview flag fails closed.
      const appVersion = await hostInvoke<string>(app, 'app', 'version');
      const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
      await closeElectronApp(app);
      app = null;
      await writeFile(settingsPath, `${JSON.stringify({
        ...settings,
        language: 'en',
        dcsContextViewToolsEnabled: true,
        dcsWorkingMemoryEnabled: true,
        dcsToolRegistryEnabled: true,
        dcsStaleWriteGuardEnabled: true,
        dcsSymbolLeaseEnabled: true,
        dcsRoutingMemoShadowEnabled: true,
        dcsSekbExperienceShadowEnabled: true,
      }, null, 2)}\n`, 'utf8');
      await writeConfig(openclawDir, sourceStateDir, enhancedConfig);
      await writeFile(versionStatePath, `${JSON.stringify({
        schema: 'verse-claw-app-version-state/1',
        lastStartedVersion: '999.0.0',
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8');

      app = await launchElectronApp({ skipSetup: true });
      await waitForMainLayout(app);
      const recoveredSettings = await hostInvoke<Record<string, unknown>>(app, 'settings', 'getAll');
      for (const key of [
        'dcsContextViewToolsEnabled',
        'dcsWorkingMemoryEnabled',
        'dcsToolRegistryEnabled',
        'dcsStaleWriteGuardEnabled',
        'dcsSymbolLeaseEnabled',
        'dcsRoutingMemoShadowEnabled',
      ]) {
        expect(recoveredSettings[key]).toBe(false);
      }
      expect(recoveredSettings.dcsSekbExperienceShadowEnabled).toBe(true);
      expect(recoveredSettings.language).toBe('en');
      const recoveredConfig = JSON.parse(
        await readFile(join(openclawDir, 'openclaw.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(JSON.stringify(recoveredConfig)).toContain('"enabled":false');
      expect(JSON.stringify(recoveredConfig)).toContain('mock-coder');
      const versionState = JSON.parse(await readFile(versionStatePath, 'utf8')) as {
        lastStartedVersion?: string;
        lastDowngrade?: { fromVersion?: string; toVersion?: string; forcedOffFlagIds?: string[] };
      };
      expect(versionState.lastStartedVersion).toBe(appVersion);
      expect(versionState.lastDowngrade?.fromVersion).toBe('999.0.0');
      expect(versionState.lastDowngrade?.toVersion).toBe(appVersion);
      expect(versionState.lastDowngrade?.forcedOffFlagIds?.length).toBeGreaterThan(0);
      await startGateway(app);
      const downgradeAck = await readAck(app);
      expect(downgradeAck.turnEffectProbe?.wouldChangeTurn).toBe(false);
      expect(await readFile(join(workspaceDir, 'recovery.ts'), 'utf8')).toBe(ORIGINAL);

      // S6: make the real child config path unreadable. DCS control returns an
      // explicit restart-failed state and operator hint, then recovers after repair.
      await rm(sourceConfigPath, { force: true });
      await mkdir(sourceConfigPath);
      const restartFailure = await hostInvoke<Record<string, unknown>>(
        app,
        'dcsProdFlags',
        'setFlag',
        { id: 'context-view-tools', enabled: true, restartGateway: true },
      );
      expect(restartFailure.status).toBe('pending-restart');
      expect(restartFailure.failureReason).toBe('restart-failed');
      expect(restartFailure.operatorHintKey).toBe('developer.dcsProdFlags.ackHint.restartFailed');
      expect(String(restartFailure.error)).toMatch(/restart failed|gateway/i);
      await hostInvoke<{ success: boolean }>(app, 'gateway', 'stop').catch(() => undefined);
      await rm(sourceConfigPath, { recursive: true, force: true });
      await writeFile(sourceConfigPath, await readFile(join(openclawDir, 'openclaw.json'), 'utf8'), 'utf8');
      await hostInvoke<Record<string, unknown>>(app, 'dcsProdFlags', 'setFlag', {
        id: 'context-view-tools', enabled: false, restartGateway: false,
      });
      await hostInvoke<{ success: boolean }>(app, 'gateway', 'start');
      const recoveredAck = await readAck(app);
      expect(recoveredAck.effectiveFlags?.['dcs.contextViewTools.enabled']).toBe(false);

      console.log('[fp-p1-05-evidence]', JSON.stringify({
        beforePid: before.childPid,
        afterGatewayRestartPid: afterGatewayRestart.childPid,
        sessionId: sessionAfterRelaunch?.sessionId,
        journalGeneration: firstMeta.lineage?.gatewayGeneration,
        killAppliedMs,
        downgrade: versionState.lastDowngrade,
        restartFailure,
        recoveredPid: recoveredAck.childPid,
      }));
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
