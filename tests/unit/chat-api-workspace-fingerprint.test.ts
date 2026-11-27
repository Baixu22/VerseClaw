import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {TaskSystemStore} from '../../shared/task-system/store';
import {resolveTaskDomain} from '../../shared/task-system/identity';

const coordinatorRoot = mkdtempSync(resolve(tmpdir(), 'chat-coordinator-workspace-'));
execFileSync('git', ['init', '--quiet', coordinatorRoot], { windowsHide: true, stdio: 'pipe' });
afterAll(() => rmSync(coordinatorRoot, { recursive: true, force: true }));

function computeExpectedFingerprint(rootPath: string): string {
  const absolute = resolve(rootPath);
  const normalized = absolute.replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

function coordinatorBinding(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-app',
    agentId: 'main',
    sessionKey: 'agent:main:main',
    sessionGeneration: 'generation-1',
    taskLedgerReferences: [],
    environment: { kind: 'local', canonicalRoot: coordinatorRoot, backend: 'git', branch: 'main', detachedHead: false, setupProfile: null },
    archiveRestorePolicy: 'restore',
    state: 'active',
    bindingRevision: 1,
    invalidationReason: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const loadTaskLedgerSnapshotMock = vi.fn();
const getWorkspaceRootPathByIdMock = vi.fn();
const getPersistedCoordinatorBindingMock = vi.fn();
const materializeCoordinatorSessionGenerationMock = vi.fn();

vi.mock('@electron/services/task-ledger-service', () => ({
  loadTaskLedgerSnapshot: (...args: unknown[]) => loadTaskLedgerSnapshotMock(...args),
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getWorkspaceRootPathById: (...args: unknown[]) => getWorkspaceRootPathByIdMock(...args),
  getPersistedCoordinatorBinding: (...args: unknown[]) => getPersistedCoordinatorBindingMock(...args),
  materializeCoordinatorSessionGeneration: (...args: unknown[]) => materializeCoordinatorSessionGenerationMock(...args),
}));

/**
 * The pre-Gateway budget gate reads persisted usage from `~/.openclaw`
 * transcripts, so an unmocked reader makes this file's result depend on how much
 * the machine has used: past the 1,000,000-token default the send is rejected as
 * `TOKEN_BUDGET_EXCEEDED` and never reaches `rpcParams`. Budget behaviour is
 * covered by `chat-resource-limits-p5-004.test.ts`.
 */
vi.mock('@electron/utils/token-usage', () => ({
  getSessionTokenUsageSummary: vi.fn(async () => ({ totalTokens: 0, estimatedCostUsd: 0 })),
}));

/**
 * D3 closeout: Chat workspaceId → Main normalizeRootPath → Gateway field chain.
 *
 * RED phase: chat-api.ts must forward `workspaceId` (currently dropped at
 * rpcParams) and produce `workspaceFingerprint` from the workspace's rootPath
 * (looked up via workspaces-api) so Gateway receives a trusted authority field
 * instead of relying solely on attempt.ts local effectiveWorkspace.
 */
describe('chat-api workspaceId + workspaceFingerprint forwarding (D3 closeout)', () => {
  it('keeps pinned guide content stable when coordinator context changes between retries', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue(coordinatorRoot);
    getPersistedCoordinatorBindingMock.mockResolvedValue(coordinatorBinding());
    loadTaskLedgerSnapshotMock.mockRejectedValue(new Error('Pinned guidance must not rebuild task context'));
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => method === 'sessions.describe'
        ? { session: { sessionId: 'generation-1' } } : { steered: true, runId: 'original-run' }),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });
    const request = { sessionKey: 'agent:main:main', workspaceId: 'ws-app', expectedSessionGeneration: 'generation-1',
      expectedGuideRunId: 'original-run', inputMode: 'guide', message: 'Keep this exact guidance.',
      knowledgeScope: 'none', idempotencyKey: 'stable-guide-request' };
    expect(await api.sendWithMedia(request)).toMatchObject({ success: true, result: { runId: 'original-run' } });
    getPersistedCoordinatorBindingMock.mockResolvedValue(coordinatorBinding({ bindingRevision: 2 }));
    expect(await api.sendWithMedia(request)).toMatchObject({ success: true, result: { runId: 'original-run' } });
    const calls = (gatewayManager.rpc.mock.calls as unknown[][]).filter(call => call[0] === 'chat.send');
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({ message: request.message, expectedGuideRunId: 'original-run' });
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(loadTaskLedgerSnapshotMock).not.toHaveBeenCalled();
  });

  it('keeps user text unchanged while restoring a task started without manual coordinator setup',async()=>{
    const root=mkdtempSync(resolve(tmpdir(),'quiet-task-chat-'));const tasks=new TaskSystemStore(resolveTaskDomain(root));
    try{
      getWorkspaceRootPathByIdMock.mockResolvedValue(root);
      tasks.start({contract:{objective:'Hidden persistent goal',target:'.',constraints:[],acceptance:[{id:'v',description:'Check behavior',verification:{kind:'owner-receipt',owner:'fixture'}}]}},'agent:main:main','g','start');
      const gatewayManager={rpc:vi.fn(async(method:string)=>method==='sessions.describe'?{session:{sessionId:'g'}}:{runId:'quiet-run'}),getStatus:vi.fn(()=>({state:'running',gatewayReady:true}))};
      const {createChatApi}=await import('@electron/services/chat-api');
      await createChatApi({gatewayManager:gatewayManager as never}).sendWithMedia({sessionKey:'agent:main:main',workspaceId:'ws-app',message:'Continue the export fix.',idempotencyKey:'quiet-chat'});
      const request=(gatewayManager.rpc.mock.calls as unknown[][]).find(call=>call[0]==='chat.send')?.[1] as {message:string};
      expect(request.message).toBe('Continue the export fix.');
      expect(tasks.binding('agent:main:main','g')?.contract.objective).toBe('Hidden persistent goal');
    }finally{tasks.close();rmSync(root,{recursive:true,force:true});}
  });
  beforeEach(() => {
    loadTaskLedgerSnapshotMock.mockReset();
    getWorkspaceRootPathByIdMock.mockReset();
    getPersistedCoordinatorBindingMock.mockReset();
    getPersistedCoordinatorBindingMock.mockResolvedValue(null);
    materializeCoordinatorSessionGenerationMock.mockReset();
    materializeCoordinatorSessionGenerationMock.mockResolvedValue(null);
  });

  it('forwards workspaceId to Gateway rpcParams when renderer sends it', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue('C:\\Repos\\App');
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-ws-id' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      workspaceId: 'ws-app',
      message: 'Continue work',
      idempotencyKey: 'idem-ws-id',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload.workspaceId).toBe('ws-app');
  });

  it('produces workspaceFingerprint from workspace rootPath and forwards to Gateway', async () => {
    const rootPath = 'C:\\Repos\\App';
    getWorkspaceRootPathByIdMock.mockResolvedValue(rootPath);
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-ws-fp' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      workspaceId: 'ws-app',
      message: 'Continue work',
      idempotencyKey: 'idem-ws-fp',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload.workspaceId).toBe('ws-app');
    // Expected fingerprint: sha256 of lowercased absolute POSIX-style path, first 16 hex chars.
    const expected = computeExpectedFingerprint(rootPath);
    expect(payload.workspaceFingerprint).toBe(expected);
    expect(payload.workspaceFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('omits workspaceFingerprint when workspaceId is absent (no workspace scope)', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue(undefined);
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-no-ws' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Plain chat',
      idempotencyKey: 'idem-no-ws',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('workspaceId');
    expect(payload).not.toHaveProperty('workspaceFingerprint');
  });

  it('forwards workspaceId but omits workspaceFingerprint when rootPath lookup fails', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue(undefined);
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-ws-no-root' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      workspaceId: 'ws-orphan',
      message: 'Continue work',
      idempotencyKey: 'idem-ws-no-root',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    // workspaceId still forwarded so Gateway Task Ledger continuity is preserved.
    expect(payload.workspaceId).toBe('ws-orphan');
    // No fingerprint when rootPath cannot be resolved.
    expect(payload).not.toHaveProperty('workspaceFingerprint');
  });

  it('does not call getWorkspaceRootPathById when workspaceId is absent', async () => {
    getWorkspaceRootPathByIdMock.mockResolvedValue('C:\\Repos\\App');
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-no-lookup' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Plain chat',
      idempotencyKey: 'idem-no-lookup',
    });

    expect(getWorkspaceRootPathByIdMock).not.toHaveBeenCalled();
  });

  it('uses the active coordinator environment and verified session generation', async () => {
    getPersistedCoordinatorBindingMock.mockResolvedValue(coordinatorBinding({
      environment: { kind: 'managed-worktree', canonicalRoot: coordinatorRoot, backend: 'git', branch: 'feature', detachedHead: false, setupProfile: null },
    }));
    getWorkspaceRootPathByIdMock.mockResolvedValue('C:\\Repos\\App');
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => method === 'sessions.describe' ? { session: { sessionId: 'generation-1' } } : { runId: 'run-coordinator' }),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });
    await api.sendWithMedia({ sessionKey: 'agent:main:main', workspaceId: 'ws-app', message: 'work', idempotencyKey: 'idem-coordinator' });
    const call = (gatewayManager.rpc.mock.calls as unknown[][]).find((entry) => entry[0] === 'chat.send');
    const payload = call?.[1] as Record<string, unknown>;
    expect(payload.workspaceDir).toBe(coordinatorRoot);
    expect(payload.workspaceFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(getWorkspaceRootPathByIdMock).not.toHaveBeenCalled();
  });

  it('fails closed for paused or generation-mismatched coordinator bindings', async () => {
    getPersistedCoordinatorBindingMock.mockResolvedValue(coordinatorBinding({ state: 'paused' }));
    const gatewayManager = { rpc: vi.fn(), getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })) };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });
    const paused = await api.sendWithMedia({ sessionKey: 'agent:main:main', workspaceId: 'ws-app', message: 'work', idempotencyKey: 'idem-paused' });
    expect(paused.success).toBe(false);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    getPersistedCoordinatorBindingMock.mockResolvedValueOnce(coordinatorBinding({ sessionGeneration: 'generation-old' }));
    gatewayManager.rpc.mockResolvedValue({ session: { sessionId: 'generation-new' } });
    const mismatch = await api.sendWithMedia({ sessionKey: 'agent:main:main', workspaceId: 'ws-app', message: 'work', idempotencyKey: 'idem-mismatch' });
    expect(mismatch.success).toBe(false);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('chat.send', expect.anything(), expect.anything());
  });

  it('materializes a pending handoff generation after the first successful Chat send', async () => {
    getPersistedCoordinatorBindingMock.mockResolvedValue(coordinatorBinding({ sessionGeneration: null, bindingRevision: 2 }));
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => method === 'sessions.describe' ? { session: { sessionId: 'generation-child' } } : { runId: 'run-child' }),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });
    const result = await api.sendWithMedia({ sessionKey: 'agent:main:main', workspaceId: 'ws-app', message: 'first child turn', idempotencyKey: 'idem-child' });
    expect(result.success).toBe(true);
    expect(materializeCoordinatorSessionGenerationMock).toHaveBeenCalledWith({ workspaceId: 'ws-app', sessionKey: 'agent:main:main', sessionId: 'generation-child' });
  });

  it('forwards the ambient logical deadline to Gateway chat.send (NET-E)', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-deadline' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const { runWithHostDeadline } = await import('@electron/utils/host-deadline-context');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    const deadlineAtMs = Date.now() + 30_000;
    await runWithHostDeadline(
      { deadlineAtMs, timeoutMs: 30_000, stage: 'renderer', requestId: 'req-net-e' },
      () =>
        api.sendWithMedia({
          sessionKey: 'agent:main:main',
          message: 'Continue work',
          idempotencyKey: 'idem-deadline',
        }),
    );

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload.deadlineAtMs).toBe(deadlineAtMs);
  });

  it('omits deadlineAtMs when no logical deadline is ambient (NET-E)', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-no-deadline' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Continue work',
      idempotencyKey: 'idem-no-deadline',
    });

    const payload = (gatewayManager.rpc.mock.calls as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(payload.deadlineAtMs).toBeUndefined();
  });
});
