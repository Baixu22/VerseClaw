import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

vi.mock('@/components/topics/TopicSelector', () => ({
  TopicSelector: () => null,
}));

vi.mock('@/components/topics/TopicManager', () => ({
  TopicManager: () => null,
}));

function workspace(overrides: Partial<WorkspaceProfile> = {}): WorkspaceProfile {
  return {
    id: 'workspace-a',
    name: 'Workspace A',
    rootPath: 'C:/a',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: 'agent:main:a-session',
    agentBindings: {
      main: {
        workspaceId: 'workspace-a',
        agentId: 'main',
        sessionKey: 'agent:main:a-session',
      },
    },
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: {
      'agent:main:a-session': { draftInput: 'a draft' },
    },
    ...overrides,
  };
}

describe('resolveWorkspaceSessionTarget', () => {
  it('inherits the current agent when switching workspace', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const { resolveWorkspaceSessionTarget } = await import('@/pages/Chat');

    expect(resolveWorkspaceSessionTarget(workspace(), 'reviewer')).toEqual({
      agentId: 'reviewer',
      sessionKey: 'agent:reviewer:session-12345-4fzyo8',
      isFresh: true,
    });
  });

  it('uses the current agent binding inside the target workspace when present', async () => {
    const { resolveWorkspaceSessionTarget } = await import('@/pages/Chat');

    expect(resolveWorkspaceSessionTarget(workspace({
      selectedAgentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:r-session',
      agentBindings: {
        main: {
          workspaceId: 'workspace-a',
          agentId: 'main',
          sessionKey: 'agent:main:a-session',
        },
        reviewer: {
          workspaceId: 'workspace-a',
          agentId: 'reviewer',
          sessionKey: 'agent:reviewer:r-session',
        },
      },
    }), 'reviewer')).toEqual({
      agentId: 'reviewer',
      sessionKey: 'agent:reviewer:r-session',
      isFresh: false,
    });
  });

  it('creates a fresh workspace-scoped session when the current agent has no binding', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const { resolveWorkspaceSessionTarget } = await import('@/pages/Chat');

    expect(resolveWorkspaceSessionTarget(workspace({
      selectedAgentId: 'reviewer',
      activeSessionKey: 'agent:main:a-session',
      agentBindings: {},
    }), 'main')).toEqual({
      agentId: 'main',
      sessionKey: 'agent:main:session-12345-4fzyo8',
      isFresh: true,
    });
  });
});

describe('resolveWorkspaceHeaderSessions', () => {
  it('only shows sessions that belong to the active workspace and current agent', async () => {
    const { resolveWorkspaceHeaderSessions } = await import('@/pages/Chat');

    const result = resolveWorkspaceHeaderSessions({
      currentSessionKey: 'agent:main:workspace-b',
      workspaceSessionKeys: ['agent:main:workspace-b', 'agent:main:workspace-b-older'],
      sessions: [
        { key: 'agent:main:workspace-a', displayName: 'Workspace A stale session' },
        { key: 'agent:main:workspace-b', displayName: 'Workspace B current session' },
        { key: 'agent:main:workspace-b-older', displayName: 'Workspace B older session' },
        { key: 'agent:reviewer:workspace-b', displayName: 'Reviewer session' },
      ],
    });

    expect(result.map((session) => session.key)).toEqual([
      'agent:main:workspace-b-older',
      'agent:main:workspace-b',
    ]);
  });

  it('keeps the current session visible while its backend summary is still loading', async () => {
    const { resolveWorkspaceHeaderSessions } = await import('@/pages/Chat');

    const result = resolveWorkspaceHeaderSessions({
      currentSessionKey: 'agent:main:fresh-session',
      workspaceSessionKeys: [],
      sessions: [
        { key: 'agent:main:other-workspace', displayName: 'Other workspace' },
      ],
    });

    expect(result).toEqual([
      { key: 'agent:main:fresh-session', displayName: 'fresh-session' },
    ]);
  });

  it('names fresh workspace sessions with the new session label format', async () => {
    const { resolveWorkspaceHeaderSessions } = await import('@/pages/Chat');

    const result = resolveWorkspaceHeaderSessions({
      currentSessionKey: 'agent:main:session-1711111111111-abc123',
      workspaceSessionKeys: [],
      sessions: [],
    });

    expect(result).toEqual([
      { key: 'agent:main:session-1711111111111-abc123', displayName: 'new session 1711111111111-abc123' },
    ]);
  });
});
