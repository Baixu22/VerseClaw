import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ElectronApplication, TestInfo } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import {
  buildMockProviderConfig,
  hostInvoke,
  startGateway,
  startScriptedLlm,
} from './fixtures/fp-p1-harness';

type GatewayStatus = { state?: string; gatewayReady?: boolean; childPid?: number; gatewayGeneration?: string };
type SessionRow = { key?: string; sessionId?: string };
type Workspace = { id: string; rootPath: string; activeSessionKey?: string };
type ArchiveEntry = { sessionKey: string; transcriptPath: string };
type LedgerSnapshot = {
  snapshot: {
    nodes: Array<{ id: string; title: string; status: string }>;
    sessionLinks: Array<{ sessionKey: string; nodeId?: string | null; relation?: string }>;
  };
};

async function readRuntimeAck(app: ElectronApplication): Promise<GatewayStatus> {
  const deadline = Date.now() + 120_000;
  let last: GatewayStatus;
  while (Date.now() < deadline) {
    try {
      last = await hostInvoke<GatewayStatus>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000,
      });
      if (typeof last.childPid === 'number') return last;
    } catch {
      // The real child is between stop and ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('runtime.flags.ack did not expose a child identity');
}

async function ensureGatewayReady(app: ElectronApplication): Promise<GatewayStatus> {
  await startGateway(app);
  return readRuntimeAck(app);
}

async function listSessions(app: ElectronApplication): Promise<SessionRow[]> {
  const result = await hostInvoke<{ sessions?: SessionRow[] }>(app, 'gateway', 'rpc', {
    method: 'sessions.list', params: { agentId: 'main' }, timeoutMs: 30_000,
  });
  return result.sessions ?? [];
}

async function createSession(app: ElectronApplication, label: string): Promise<{ key: string; sessionId: string }> {
  const created = await hostInvoke<{ key?: string; sessionKey?: string; sessionId?: string; entry?: { sessionId?: string } }>(
    app, 'gateway', 'rpc',
    { method: 'sessions.create', params: { agentId: 'main', label }, timeoutMs: 60_000 },
  );
  const key = created.key ?? created.sessionKey ?? '';
  if (!key) throw new Error('sessions.create returned no key');
  let sessionId = created.sessionId ?? created.entry?.sessionId ?? '';
  if (!sessionId) {
    sessionId = (await listSessions(app)).find((row) => row.key === key)?.sessionId ?? '';
  }
  if (!sessionId) throw new Error(`sessions.create returned no generation for ${key}`);
  return { key, sessionId };
}

async function inject(app: ElectronApplication, sessionKey: string, message: string): Promise<void> {
  await hostInvoke(app, 'gateway', 'rpc', {
    method: 'chat.inject',
    params: { sessionKey, agentId: 'main', message, label: 'agent-driven-f1-fixture' },
    timeoutMs: 30_000,
  });
}

async function historyContains(app: ElectronApplication, sessionKey: string, text: string): Promise<boolean> {
  const history = await hostInvoke<{ success?: boolean; messages?: unknown[] }>(app, 'sessions', 'history', { sessionKey });
  return history.success !== false && JSON.stringify(history.messages ?? []).includes(text);
}

async function activeWorkspace(app: ElectronApplication): Promise<Workspace> {
  const active = await hostInvoke<{ activeWorkspace?: Workspace }>(app, 'workspaces', 'getActive');
  if (!active.activeWorkspace?.id || !active.activeWorkspace.rootPath) throw new Error('active Workspace missing');
  await hostInvoke(app, 'workspaces', 'update', { id: active.activeWorkspace.id, permissionMode: 'fullAccess' });
  return active.activeWorkspace;
}

async function createInactiveWorkspace(app: ElectronApplication, rootPath: string, name: string): Promise<Workspace> {
  await mkdir(rootPath, { recursive: true });
  const { createdWorkspace } = await hostInvoke<{ createdWorkspace?: Workspace }>(app, 'workspaces', 'create', {
    name, rootPath, permissionMode: 'fullAccess', agentId: 'main', activate: false,
  });
  if (!createdWorkspace?.id) throw new Error(`Workspace create returned no profile for ${name}`);
  return createdWorkspace;
}

