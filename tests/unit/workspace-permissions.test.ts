import { describe, expect, it } from 'vitest';
import {
  classifyGatewayRpcRisk,
  classifyWorkspaceCommand,
  decideGatewayRpc,
  decideWorkspaceCommand,
  decideWorkspaceFileWrite,
  DEFAULT_WORKSPACE_PERMISSION_MODE,
  isDevOnlyGatewayRpc,
  isDevOnlyGatewayRpcEnabled,
  isPathInsideWorkspace,
} from '@electron/services/workspace-permissions';
import { normalizeWorkspacePermissionMode } from '@shared/types/workspace';
import { mapWorkspacePermissionToExecApproval } from '@electron/utils/workspace-runtime-permissions';
import type { WorkspaceProfile } from '@shared/types/workspace';

function workspace(permissionMode: WorkspaceProfile['permissionMode'] = 'acceptEdits'): WorkspaceProfile {
  return {
    id: 'w1',
    name: 'Project',
    rootPath: 'C:/project',
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

describe('workspace permission policy', () => {
  it('classifies common read, write, network, and destructive commands', () => {
    expect(classifyWorkspaceCommand('git status')).toBe('read');
    expect(classifyWorkspaceCommand('rg TODO .')).toBe('read');
    expect(classifyWorkspaceCommand('mkdir dist')).toBe('write');
    expect(classifyWorkspaceCommand('curl https://example.com')).toBe('network');
    expect(classifyWorkspaceCommand('pnpm install')).toBe('network');
    expect(classifyWorkspaceCommand('Remove-Item .\\dist -Recurse -Force')).toBe('destructive');
  });

  it('blocks mutating commands in read-only mode', () => {
    expect(decideWorkspaceCommand('pnpm install', 'readOnly')).toMatchObject({
      allowed: false,
      risk: 'network',
    });
  });

  it('requires approval for risky commands in accept-edits mode', () => {
    expect(decideWorkspaceCommand('git clean -fd', 'acceptEdits')).toMatchObject({
      allowed: false,
      requiresApproval: true,
      risk: 'destructive',
    });
    expect(decideWorkspaceCommand('curl https://example.com', 'acceptEdits')).toMatchObject({
      allowed: false,
      requiresApproval: true,
      risk: 'network',
    });
  });

  it('maps workspace modes to OpenClaw exec approval config', () => {
    expect(mapWorkspacePermissionToExecApproval('readOnly')).toEqual({ security: 'allowlist', ask: 'always' });
    expect(mapWorkspacePermissionToExecApproval('plan')).toEqual({ security: 'deny', ask: 'always' });
    expect(mapWorkspacePermissionToExecApproval('acceptEdits')).toEqual({ security: 'allowlist', ask: 'on-miss' });
    expect(mapWorkspacePermissionToExecApproval('fullAccess')).toEqual({ security: 'full', ask: 'off' });
  });

  it('checks whether a path stays inside the workspace', () => {
    expect(isPathInsideWorkspace('C:/project/src/index.ts', 'C:/project')).toBe(true);
    expect(isPathInsideWorkspace('C:/other/index.ts', 'C:/project')).toBe(false);
  });

  it('applies workspace modes to file writes', () => {
    expect(decideWorkspaceFileWrite('C:/project/src/index.ts', workspace())).toMatchObject({
      allowed: true,
      risk: 'write',
    });
    expect(decideWorkspaceFileWrite('C:/other/index.ts', workspace())).toMatchObject({
      allowed: false,
      requiresApproval: true,
      risk: 'external-write',
    });
    expect(decideWorkspaceFileWrite('C:/project/src/index.ts', workspace('readOnly'))).toMatchObject({
      allowed: false,
      risk: 'write',
    });
    expect(decideWorkspaceFileWrite('C:/project/src/index.ts', workspace('plan'))).toMatchObject({
      allowed: false,
      risk: 'write',
    });
  });

  it('classifies gateway RPC methods conservatively', () => {
    expect(classifyGatewayRpcRisk('chat.history')).toBe('read');
    expect(classifyGatewayRpcRisk('chat.send')).toBe('read');
    expect(classifyGatewayRpcRisk('tools.exec', { command: 'git clean -fd' })).toBe('destructive');
    expect(classifyGatewayRpcRisk('tools.exec', { command: 'curl https://example.com' })).toBe('network');
    expect(decideGatewayRpc('tools.exec', 'acceptEdits', { command: 'git clean -fd' })).toMatchObject({
      allowed: false,
      requiresApproval: true,
      risk: 'destructive',
    });
    expect(decideGatewayRpc('tools.exec', 'readOnly', { command: 'pwd' })).toMatchObject({
      allowed: false,
    });
  });

  it('keeps the dev/test-only gateway RPC guard mechanism with an empty method set', () => {
    expect(isDevOnlyGatewayRpc('session.mcp.warm')).toBe(false);
    expect(isDevOnlyGatewayRpcEnabled('session.mcp.warm')).toBe(true);
    expect(classifyGatewayRpcRisk('session.mcp.warm')).toBe('write');
    expect(decideGatewayRpc('session.mcp.warm', 'fullAccess', { sessionKey: 'agent:main:test' })).toMatchObject({
      allowed: true,
      risk: 'write',
    });
  });

  it('defaults new/untrusted workspace permission mode to readOnly (P2-001 / F-AUTH-001)', () => {
    expect(DEFAULT_WORKSPACE_PERMISSION_MODE).toBe('readOnly');
    expect(normalizeWorkspacePermissionMode(undefined)).toBe('readOnly');
    expect(normalizeWorkspacePermissionMode(null)).toBe('readOnly');
    expect(normalizeWorkspacePermissionMode('bogus')).toBe('readOnly');
    // Migration must not silently loosen valid restricted modes or invent acceptEdits.
    expect(normalizeWorkspacePermissionMode('plan')).toBe('plan');
    expect(normalizeWorkspacePermissionMode('acceptEdits')).toBe('acceptEdits');
  });

  it('covers write decisions across permission modes for files and commands', () => {
    // files
    expect(decideWorkspaceFileWrite('C:/project/a.ts', workspace('readOnly'))).toMatchObject({ allowed: false });
    expect(decideWorkspaceFileWrite('C:/project/a.ts', workspace('plan'))).toMatchObject({ allowed: false });
    expect(decideWorkspaceFileWrite('C:/project/a.ts', workspace('acceptEdits'))).toMatchObject({ allowed: true, risk: 'write' });
    expect(decideWorkspaceFileWrite('C:/other/a.ts', workspace('acceptEdits'))).toMatchObject({
      allowed: false,
      requiresApproval: true,
      risk: 'external-write',
    });
    // commands / gateway (entry points share these decision helpers)
    expect(decideWorkspaceCommand('mkdir dist', 'readOnly')).toMatchObject({ allowed: false });
    expect(decideWorkspaceCommand('mkdir dist', 'plan')).toMatchObject({ allowed: false });
    expect(decideWorkspaceCommand('mkdir dist', 'acceptEdits')).toMatchObject({ allowed: true, risk: 'write' });
    expect(decideWorkspaceCommand('git clean -fd', 'acceptEdits')).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
    expect(decideGatewayRpc('config.set', 'readOnly')).toMatchObject({ allowed: false });
    expect(decideGatewayRpc('config.set', 'acceptEdits')).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
  });

});
