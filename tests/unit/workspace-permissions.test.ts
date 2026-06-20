import { describe, expect, it } from 'vitest';
import {
  classifyGatewayRpcRisk,
  classifyWorkspaceCommand,
  decideGatewayRpc,
  decideWorkspaceCommand,
  decideWorkspaceFileWrite,
  isDevOnlyGatewayRpc,
  isDevOnlyGatewayRpcEnabled,
  isPathInsideWorkspace,
} from '@electron/services/workspace-permissions';
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
    expect(mapWorkspacePermissionToExecApproval('acceptEdits')).toEqual({ security: 'allowlist', ask: 'dangerous' });
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
});