async function createLedgerNode(app: ElectronApplication, workspaceId: string, title: string): Promise<string> {
  const result = await hostInvoke<LedgerSnapshot>(app, 'taskLedger', 'createNode', {
    workspaceId,
    node: { title, kind: 'task', status: 'todo' },
    idempotencyKey: `f1-node-${workspaceId}-${title}`,
  });
  const node = result.snapshot.nodes.find((entry) => entry.title === title);
  if (!node) throw new Error(`Task Ledger did not return ${title}`);
  return node.id;
}

async function writeReceipt(testInfo: TestInfo, receipt: unknown): Promise<void> {
  const output = testInfo.outputPath('restart-journey-results.json');
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}
`, 'utf8');
  await testInfo.attach('restart-journey-results', { path: output, contentType: 'application/json' });
}

test.describe('long-session restart journeys', () => {
  test('real Electron journeys preserve scope, transcripts, task links, and lifecycle generations', async ({ launchElectronApp, homeDir, userDataDir }, testInfo) => {
    test.setTimeout(900_000);
    const llm = await startScriptedLlm((text) => ({
      text: text.includes('F1-REAL-TURN') ? 'F1-REAL-TURN completed' : 'F1 deterministic gateway reply',
    }));
    const workspaceB = await mkdtemp(join(tmpdir(), 'clawx-f1-workspace-b-'));
    const openclawDir = join(homeDir, '.openclaw');
    const workspaceA = join(openclawDir, 'workspace');
    const sourceStateDir = join(userDataDir, 'openclaw-source-state');
    const sourceConfigPath = join(sourceStateDir, 'openclaw.json');
    const config = buildMockProviderConfig(llm.port, workspaceA);
    await mkdir(workspaceA, { recursive: true });
    await mkdir(sourceStateDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), `${JSON.stringify(config, null, 2)}
`, 'utf8');
    await writeFile(sourceConfigPath, `${JSON.stringify(config, null, 2)}
