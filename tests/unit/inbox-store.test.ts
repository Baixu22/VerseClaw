import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBrowserTask } from '@shared/host-api/contract';
import type { RemoteTaskRecord } from '@shared/types/remote-tasks';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

const mocks = vi.hoisted(() => ({
  approvals: vi.fn(),
  decideApproval: vi.fn(),
  remoteList: vi.fn(),
  remoteApprove: vi.fn(),
  remoteReject: vi.fn(),
  remoteExecute: vi.fn(),
  remotePreview: vi.fn(),
  browserTasks: vi.fn(),
  browserApprove: vi.fn(),
  browserReject: vi.fn(),
  gatewayRpc: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    permissions: {
      approvals: mocks.approvals,
      decideApproval: mocks.decideApproval,
    },
    remoteTasks: {
      list: mocks.remoteList,
      approve: mocks.remoteApprove,
      reject: mocks.remoteReject,
      execute: mocks.remoteExecute,
      preview: mocks.remotePreview,
    },
    agentBrowser: {
      tasks: mocks.browserTasks,
      approveTask: mocks.browserApprove,
      rejectTask: mocks.browserReject,
    },
    gateway: {
      rpc: mocks.gatewayRpc,
    },
  },
}));

import {
  isInboxItemActionable,
  projectInboxItems,
  useInboxStore,
} from '@/stores/inbox';

const approval: PermissionApprovalEvent = {
  id: 'approval-1',
  workspaceId: 'workspace-1',
  sessionKey: 'session-1',
  mode: 'readOnly',
  source: 'git',
  requestedAt: Date.parse('2026-07-31T10:00:00.000Z'),
  status: 'pending',
  risk: 'external-write',
  command: 'git push origin main',
  reason: 'Push the reviewed branch',
  // Production builds this from the request itself (git-api.ts createRequestHash),
  // so the fixture has to carry it or the redaction guard proves nothing.
  requestHash: 'workspace-1:session-1:git:push:{"command":"git push origin main","paths":[]}',
};

const remoteTask: RemoteTaskRecord = {
  id: 'remote-1',
  source: 'channel',
  status: 'pendingApproval',
  command: { kind: 'settingsPatch', patch: { theme: 'dark' } },
  reason: 'Apply the requested theme',
  createdAt: '2026-07-31T10:01:00.000Z',
  updatedAt: '2026-07-31T10:01:00.000Z',
};

const browserTask: AgentBrowserTask = {
  id: 'browser-1',
  name: 'Check release notes',
  url: 'https://example.com/releases',
  objective: 'Verify the latest release heading',
  profile: 'work',
  mode: 'visible',
  allowedDomains: ['example.com'],
  permissionScope: ['navigate', 'read-page', 'interact-page'],
  steps: [{ id: 'step-1', action: 'click', selector: 'a.release', status: 'pending' }],
  successCriteria: { kind: 'selector-visible', value: 'h1' },
  approval: { status: 'pending', requestedAt: '2026-07-31T10:02:00.000Z' },
  counters: { totalSteps: 1, passedSteps: 0, failedSteps: 0 },
  status: 'waiting-approval',
  retryCount: 0,
  createdAt: '2026-07-31T10:02:00.000Z',
  updatedAt: '2026-07-31T10:02:00.000Z',
};

describe('Inbox store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInboxStore.setState({
      items: [],
      loading: false,
      loaded: false,
      busyKey: null,
      sourceErrors: {},
      lastUpdatedAt: null,
    });
    mocks.approvals.mockResolvedValue({ success: true, approvals: [] });
    mocks.remoteList.mockResolvedValue({ success: true, tasks: [], generatedAt: '2026-07-31T10:00:00.000Z' });
    mocks.browserTasks.mockResolvedValue({ success: true, tasks: [] });
    mocks.remotePreview.mockResolvedValue({ success: true, requiresApproval: false, changes: [] });
    mocks.gatewayRpc.mockResolvedValue({ intents: [] });
  });

  it('projects the three backend models into constrained actionable item variants', () => {
    const items = projectInboxItems({ approvals: [approval], remoteTasks: [remoteTask], browserTasks: [browserTask] });

    expect(items.map((item) => item.source)).toEqual(['browser-task', 'remote-task', 'permission']);
    expect(items.every(isInboxItemActionable)).toBe(true);
    expect(items.find((item) => item.source === 'permission')?.actions).toEqual(['approve', 'deny']);
    expect(items.find((item) => item.source === 'remote-task')?.actions).toEqual(['approve', 'reject']);
    expect(items.find((item) => item.source === 'browser-task')?.actions).toEqual(['approve-and-run', 'reject']);
    expect(items.find((item) => item.source === 'browser-task')?.risk).toBe('external-write');
  });

  it('redacts external-write details from the Inbox projection', () => {
    const projected = projectInboxItems({ approvals: [approval] })[0];
    expect(projected).toMatchObject({
      source: 'permission',
      title: 'git',
      summary: undefined,
      evidence: [],
    });
    expect(JSON.stringify(projected)).not.toContain('git push origin main');
    expect(JSON.stringify(projected)).not.toContain('Push the reviewed branch');
    expect(JSON.stringify(projected)).not.toContain('command');
    expect(JSON.stringify(projected)).not.toContain('requestHash');
    expect((projected as { approval: PermissionApprovalEvent }).approval.command).toBeUndefined();
    expect((projected as { approval: PermissionApprovalEvent }).approval.requestHash).toBeUndefined();
  });

  it('keeps successful sources when one Inbox source fails', async () => {
    mocks.approvals.mockRejectedValue(new Error('permission store unavailable'));
    mocks.remoteList.mockResolvedValue({ success: true, tasks: [remoteTask], generatedAt: '2026-07-31T10:03:00.000Z' });
    mocks.browserTasks.mockResolvedValue({ success: true, tasks: [browserTask] });
    mocks.gatewayRpc.mockRejectedValue(new Error('operator intents unavailable'));

    await useInboxStore.getState().refresh();

    const state = useInboxStore.getState();
    expect(state.items).toHaveLength(2);
    expect(state.sourceErrors.permission).toBe('permission store unavailable');
    expect(state.sourceErrors.operator).toBe('operator intents unavailable');
    expect(state.loaded).toBe(true);
  });

  it('refreshes aggregate state immediately after a permission decision', async () => {
    let pending = true;
    mocks.approvals.mockImplementation(async () => ({ success: true, approvals: pending ? [approval] : [] }));
    mocks.decideApproval.mockImplementation(async () => {
      pending = false;
      return { success: true, approval: { ...approval, status: 'approved' } };
    });

    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().items.filter(isInboxItemActionable)).toHaveLength(1);

    await useInboxStore.getState().decidePermission(approval.id, 'approved');

    expect(mocks.decideApproval).toHaveBeenCalledWith({ id: approval.id, decision: 'approved' });
    expect(useInboxStore.getState().items.filter(isInboxItemActionable)).toHaveLength(0);
    expect(useInboxStore.getState().busyKey).toBeNull();
  });
});
