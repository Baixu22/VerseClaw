import { describe, expect, it } from 'vitest';
import {
  buildLatestRuntimeRunBySession,
  buildSidebarTimeSessions,
  buildSidebarWorkspaceSessionGroups,
  compareSidebarSessionEntries,
  getSessionActivityMs,
  isSessionVisibleInWorkspace,
} from '@/components/layout/session-buckets';
import type { ChatRuntimeRunState } from '@/stores/chat';
import type { SidebarSessionEntry } from '@/components/layout/session-buckets';
import type { WorkspaceProfile } from '@shared/types/workspace';

function workspace(overrides: Partial<WorkspaceProfile>): WorkspaceProfile {
  return {
    id: 'workspace-a',
    name: 'Workspace A',
    rootPath: 'C:/a',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: 'agent:main:a-new',
    agentBindings: {
      main: {
        workspaceId: 'workspace-a',
        agentId: 'main',
        sessionKey: 'agent:main:a-new',
      },
    },
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: {
      'agent:main:a-new': {},
    },
    ...overrides,
  };
}

describe('sidebar latest runtime run index', () => {
  function run(overrides: Partial<ChatRuntimeRunState> & Pick<ChatRuntimeRunState, 'runId'>): ChatRuntimeRunState {
    return {
      status: 'completed',
      assistantText: '',
      thinkingText: '',
      events: [],
      ...overrides,
    };
  }

  it('selects the latest activity for each session in one index', () => {
    const latestBySession = buildLatestRuntimeRunBySession({
      oldA: run({ runId: 'old-a', sessionKey: 'agent:main:a', endedAt: 100 }),
      newA: run({ runId: 'new-a', sessionKey: 'agent:main:a', startedAt: 150 }),
      eventA: run({
        runId: 'event-a',
        sessionKey: 'agent:main:a',
        events: [{ type: 'run.started', runId: 'event-a', ts: 200 }],
      }),
      onlyB: run({ runId: 'only-b', sessionKey: 'agent:main:b', endedAt: 125 }),
      orphan: run({ runId: 'orphan', endedAt: 999 }),
    });

    expect(latestBySession.get('agent:main:a')?.runId).toBe('event-a');
    expect(latestBySession.get('agent:main:b')?.runId).toBe('only-b');
    expect([...latestBySession.keys()]).toEqual(['agent:main:a', 'agent:main:b']);
  });

  it('preserves the previous tie behavior by selecting the later iterated run', () => {
    const latestBySession = buildLatestRuntimeRunBySession({
      first: run({ runId: 'first', sessionKey: 'agent:main:a', endedAt: 100 }),
      second: run({ runId: 'second', sessionKey: 'agent:main:a', startedAt: 100 }),
    });

    expect(latestBySession.get('agent:main:a')?.runId).toBe('second');
  });
});

