import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';

import type { WorkspaceProfile } from '@shared/types/workspace';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
  decisionEvents: [] as unknown[],
}));

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
}));

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: fsMocks.existsSync,
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: childProcessMocks.spawn,
  };
});

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[]; decisionEvents?: unknown[] } }) {
      if (storeState.approvals.length === 0 && options?.defaults?.approvals) {
        storeState.approvals = [...options.defaults.approvals];
      }
      if (storeState.decisionEvents.length === 0 && options?.defaults?.decisionEvents) {
        storeState.decisionEvents = [...options.defaults.decisionEvents];
      }
    }

    get(key: string) {
      if (key === 'approvals') return storeState.approvals;
      if (key === 'decisionEvents') return storeState.decisionEvents;
      return undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') {
        storeState.approvals = Array.isArray(value) ? [...value] : [];
      }
      if (key === 'decisionEvents') {
        storeState.decisionEvents = Array.isArray(value) ? [...value] : [];
      }
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

function workspace(permissionMode: WorkspaceProfile['permissionMode'] = 'acceptEdits'): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: process.cwd(),
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

function gatewayManager(rpc = vi.fn()) {
  return {
    rpc,
  };
}

describe('terminal api OpenClaw exec integration', () => {
  beforeEach(() => {
    setSandboxHighRiskPolicyLoader(async () => ({
      degraded: false,
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }));
    storeState.approvals = [];
    storeState.decisionEvents = [];
    activeWorkspace.profile = workspace();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.existsSync.mockClear();
    childProcessMocks.spawn.mockClear();
  });

  it('delegates allowed terminal commands to OpenClaw/Gateway instead of spawning a local shell', async () => {
    const rpc = vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: 'ok' });
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const api = createTerminalApi({ gatewayManager: gatewayManager(rpc) as never });

    await expect(api.run({ command: 'pwd' })).resolves.toMatchObject({
      success: true,
      stdout: 'ok',
      exitCode: 0,
    });

    expect(rpc).toHaveBeenCalledWith('terminal.run', {
      command: 'pwd',
      cwd: process.cwd(),
      workdir: process.cwd(),
    }, 30_000);
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it('tries compatible OpenClaw exec RPC names and never falls back to PowerShell', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new Error('unknown method: terminal.run'))
      .mockRejectedValueOnce(new Error('unknown method: shell.run'))
      .mockResolvedValueOnce({ ok: true, code: 0, output: 'from exec.run' });
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const api = createTerminalApi({ gatewayManager: gatewayManager(rpc) as never });

    await expect(api.run({ command: 'git status' })).resolves.toMatchObject({
      success: true,
      stdout: 'from exec.run',
    });

    expect(rpc).toHaveBeenNthCalledWith(1, 'terminal.run', expect.any(Object), 30_000);
    expect(rpc).toHaveBeenNthCalledWith(2, 'shell.run', expect.any(Object), 30_000);
    expect(rpc).toHaveBeenNthCalledWith(3, 'exec.run', expect.any(Object), 30_000);
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it('returns an explicit unavailable result when OpenClaw exposes no direct terminal RPC', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('unknown method'));
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const api = createTerminalApi({ gatewayManager: gatewayManager(rpc) as never });

    await expect(api.run({ command: 'pwd' })).resolves.toMatchObject({
      success: false,
      blocked: false,
      reason: expect.stringContaining('当前 OpenClaw 运行时未暴露直接终端执行 RPC'),
    });

    expect(rpc).toHaveBeenCalledTimes(4);
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it('requires approval for dangerous commands before delegating to OpenClaw', async () => {
    const rpc = vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: 'cleaned' });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const api = createTerminalApi({ gatewayManager: gatewayManager(rpc) as never });
    const permissions = createPermissionsApi();

    const first = await api.run({ command: 'git clean -fd' });
    expect(first).toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
      reason: 'Accept-edits mode requires approval for high-risk commands',
    });
    expect(rpc).not.toHaveBeenCalled();

    const approvalId = first.approval?.id;
    expect(approvalId).toBeTruthy();
    if (!approvalId) throw new Error('Expected approval id');
    await expect(permissions.decideApproval({
      id: approvalId,
      decision: 'approved',
    })).resolves.toMatchObject({ success: true });

    await expect(api.run({ command: 'git clean -fd', approvalId })).resolves.toMatchObject({
      success: true,
      stdout: 'cleaned',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it('records a bounded diagnostic for failed approved terminal commands', async () => {
    const rpc = vi.fn().mockResolvedValue({ success: false, exitCode: 1, stdout: '', stderr: 'private failure' });
    const { createHostTraceDiagnosticsService } = await import('@electron/services/host-trace-diagnostics');
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const traceDiagnostics = createHostTraceDiagnosticsService({ secret: new Uint8Array(32).fill(9) });
    const api = createTerminalApi({
      gatewayManager: gatewayManager(rpc) as never,
      traceDiagnostics,
    });
    const permissions = createPermissionsApi();

    const first = await api.run({ command: 'git clean -fd' });
    const approvalId = first.approval?.id;
    expect(approvalId).toBeTruthy();
    if (!approvalId) throw new Error('Expected approval id');
    await permissions.decideApproval({ id: approvalId, decision: 'approved' });

    await expect(api.run({ command: 'git clean -fd', approvalId })).resolves.toMatchObject({
      success: false,
      exitCode: 1,
    });

    const records = traceDiagnostics.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.summary.failureKind).toBe('runtime');
    expect(records[0]?.summary.exitCode).toBe(1);
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain('git clean -fd');
    expect(serialized).not.toContain('private failure');
  });

  it.each([
    [{ success: false, code: 'ENOENT', exitCode: 1 }, 'tool_missing'],
    [{ success: false, code: 'EACCES', exitCode: 1 }, 'permission'],
    [{ success: false, timedOut: true, exitCode: null }, 'timeout'],
    [{ success: false, cancelled: true, exitCode: null }, 'cancelled'],
  ] as const)('maps safe Gateway failure metadata to %s', async (gatewayResult, failureKind) => {
    const rpc = vi.fn().mockResolvedValue(gatewayResult);
    const { createHostTraceDiagnosticsService } = await import('@electron/services/host-trace-diagnostics');
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const traceDiagnostics = createHostTraceDiagnosticsService({ secret: new Uint8Array(32).fill(10) });
    const api = createTerminalApi({
      gatewayManager: gatewayManager(rpc) as never,
      traceDiagnostics,
    });
    const permissions = createPermissionsApi();

    const first = await api.run({ command: 'git clean -fd' });
    const approvalId = first.approval?.id;
    if (!approvalId) throw new Error('Expected approval id');
    await permissions.decideApproval({ id: approvalId, decision: 'approved' });
    await api.run({ command: 'git clean -fd', approvalId });

    expect(traceDiagnostics.records()[0]?.summary.failureKind).toBe(failureKind);
    expect(JSON.stringify(traceDiagnostics.records()[0])).not.toContain('ENOENT');
  });

  it('does not record successful approved terminal commands', async () => {
    const rpc = vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: 'ok' });
    const { createHostTraceDiagnosticsService } = await import('@electron/services/host-trace-diagnostics');
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const traceDiagnostics = createHostTraceDiagnosticsService({ secret: new Uint8Array(32).fill(8) });
    const api = createTerminalApi({
      gatewayManager: gatewayManager(rpc) as never,
      traceDiagnostics,
    });
    const permissions = createPermissionsApi();

    const first = await api.run({ command: 'git clean -fd' });
    const approvalId = first.approval?.id;
    if (!approvalId) throw new Error('Expected approval id');
    await permissions.decideApproval({ id: approvalId, decision: 'approved' });
    await expect(api.run({ command: 'git clean -fd', approvalId })).resolves.toMatchObject({
      success: true,
    });

    expect(traceDiagnostics.records()).toHaveLength(0);
  });

  it('blocks mutating commands in read-only mode before reaching Gateway', async () => {
    activeWorkspace.profile = workspace('readOnly');
    const rpc = vi.fn();
    const { createTerminalApi } = await import('@electron/services/terminal-api');
    const { listPermissionDecisionEvents } = await import('@electron/services/permissions-api');
    const api = createTerminalApi({ gatewayManager: gatewayManager(rpc) as never });

    await expect(api.run({ command: 'pnpm install' })).resolves.toMatchObject({
      success: false,
      blocked: true,
      reason: 'Read-only mode only allows inspection commands',
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
    await expect(listPermissionDecisionEvents(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'permission-decision',
        workspaceMode: 'readOnly',
        tool: 'terminal.run',
        boundary: 'workspace-command',
        decision: 'deny',
      }),
    ]));
  });
});
