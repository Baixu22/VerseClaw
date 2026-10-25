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
  isGitMetadataPath,
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

  it('treats git config-injection and boundary-escape flags as destructive whatever the subcommand', () => {
    // -c can set core.pager / core.editor / alias.* to an arbitrary command, so
    // it is never safe even in front of a read-only subcommand.
    expect(classifyWorkspaceCommand('git -c core.pager=x status')).toBe('destructive');
    expect(classifyWorkspaceCommand('git -c alias.s=!sh s')).toBe('destructive');
    expect(classifyWorkspaceCommand('git --config-env=core.pager=EVIL status')).toBe('destructive');
    // --exec-path redirects where git resolves its own helper binaries.
    expect(classifyWorkspaceCommand('git --exec-path=/tmp/evil status')).toBe('destructive');
    // These move the operation outside the active workspace.
    expect(classifyWorkspaceCommand('git --git-dir=/other/repo status')).toBe('destructive');
    expect(classifyWorkspaceCommand('git --work-tree=/other status')).toBe('destructive');
    expect(classifyWorkspaceCommand('git -C /other/repo status')).toBe('destructive');
  });

  it('does not let a leading git global flag downgrade a destructive or network subcommand', () => {
    // Before subcommand-aware parsing these fell through to plain 'write',
    // because the \bgit\s+reset\b / \bgit\s+push\b patterns never matched.
    expect(classifyWorkspaceCommand('git -c x=y reset --hard')).toBe('destructive');
    expect(classifyWorkspaceCommand('git -c x=y clean -fd')).toBe('destructive');
    expect(classifyWorkspaceCommand('git -c x=y push')).toBe('destructive');
  });

  it('classifies worktree lifecycle commands without letting shell risk lag behind git-api', () => {
    expect(classifyWorkspaceCommand('git worktree list --porcelain')).toBe('read');
    expect(classifyWorkspaceCommand('git worktree add ../ClawX-feature -b feature')).toBe('write');
    expect(classifyWorkspaceCommand('git worktree add -b feature ../ClawX-feature')).toBe('write');
    expect(classifyWorkspaceCommand('git worktree add /tmp/external -b feature')).toBe('external-write');
    expect(classifyWorkspaceCommand('git worktree add ../../outside -b feature')).toBe('external-write');
    expect(classifyWorkspaceCommand('git worktree remove --force ../ClawX-feature')).toBe('destructive');
    expect(classifyWorkspaceCommand('git worktree prune')).toBe('destructive');

    expect(decideWorkspaceCommand('git worktree add /tmp/external -b feature', 'acceptEdits')).toMatchObject({
      allowed: false,
      requiresApproval: true,
      risk: 'external-write',
    });
    expect(decideWorkspaceCommand('git worktree remove --force ../ClawX-feature', 'acceptEdits')).toMatchObject({
      allowed: false,
      requiresApproval: true,
      risk: 'destructive',
    });
    expect(decideWorkspaceCommand('git worktree list --porcelain', 'readOnly')).toMatchObject({
      allowed: true,
      risk: 'read',
    });
  });

  it('keeps benign git invocations readable when global flags are absent or harmless', () => {
    expect(classifyWorkspaceCommand('git status')).toBe('read');
    expect(classifyWorkspaceCommand('git --no-pager status')).toBe('read');
    expect(classifyWorkspaceCommand('git --no-optional-locks status')).toBe('read');
    expect(classifyWorkspaceCommand('git diff')).toBe('read');
    // Real subcommand risk still applies once the flags are stripped.
    expect(classifyWorkspaceCommand('git push')).toBe('network');
    expect(classifyWorkspaceCommand('git reset --hard')).toBe('destructive');
  });

  it('stops treating a read subcommand as read-only once --output redirects to a file', () => {
    // Verified against git 2.51: these four forms each create AND truncate the
    // target, with no constraint on where it points, so a read subcommand can
    // overwrite a file outside the workspace.
    expect(classifyWorkspaceCommand('git diff --output=/tmp/escaped.txt')).toBe('write');
    expect(classifyWorkspaceCommand('git diff --output /tmp/escaped.txt')).toBe('write');
    expect(classifyWorkspaceCommand('git show --output=/tmp/escaped.txt HEAD')).toBe('write');
    expect(classifyWorkspaceCommand('git log --output=/tmp/escaped.txt')).toBe('write');
  });

  it('blocks a git --output write in read-only mode', () => {
    // readOnly mode allows 'read' with no further checks, so the classification
    // above is what actually stops the write.
    expect(decideWorkspaceCommand('git diff --output=/tmp/escaped.txt', 'readOnly')).toMatchObject({
      allowed: false,
      risk: 'write',
    });
    // Inspection must still work: the fix must not turn readOnly into a mode
    // that blocks reading.
    expect(decideWorkspaceCommand('git status', 'readOnly')).toMatchObject({
      allowed: true,
      risk: 'read',
    });
  });

  it('does not mistake look-alike git flags for an output redirect', () => {
    // Verified against git 2.51: --output-indicator-* only picks a display
    // character, and -o is not an alias for --output. Neither writes a file.
    expect(classifyWorkspaceCommand('git diff --output-indicator-new=X')).toBe('read');
    expect(classifyWorkspaceCommand('git diff --output-indicator-old=Y')).toBe('read');
    expect(classifyWorkspaceCommand('git diff -o /tmp/not-written.txt')).toBe('read');
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

  it('gates writes to Git repository metadata even inside the workspace', () => {
    // `.git/hooks/*` runs on the next commit and `.git/config` can point
    // core.pager / core.hooksPath / alias.* at an arbitrary command, so these
    // are not ordinary in-workspace edits.
    for (const target of [
      'C:/project/.git/config',
      'C:/project/.git/hooks/pre-commit',
      'C:/project/.git/HEAD',
      'C:/project/.git/refs/heads/main',
      // The bare `.git` pointer file a worktree/submodule uses: rewriting it
      // would redirect the real gitdir somewhere else.
      'C:/project/.git',
      // Nested repositories and submodules are covered too.
      'C:/project/vendor/dep/.git/config',
    ]) {
      expect(decideWorkspaceFileWrite(target, workspace())).toMatchObject({
        allowed: false,
        requiresApproval: true,
        risk: 'destructive',
      });
    }
  });

  it('does not treat git-adjacent project files as repository metadata', () => {
    expect(isGitMetadataPath('C:/project/.gitignore')).toBe(false);
    expect(isGitMetadataPath('C:/project/.gitattributes')).toBe(false);
    expect(isGitMetadataPath('C:/project/.github/workflows/ci.yml')).toBe(false);
    expect(isGitMetadataPath('C:/project/src/git/client.ts')).toBe(false);
    expect(isGitMetadataPath('C:/project/docs/gitops.md')).toBe(false);
    // These remain ordinary auto-accepted edits.
    expect(decideWorkspaceFileWrite('C:/project/.gitignore', workspace())).toMatchObject({
      allowed: true,
      risk: 'write',
    });
  });

  it('detects git metadata through backslash paths and case differences', () => {
    expect(isGitMetadataPath('C:\\project\\.git\\config')).toBe(true);
    expect(isGitMetadataPath('C:/project/.GIT/config')).toBe(true);
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
    expect(classifyGatewayRpcRisk('memory.surface')).toBe('read');
    expect(classifyGatewayRpcRisk('chat.send')).toBe('read');
    expect(classifyGatewayRpcRisk('memory.surface')).toBe('read');
    expect(classifyGatewayRpcRisk('memory.delete', { source: 'role-memory-card', id: 'card-1' })).toBe('destructive');
    expect(decideGatewayRpc('memory.delete', 'readOnly', { source: 'role-memory-card', id: 'card-1' })).toMatchObject({ allowed: false });
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