describe('sidebar session activity resolution', () => {
  it('uses the timestamp embedded in a locally-created session key as activity fallback', () => {
    const createdAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const session = {
      key: `agent:main:session-${createdAtMs}`,
      displayName: `agent:main:session-${createdAtMs}`,
    };

    const activityMs = getSessionActivityMs(session, {});

    expect(activityMs).toBe(createdAtMs);
  });

  it('prefers real message activity over backend metadata or key creation time', () => {
    const keyCreatedAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const updatedAtMs = new Date('2026-05-06T11:00:00.000Z').getTime();
    const messageActivityMs = new Date('2026-05-06T12:00:00.000Z').getTime();

    expect(getSessionActivityMs(
      {
        key: `agent:main:session-${keyCreatedAtMs}`,
        updatedAt: updatedAtMs,
      },
      { [`agent:main:session-${keyCreatedAtMs}`]: messageActivityMs },
    )).toBe(messageActivityMs);
  });

  it('returns 0 for unparseable session keys without updatedAt', () => {
    expect(getSessionActivityMs({ key: 'garbage' }, {})).toBe(0);
  });

  it('keeps sessions scoped to the current workspace and agent', () => {
    const workspaceSessionKeys = new Set([
      'agent:main:workspace-a',
      'agent:main:workspace-a-older',
      'agent:reviewer:workspace-a',
    ]);

    expect(isSessionVisibleInWorkspace({
      sessionKey: 'agent:main:workspace-a',
      currentSessionKey: 'agent:main:workspace-a',
      workspaceSessionKeys,
    })).toBe(true);
    expect(isSessionVisibleInWorkspace({
      sessionKey: 'agent:main:workspace-b',
      currentSessionKey: 'agent:main:workspace-a',
      workspaceSessionKeys,
    })).toBe(false);
    expect(isSessionVisibleInWorkspace({
      sessionKey: 'agent:reviewer:workspace-a',
      currentSessionKey: 'agent:main:workspace-a',
      workspaceSessionKeys,
    })).toBe(false);
  });

  it('groups sessions by workspace recency and sorts each project by activity', () => {
    const groups = buildSidebarWorkspaceSessionGroups({
      currentSessionKey: 'agent:main:a-new',
      sessionLastActivity: {
        'agent:main:a-old': 100,
        'agent:main:a-new': 300,
        'agent:main:b-newest': 500,
        'agent:main:b-old': 200,
      },
      sessions: [
        { key: 'agent:main:a-old', displayName: 'A old' },
        { key: 'agent:main:a-new', displayName: 'A new' },
        { key: 'agent:main:b-old', displayName: 'B old' },
        { key: 'agent:main:b-newest', displayName: 'B newest' },
      ],
      workspaces: [
        workspace({
          id: 'workspace-a',
          name: 'Workspace A',
          activeSessionKey: 'agent:main:a-new',
          sessionStates: {
            'agent:main:a-old': {},
            'agent:main:a-new': {},
          },
        }),
        workspace({
          id: 'workspace-b',
          name: 'Workspace B',
          rootPath: 'C:/b',
          activeSessionKey: 'agent:main:b-newest',
          agentBindings: {
            main: {
              workspaceId: 'workspace-b',
              agentId: 'main',
              sessionKey: 'agent:main:b-newest',
            },
          },
          sessionStates: {
            'agent:main:b-old': {},
            'agent:main:b-newest': {},
          },
        }),
      ],
    });

    expect(groups.map((group) => group.workspace.id)).toEqual(['workspace-b', 'workspace-a']);
    expect(groups[0]?.sessions.map((entry) => entry.session.key)).toEqual([
      'agent:main:b-newest',
      'agent:main:b-old',
    ]);
    expect(groups[1]?.sessions.map((entry) => entry.session.key)).toEqual([
      'agent:main:a-new',
      'agent:main:a-old',
    ]);
  });

  it('builds the time view as one activity-sorted list across projects', () => {
    const entries = buildSidebarTimeSessions({
      currentSessionKey: 'agent:main:a-new',
      sessionLastActivity: {
        'agent:main:a-new': 300,
        'agent:main:b-newest': 500,
        'agent:main:b-old': 200,
        'agent:reviewer:b': 900,
      },
      sessions: [
        { key: 'agent:main:a-new', displayName: 'A new' },
        { key: 'agent:main:b-old', displayName: 'B old' },
        { key: 'agent:main:b-newest', displayName: 'B newest' },
        { key: 'agent:reviewer:b', displayName: 'Reviewer B' },
        { key: 'agent:main:not-in-workspace', displayName: 'Other' },
      ],
      workspaces: [
        workspace({
          id: 'workspace-a',
          activeSessionKey: 'agent:main:a-new',
          sessionStates: { 'agent:main:a-new': {} },
        }),
        workspace({
          id: 'workspace-b',
          activeSessionKey: 'agent:main:b-newest',
          agentBindings: {
            main: {
              workspaceId: 'workspace-b',
              agentId: 'main',
              sessionKey: 'agent:main:b-newest',
            },
          },
          sessionStates: {
            'agent:main:b-old': {},
            'agent:main:b-newest': {},
            'agent:reviewer:b': {},
          },
        }),
      ],
    });

    expect(entries.map((entry) => entry.session.key)).toEqual([
      'agent:main:b-newest',
      'agent:main:a-new',
      'agent:main:b-old',
    ]);
  });

  it('renders a duplicated legacy session in only one project', () => {
    const duplicated = 'agent:main:duplicated';
    const groups = buildSidebarWorkspaceSessionGroups({
      currentSessionKey: duplicated,
      sessionLastActivity: { [duplicated]: 10 },
      sessions: [{ key: duplicated, displayName: 'Duplicated' }],
      workspaces: [
        workspace({
          id: 'workspace-a',
          activeSessionKey: duplicated,
          sessionStates: { [duplicated]: {} },
        }),
        workspace({
          id: 'workspace-b',
          activeSessionKey: duplicated,
          sessionStates: { [duplicated]: {} },
        }),
      ],
    });

    expect(groups.map((group) => group.workspace.id)).toEqual(['workspace-a']);
    expect(groups[0]?.sessions.map((entry) => entry.session.key)).toEqual([duplicated]);
  });

  it('keeps pinned sessions first and supports active and priority sorting', () => {
    const entry = (key: string, messageCount: number, activityMs: number, extras: Partial<SidebarSessionEntry> = {}) => ({
      session: { key, messageCount },
      activityMs,
      ...extras,
    });
    const active = [
      entry('agent:main:quiet', 2, 900),
      entry('agent:main:busy', 8, 100),
      entry('agent:main:pinned', 1, 1, { isPinned: true }),
    ].sort((left, right) => compareSidebarSessionEntries(left, right, 'active'));
    expect(active.map((item) => item.session.key)).toEqual([
      'agent:main:pinned',
      'agent:main:busy',
      'agent:main:quiet',
    ]);

    const priority = [
      entry('agent:main:old', 20, 900),
      entry('agent:main:waiting', 1, 100, { isPriority: true }),
    ].sort((left, right) => compareSidebarSessionEntries(left, right, 'priority'));
    expect(priority.map((item) => item.session.key)).toEqual([
      'agent:main:waiting',
      'agent:main:old',
    ]);
  });
});
