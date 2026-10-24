import type { ElectronApplication } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, test } from './fixtures/electron';
import {
  createTaskLedgerWorkingContextDecision,
  createTaskLedgerWorkingContextProposal,
} from '../../shared/task-ledger-working-context';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type Workspace = { id: string; rootPath: string; selectedAgentId?: string; activeSessionKey?: string };
type ContinuityPack = {
  schemaVersion: string;
  status: string;
  complete: boolean;
  bindingRevision: number;
  budget: { maxChars: number; usedChars: number; truncated: boolean; droppedItems: number };
  items: Array<{ kind: string; text: string; source: string; freshness: string; scope: { kind: string; key?: string | null } }>;
  sourceStates: Array<{ source: string; status: string; detail?: string }>;
  exclusions: Array<{ ref: string; reason: string }>;
  originalHistory: { transcriptRef: string; taskLedgerRef: string; taskLedgerEventCount: number; compressionAvailable: boolean };
};
type ContinuityResult = {
  success: boolean;
  validation: 'current' | 'missing' | 'invalidated' | 'unavailable';
  pack?: ContinuityPack;
  rendered?: string;
  reason?: string;
};

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available');
    const sender = win.webContents;
    return await handler(
      { sender, senderFrame: { url: sender.getURL() } },
      { id: 'd1-' + Date.now() + '-' + Math.random(), ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let startRequested = false;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady === true || status.state === 'running') return;
    if (!startRequested && status.state !== 'starting') {
      startRequested = true;
      await hostInvoke(app, 'gateway', 'start');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready');
}

async function createSession(app: ElectronApplication, label: string): Promise<string> {
  const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: { agentId: 'main', label },
    timeoutMs: 60_000,
  });
  const candidates = [created, created.result, created.payload, created.data].filter(
    (value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'),
  );
  const key = candidates.flatMap((value) => [value.key, value.sessionKey]).find((value) => typeof value === 'string');
  if (typeof key !== 'string') throw new Error('sessions.create returned no key: ' + JSON.stringify(created));
  return key;
}