`, 'utf8');

    let app: ElectronApplication | null = await launchElectronApp({ skipSetup: true });
    let forkKey: string | undefined;
    let handoffKey: string | undefined;
    let archiveEntry: ArchiveEntry | undefined;
    let restoredGeneration: string | undefined;
    let beforeGatewayRestart: GatewayStatus | undefined;
    let afterGatewayRestart: GatewayStatus | undefined;
    let firstLlmRequests: number;
    let dualWorkerBatch: Record<string, unknown> | undefined;
    try {
      const firstApp = app;
      if (!firstApp) throw new Error('first Electron app did not launch');
      await getStableWindow(firstApp);
      beforeGatewayRestart = await ensureGatewayReady(firstApp);
      const firstWorkspace = await activeWorkspace(firstApp);
      expect(firstWorkspace.rootPath).toBe(workspaceA);
      const secondWorkspace = await createInactiveWorkspace(firstApp, workspaceB, 'F1 Workspace B');
      const sourceSession = await createSession(firstApp, 'F1 source session');
      const ordinarySession = await createSession(firstApp, 'F1 ordinary session');
      await hostInvoke(firstApp, 'workspaces', 'update', {
        id: firstWorkspace.id, agentId: 'main', activeSessionKey: sourceSession.key, sessionKey: sourceSession.key,
      });
      const sourceTaskId = await createLedgerNode(firstApp, firstWorkspace.id, 'F1 workspace A task');
      const secondTaskId = await createLedgerNode(firstApp, secondWorkspace.id, 'F1 workspace B task');
      await hostInvoke(firstApp, 'taskLedger', 'linkSession', {
        workspaceId: firstWorkspace.id, nodeId: sourceTaskId, sessionKey: sourceSession.key,
        agentId: 'main', relation: 'related', idempotencyKey: `f1-link-a-${sourceSession.key}`,
      });
      await hostInvoke(firstApp, 'taskLedger', 'linkSession', {
        workspaceId: firstWorkspace.id, nodeId: sourceTaskId, sessionKey: sourceSession.key,
        agentId: 'main', relation: 'related', idempotencyKey: `f1-link-a-${sourceSession.key}`,
      });

      await inject(firstApp, sourceSession.key, 'F1-DETERMINISTIC-SOURCE');
      await inject(firstApp, ordinarySession.key, 'F1-ORDINARY-ISOLATED');
      await hostInvoke(firstApp, 'chat', 'sendWithMedia', {
        sessionKey: sourceSession.key, message: 'F1-REAL-TURN', idempotencyKey: 'f1-real-turn',
      });
      await expect.poll(async () => historyContains(firstApp, sourceSession.key, 'F1-REAL-TURN completed'), { timeout: 120_000 }).toBe(true);
      firstLlmRequests = llm.log.length;
      expect(firstLlmRequests).toBeGreaterThan(0);

      const fork = await hostInvoke<{ success: boolean; sessionKey?: string; sourceSessionKey?: string }>(firstApp, 'sessions', 'fork', {
        sessionKey: sourceSession.key, agentId: 'main', workspaceId: firstWorkspace.id, label: 'F1 fork',
      });
      expect(fork.success).toBe(true);
      forkKey = fork.sessionKey;
      if (!forkKey) throw new Error('fork returned no session key');
      await inject(firstApp, forkKey, 'F1-FORK-ONLY');
      const forkPatch = await hostInvoke<{ path?: string; entry?: { sessionFile?: string } }>(firstApp, 'gateway', 'rpc', {
        method: 'sessions.patch', params: { key: forkKey, agentId: 'main' }, timeoutMs: 30_000,
      });
      const returnedSessionFile = forkPatch.entry?.sessionFile?.trim();
      const sessionFileName = returnedSessionFile ? basename(returnedSessionFile) : '';
      const forkTranscriptCandidates = [
        returnedSessionFile && returnedSessionFile.match(/^[A-Za-z]:[/]/) ? returnedSessionFile : '',
        sessionFileName ? join(openclawDir, 'agents', 'main', 'sessions', sessionFileName) : '',
        sessionFileName ? join(sourceStateDir, 'agents', 'main', 'sessions', sessionFileName) : '',
      ].filter(Boolean);
      const forkTranscriptPath = forkTranscriptCandidates.find((candidate) => existsSync(candidate));
      if (!forkTranscriptPath) throw new Error('fork transcript was not found');
      const forkEntries = (await readFile(forkTranscriptPath, 'utf8'))
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { id?: string; type?: string; message?: { role?: string } });
      const forkLeafId = forkEntries.find((entry) => entry.type === 'message' && entry.message?.role === 'assistant')?.id;
      if (!forkLeafId) throw new Error('fork transcript has no assistant leaf');
      const compact = await hostInvoke<{ success: boolean; compacted?: boolean; error?: string }>(firstApp, 'sessions', 'compactRange', {
        sessionKey: forkKey, agentId: 'main', fromLeafId: forkLeafId,
      });
      expect(compact.success).toBe(true);
      if (compact.compacted !== true) throw new Error(`located compaction did not compact: ${JSON.stringify(compact)}`);
      const handoff = await hostInvoke<{ success: boolean; sessionKey?: string; operation?: { sessionGeneration: string } }>(firstApp, 'sessions', 'createHandoff', {
        sessionKey: sourceSession.key, agentId: 'main', workspaceId: firstWorkspace.id, draftInput: 'F1 handoff draft',
      });
      expect(handoff.success).toBe(true);
      handoffKey = handoff.sessionKey;
      if (!handoffKey) throw new Error('createHandoff returned no session key');
      expect(handoff.operation).toMatchObject({ phase: 'ready', sessionGeneration: expect.any(String) });
      const handoffChild = await hostInvoke<{ session?: { sessionId: string; parentSessionKey: string } }>(firstApp, 'gateway', 'rpc', {
        method: 'sessions.describe', params: { key: handoffKey }, timeoutMs: 30_000,
      });
      expect(handoffChild.session).toMatchObject({ sessionId: handoff.operation?.sessionGeneration, parentSessionKey: sourceSession.key });
      await inject(firstApp, handoffKey, 'F1-HANDOFF-ONLY');

      afterGatewayRestart = await (async () => {
        await hostInvoke(firstApp, 'gateway', 'restart');
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          const status = await readRuntimeAck(firstApp).catch(() => ({} as GatewayStatus));
          if (typeof status.childPid === 'number' && status.childPid !== beforeGatewayRestart?.childPid && status.gatewayGeneration !== beforeGatewayRestart?.gatewayGeneration) return status;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        throw new Error('Gateway restart did not produce a new child');
      })();
      expect(await historyContains(firstApp, sourceSession.key, 'F1-DETERMINISTIC-SOURCE')).toBe(true);
      expect(await historyContains(firstApp, sourceSession.key, 'F1-REAL-TURN completed')).toBe(true);
      expect(await historyContains(firstApp, ordinarySession.key, 'F1-ORDINARY-ISOLATED')).toBe(true);
      expect(await historyContains(firstApp, handoffKey, 'F1-HANDOFF-ONLY')).toBe(true);

      const archived = await hostInvoke<{ success: boolean; resourceReclamation?: { recoveryRequired?: boolean } }>(app, 'sessions', 'archive', {
        id: sourceSession.key, originalWorkspaceId: firstWorkspace.id, label: 'F1 archived source',
      });
      expect(archived.success).toBe(true);
      const archiveIndex = await hostInvoke<{ success: boolean; entries: ArchiveEntry[] }>(app, 'sessions', 'listArchived', { agentId: 'main' });
      archiveEntry = archiveIndex.entries.find((entry) => entry.sessionKey === sourceSession.key);
      if (!archiveEntry) throw new Error('archive index did not contain source session');
      const archivedText = await readFile(archiveEntry.transcriptPath, 'utf8');
      expect(archivedText).toContain('F1-DETERMINISTIC-SOURCE');
      expect((await listSessions(firstApp)).some((row) => row.key === sourceSession.key)).toBe(false);
      const restored = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'restore', { id: sourceSession.key });
      expect(restored.success, restored.error).toBe(true);
      const restoredRow = (await listSessions(firstApp)).find((row) => row.key === sourceSession.key);
      restoredGeneration = restoredRow?.sessionId;
      expect(restoredGeneration).toBeTruthy();
      expect(restoredGeneration).not.toBe(sourceSession.sessionId);
      expect(await historyContains(firstApp, sourceSession.key, 'F1-DETERMINISTIC-SOURCE')).toBe(true);

      const ledgerA = await hostInvoke<LedgerSnapshot>(app, 'taskLedger', 'snapshot', { workspaceId: firstWorkspace.id });
      const ledgerB = await hostInvoke<LedgerSnapshot>(app, 'taskLedger', 'snapshot', { workspaceId: secondWorkspace.id });
      expect(ledgerA.snapshot.nodes.some((node) => node.id === sourceTaskId)).toBe(true);
      expect(ledgerA.snapshot.nodes.some((node) => node.id === secondTaskId)).toBe(false);
      expect(ledgerB.snapshot.nodes.some((node) => node.id === secondTaskId)).toBe(true);
      expect(ledgerB.snapshot.nodes.some((node) => node.id === sourceTaskId)).toBe(false);
      expect(ledgerA.snapshot.sessionLinks.filter((link) => link.sessionKey === sourceSession.key && link.nodeId === sourceTaskId)).toHaveLength(1);
      expect(ledgerA.snapshot.sessionLinks.some((link) => link.sessionKey === ordinarySession.key)).toBe(false);

      await closeElectronApp(app);
      app = null;
      const relaunched = await launchElectronApp({ skipSetup: true });
      app = relaunched;
      await getStableWindow(relaunched);
      await ensureGatewayReady(relaunched);
      expect(await historyContains(relaunched, sourceSession.key, 'F1-DETERMINISTIC-SOURCE')).toBe(true);
      expect(await historyContains(relaunched, ordinarySession.key, 'F1-ORDINARY-ISOLATED')).toBe(true);
      const relaunchedLedger = await hostInvoke<LedgerSnapshot>(relaunched, 'taskLedger', 'snapshot', { workspaceId: firstWorkspace.id });
      expect(relaunchedLedger.snapshot.sessionLinks.filter((link) => link.sessionKey === sourceSession.key && link.nodeId === sourceTaskId)).toHaveLength(1);

      const orchestration = await hostInvoke<{ status?: string; orchestrationRunId?: string; spawnedRunIds?: string[]; expectedChildren?: unknown[] }>(relaunched, 'gateway', 'rpc', {
        method: 'orchestrator.run',
        params: {
          task: 'F1 dual worker restart journey',
          sessionKey: sourceSession.key,
          agentId: 'main',
          backend: 'subagent',
          workspaceDir: firstWorkspace.rootPath,
          includeVerifier: false,
          workers: [
            { roleName: 'architect', task: 'Return the architect receipt', isolation: 'shared', writeSet: [] },
            { roleName: 'tester', task: 'Return the tester receipt', isolation: 'shared', writeSet: [] },
          ],
        },
        timeoutMs: 180_000,
      });
      const orchestrationRunId = orchestration.orchestrationRunId;
      if (!orchestrationRunId) throw new Error('orchestrator.run returned no orchestrationRunId');
      const batchDeadline = Date.now() + 120_000;
      while (Date.now() < batchDeadline) {
        const activity = await hostInvoke<{ snapshot?: { completionBatches?: Array<Record<string, unknown>> } }>(relaunched, 'sessionActivity', 'snapshot', {
          workspaceId: firstWorkspace.id,
          sessionKey: sourceSession.key,
        });
        const batch = activity.snapshot?.completionBatches?.find((candidate) => candidate.orchestrationRunId === orchestrationRunId);
        if (batch?.status === 'terminal') {
          dualWorkerBatch = batch;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      if (!dualWorkerBatch) throw new Error('dual worker completion batch did not become terminal');
      expect((dualWorkerBatch.counts as Record<string, number>).expected).toBe(2);
      expect((dualWorkerBatch.counts as Record<string, number>).settled).toBe(2);

      const deleted = await hostInvoke<{ success: boolean; error?: string; expectedSessionId?: string }>(relaunched, 'sessions', 'delete', { id: ordinarySession.key });
      expect(deleted.success, deleted.error).toBe(true);
      expect((await listSessions(relaunched)).some((row) => row.key === ordinarySession.key)).toBe(false);
      expect(await historyContains(relaunched, sourceSession.key, 'F1-DETERMINISTIC-SOURCE')).toBe(true);

      const stale = await hostInvoke<{ success: boolean; error?: string }>(relaunched, 'sessions', 'archive', {
        id: sourceSession.key, originalWorkspaceId: firstWorkspace.id,
      }).then(() => hostInvoke<{ success: boolean; error?: string }>(relaunched, 'sessions', 'restore', { id: sourceSession.key }))
        .then(() => hostInvoke<{ success: boolean; error?: string }>(relaunched, 'sessions', 'restore', { id: sourceSession.key }))
        .catch((error) => ({ success: false, error: String(error) }));
      expect(stale.success).toBe(false);

      await writeReceipt(testInfo, {
        schema: 'clawx.long-session.restart-journeys/v1',
        driven_by: 'agent',
        actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-f1-agent',
        candidate: process.env.CLAWX_E2E_CANDIDATE ?? null,
        transport: 'built Electron host:invoke -> actual Main -> actual Gateway -> local scripted OpenAI-compatible provider; lifecycle via existing transcript/archive/TaskLedger owners',
        evidenceLevels: {
          openclawRuntime: 'real local scripted OpenAI-compatible provider; production Gateway/runner/transcript path',
          nativeBackend: 'unverified: no native provider route exercised',
          workerBatch: 'terminal two-worker batch read from the session activity owner',
        },
        journeys: {
          realProviderTurn: { requests: firstLlmRequests, transcriptReadback: true },
          gatewayRestart: { beforePid: beforeGatewayRestart?.childPid ?? null, afterPid: afterGatewayRestart?.childPid ?? null, transcriptReadback: true },
          appRestart: { transcriptReadback: true, taskLedgerReadback: true },
          forkCompactHandoff: { forkKey, handoffKey, handoffChild: handoffChild.session, compact: compact.success, compacted: compact.compacted ?? false },
          archiveRestore: { archived: true, archiveEntry, archivedGeneration: sourceSession.sessionId, restoredGeneration, restoredHistory: true },
          isolation: { workspaces: 2, ordinarySessions: 1, crossWorkspaceNodes: 0, taskLinksForOrdinarySession: 0 },
          lifecycleNegative: { duplicateRestoreRejected: true, ordinaryDeleteDidNotTouchSource: true, staleError: stale.error ?? null },
          dualWorkerBatch,
        },
        unmeasured: ['No live external model provider or model-quality comparison was run.', 'Native backend route was not exercised.'],
      });
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      llm.server.closeAllConnections();
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      await rm(workspaceB, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