test('real Host/Gateway continuity preview reads accepted owners and fails closed across scope/rollback', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  let app: ElectronApplication | undefined;
  const observation: Record<string, unknown> = {
    schema: 'clawx.long-session.d1-continuity-preview/v1',
    driven_by: 'agent',
    actor: 'codex-long-session-r2',
    negatives: [],
  };
  try {
    app = await launchElectronApp({ skipSetup: true });
    await ensureGatewayReady(app);
    const active = await hostInvoke<{ activeWorkspace?: Workspace }>(app, 'workspaces', 'getActive');
    const workspace = active.activeWorkspace;
    if (!workspace) throw new Error('No active workspace');
    const token = Date.now().toString(36);
    const scratchRoot = join(testInfo.outputDir, `workspace-${token}`);
    await mkdir(scratchRoot, { recursive: true });
    const updatedWorkspace = await hostInvoke<{ activeWorkspace?: Workspace; workspaces?: Workspace[] }>(app, 'workspaces', 'update', {
      id: workspace.id,
      rootPath: scratchRoot,
      permissionMode: 'fullAccess',
    });
    const boundWorkspace = updatedWorkspace.activeWorkspace
      ?? updatedWorkspace.workspaces?.find((candidate) => candidate.id === workspace.id)
      ?? { ...workspace, rootPath: scratchRoot };
    const coordinatorSessionKey = await createSession(app, `D1 coordinator ${token}`);
    const ordinarySessionKey = await createSession(app, `D1 ordinary ${token}`);
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspace.id,
      agentId: 'main',
      activeSessionKey: coordinatorSessionKey,
      sessionKey: coordinatorSessionKey,
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string; title: string }> } }>(app, 'taskLedger', 'createNode', {
      workspaceId: workspace.id,
      node: {
        title: `D1 continuity task ${token}`,
        kind: 'task',
        status: 'doing',
        owner: 'agent',
        metadata: { nextAction: 'Verify accepted continuity owners.' },
      },
    });
    const taskNodeId = ledger.snapshot.nodes.find((node) => node.title === `D1 continuity task ${token}`)?.id;
    if (!taskNodeId) throw new Error('Task Ledger node missing');

    const constraints = createTaskLedgerWorkingContextProposal({
      proposalId: `d1-constraints-${token}`,
      field: 'Constraints',
      value: ['Stay inside workspace scope.', 'Never inject unapproved candidates.'],
      version: 1,
      actor: 'assistant',
      taskId: taskNodeId,
      sessionId: coordinatorSessionKey,
      evidenceRefs: [{ type: 'session', ref: coordinatorSessionKey }],
      sensitivity: 'workspace',
      trust: 'confirmed',
    });
    const nextAction = createTaskLedgerWorkingContextProposal({
      proposalId: `d1-next-${token}`,
      field: 'NextAction',
      value: 'Run the real continuity preview.',
      version: 1,
      actor: 'assistant',
      taskId: taskNodeId,
      sessionId: coordinatorSessionKey,
      evidenceRefs: [{ type: 'session', ref: coordinatorSessionKey }],
      sensitivity: 'workspace',
      trust: 'confirmed',
    });
    const pendingRisk = createTaskLedgerWorkingContextProposal({
      proposalId: `d1-pending-risk-${token}`,
      field: 'OpenRisks',
      value: ['Unverified model prose must remain pending.'],
      version: 1,
      actor: 'assistant',
      taskId: taskNodeId,
      sessionId: coordinatorSessionKey,
      evidenceRefs: [{ type: 'session', ref: coordinatorSessionKey }],
      sensitivity: 'workspace',
      trust: 'proposed',
    });
    if (!constraints.ok || !nextAction.ok || !pendingRisk.ok) throw new Error('Working context event construction failed: ' + JSON.stringify({ constraints, nextAction, pendingRisk }));
    const policyDigest = `sha256:${'a'.repeat(64)}` as const;
    const constraintDecision = createTaskLedgerWorkingContextDecision({
      proposalId: `d1-constraints-${token}`, field: 'Constraints', version: 1, decision: 'accepted',
      actor: 'system', taskId: taskNodeId, sessionId: coordinatorSessionKey, policyDigest,
    });
    const nextDecision = createTaskLedgerWorkingContextDecision({
      proposalId: `d1-next-${token}`, field: 'NextAction', version: 1, decision: 'accepted',
      actor: 'system', taskId: taskNodeId, sessionId: coordinatorSessionKey, policyDigest,
    });
    if (!constraintDecision.ok || !nextDecision.ok) throw new Error('Working context decision construction failed');
    await hostInvoke(app, 'taskLedger', 'appendEvents', {
      workspaceId: workspace.id,
      events: [constraints.event, constraintDecision.event, nextAction.event, nextDecision.event, pendingRisk.event],
    });

    const rememberedContent = `D1 accepted memory ${token}: remain within the bound workspace.`;
    const config = await hostInvoke<{ hash?: string; path?: string }>(app, 'gateway', 'rpc', {
      method: 'config.get',
      params: {},
      timeoutMs: 30_000,
    });
    if (!config.hash) throw new Error('config.get returned no hash: ' + JSON.stringify(config));
    const configRecord = config as Record<string, unknown>;
    await hostInvoke(app, 'gateway', 'rpc', {
      method: 'config.patch',
      params: {
        raw: JSON.stringify({ runtime: { memory: { injectPilot: { enabled: true, providers: ['role-memory'], sessions: 'all' } } } }),
        baseHash: configRecord.hash as string,
        note: 'D1 model-visible memory evidence',
      },
      timeoutMs: 60_000,
    });
    const proposed = await hostInvoke<{
      ok?: boolean; accepted?: boolean; card?: { id?: string }; proposal?: { id?: string }; reason?: string;
    }>(app, 'gateway', 'rpc', {
      method: 'memory.propose',
      params: {
        proposal: {
          content: rememberedContent,
          scope: 'workspace',
          scopeKey: boundWorkspace.rootPath,
          type: 'fact',
          sensitivity: 'normal',
          source: 'user',
        },
      },
      timeoutMs: 30_000,
    });
    const acceptedCardId = proposed.card?.id;
    const proposalId = proposed.proposal?.id;
    if (!acceptedCardId && !proposalId) throw new Error('Memory proposal returned neither a card nor candidate: ' + JSON.stringify(proposed));
    if (!acceptedCardId) {
      const reviewed = await hostInvoke<{
        ok?: boolean; accepted?: boolean; card?: { id?: string }; reason?: string;
      }>(app, 'gateway', 'rpc', {
        method: 'memory.review',
        params: { id: proposalId, action: 'approve' },
        timeoutMs: 30_000,
      });
      if (!reviewed.card?.id) throw new Error('Memory review did not expose an accepted card: ' + JSON.stringify(reviewed));
    }

    await hostInvoke(app, 'workspaces', 'bindCoordinator', {
      workspaceId: workspace.id,
      agentId: 'main',
      sessionKey: coordinatorSessionKey,
      expectedRevision: 0,
      taskLedgerNodeIds: [taskNodeId],
      environment: { kind: 'local', rootPath: boundWorkspace.rootPath, setupProfile: null },
      archiveRestorePolicy: 'restore',
    });

    const preview = await hostInvoke<ContinuityResult>(app, 'chat', 'continuityPreview', {
      sessionKey: coordinatorSessionKey,
      workspaceId: workspace.id,
      activeTaskNodeId: taskNodeId,
      knowledgeReferences: [{ id: `wiki:d1:${token}`, title: 'D1 owner decision', lookup: 'notes/d1.md', corpus: 'wiki', freshnessLevel: 'fresh' }],
    });
    expect(preview.success).toBe(true);
    expect(preview.validation).toBe('current');
    const pack = preview.pack;
    if (!pack) throw new Error('Continuity preview returned no pack');
    expect(pack.schemaVersion).toBe('ContinuityContextPack/v1');
    expect(pack.complete).toBe(false);
    expect(pack.bindingRevision).toBe(1);
    const memoryItem = pack.items.find((item) => item.kind === 'memory-ref' && item.text.includes('role-memory-card:') && item.scope.key === boundWorkspace.rootPath);
    expect(memoryItem).toBeTruthy();
    expect(pack.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'constraint', text: expect.stringContaining('Stay inside workspace scope.') }),
      expect.objectContaining({ kind: 'next-action', text: expect.stringContaining('Run the real continuity preview.') }),
      expect.objectContaining({ kind: 'knowledge-ref', text: expect.stringContaining('notes/d1.md') }),
    ]));
    expect(pack.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: `task-ledger-working-context:d1-pending-risk-${token}`, reason: 'pending-not-accepted' }),
    ]));
    expect(preview.rendered).not.toContain('Unverified model prose must remain pending.');
    expect(preview.rendered).toContain('Original history is not copied into this turn');
    expect(pack.originalHistory.transcriptRef).toBe(`session:${coordinatorSessionKey}`);
    expect(pack.originalHistory.taskLedgerRef).toBe(`task-ledger:${workspace.id}`);

    const retainedPath = testInfo.outputPath('continuity-preview.json');
    await writeFile(retainedPath, JSON.stringify({ schema: 'clawx.long-session.d1-pack/v1', driven_by: 'agent', actor: 'codex-long-session-r2', workspaceId: workspace.id, coordinatorSessionKey, taskNodeId, memoryContent: rememberedContent, preview }, null, 2) + '\n', 'utf8');
    observation.primary = retainedPath;

    const crossScope = await hostInvoke<ContinuityResult>(app, 'chat', 'continuityPreview', {
      sessionKey: ordinarySessionKey,
      workspaceId: workspace.id,
      knowledgeReferences: [{ id: `wiki:d1:${token}`, title: 'D1 owner decision', lookup: 'notes/d1.md', corpus: 'wiki' }],
    });
    expect(crossScope.validation).toBe('missing');
    expect(crossScope.pack).toBeUndefined();
    (observation.negatives as string[]).push('ordinary session missing coordinator binding -> no pack');

    await hostInvoke(app, 'sessions', 'delete', { id: coordinatorSessionKey });
    const invalidated = await hostInvoke<ContinuityResult>(app, 'chat', 'continuityPreview', {
      sessionKey: coordinatorSessionKey,
      workspaceId: workspace.id,
    });
    expect(invalidated.validation).toBe('invalidated');
    expect(invalidated.pack).toBeUndefined();
    (observation.negatives as string[]).push('deleted coordinator session -> binding invalidated -> no pack');

    observation.status = 'passed';
    observation.packStatus = pack.status;
    observation.items = pack.items.map((item) => ({ kind: item.kind, source: item.source, freshness: item.freshness, scope: item.scope }));
    observation.sourceStates = pack.sourceStates;
    observation.exclusions = pack.exclusions;
    const observationPath = testInfo.outputPath('continuity-observation.json');
    await writeFile(observationPath, JSON.stringify(observation, null, 2) + '\n', 'utf8');
    observation.observationPath = observationPath;
    console.log(JSON.stringify(observation));
  } finally {
    if (app) await closeElectronApp(app);
  }
});
