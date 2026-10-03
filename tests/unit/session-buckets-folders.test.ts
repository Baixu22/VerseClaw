import { describe, expect, it } from 'vitest';
import { buildSidebarWorkspaceFolderGroups, collectFolderSessionKeys } from '@/components/layout/session-buckets';
import type { ChatSession } from '@/stores/chat';
import type { SessionFolder } from '@shared/types/workspace';

function makeSession(key: string, updatedAt?: number): ChatSession {
  return { key, displayName: key, updatedAt };
}

function makeEntry(session: ChatSession, activityMs?: number) {
  return { session, activityMs: activityMs ?? session.updatedAt ?? 0 };
}

function makeFolder(id: string, name: string, parentId: string | null = null, order = 0): SessionFolder {
  return { id, name, parentId, order, createdAt: order, updatedAt: order };
}

describe('buildSidebarWorkspaceFolderGroups', () => {
  it('places all sessions in rootSessions when there are no folders', () => {
    const sessions = [makeEntry(makeSession('a', 3)), makeEntry(makeSession('b', 1))];
    const result = buildSidebarWorkspaceFolderGroups({
      sessions,
      folders: [],
      assignments: {},
    });
    expect(result.rootSessions.map((e) => e.session.key)).toEqual(['a', 'b']);
    expect(result.folders).toEqual([]);
  });

  it('sorts root sessions by activity descending', () => {
    const sessions = [makeEntry(makeSession('a', 1)), makeEntry(makeSession('b', 5)), makeEntry(makeSession('c', 3))];
    const result = buildSidebarWorkspaceFolderGroups({
      sessions,
      folders: [],
      assignments: {},
    });
    expect(result.rootSessions.map((e) => e.session.key)).toEqual(['b', 'c', 'a']);
  });

  it('places assigned sessions into their folder and keeps unassigned in root', () => {
    const sessions = [
      makeEntry(makeSession('a', 1)),
      makeEntry(makeSession('b', 2)),
      makeEntry(makeSession('c', 3)),
    ];
    const folder = makeFolder('f1', 'Research');
    const result = buildSidebarWorkspaceFolderGroups({
      sessions,
      folders: [folder],
      assignments: { b: 'f1' },
    });
    expect(result.rootSessions.map((e) => e.session.key)).toEqual(['c', 'a']);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].folder.id).toBe('f1');
    expect(result.folders[0].sessions.map((e) => e.session.key)).toEqual(['b']);
  });

  it('preserves empty folders so the sidebar can render the shell', () => {
    const folder = makeFolder('f1', 'Empty');
    const result = buildSidebarWorkspaceFolderGroups({
      sessions: [makeEntry(makeSession('a', 1))],
      folders: [folder],
      assignments: {},
    });
    expect(result.rootSessions.map((e) => e.session.key)).toEqual(['a']);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].sessions).toEqual([]);
  });

  it('normalizes legacy sub-folders into independent root-level groups', () => {
    const root = makeFolder('root', 'Projects', null, 0);
    const child = makeFolder('child', 'Alpha', 'root', 0);
    const grandchild = makeFolder('grand', 'Deep', 'child', 0);
    const sessions = [
      makeEntry(makeSession('s1', 1)),
      makeEntry(makeSession('s2', 2)),
      makeEntry(makeSession('s3', 3)),
    ];
    const result = buildSidebarWorkspaceFolderGroups({
      sessions,
      folders: [root, child, grandchild],
      assignments: { s1: 'root', s2: 'child', s3: 'grand' },
    });
    expect(result.rootSessions).toEqual([]);
    expect(result.folders.map((node) => node.folder.id)).toEqual(['root', 'child', 'grand']);
    expect(result.folders.every((node) => node.folder.parentId === null)).toBe(true);
    expect(result.folders.every((node) => node.depth === 0 && node.children.length === 0)).toBe(true);
    expect(result.folders.map((node) => node.sessions.map((e) => e.session.key))).toEqual([
      ['s1'],
      ['s2'],
      ['s3'],
    ]);
  });

  it('falls back to rootSessions when assignment points to a non-existent folder', () => {
    const sessions = [makeEntry(makeSession('a', 1))];
    const result = buildSidebarWorkspaceFolderGroups({
      sessions,
      folders: [],
      assignments: { a: 'ghost-folder' },
    });
    expect(result.rootSessions.map((e) => e.session.key)).toEqual(['a']);
    expect(result.folders).toEqual([]);
  });

  it('orders folders by order then createdAt', () => {
    const f1 = makeFolder('f1', 'B', null, 2);
    const f2 = makeFolder('f2', 'A', null, 1);
    const f3 = makeFolder('f3', 'C', null, 3);
    const result = buildSidebarWorkspaceFolderGroups({
      sessions: [],
      folders: [f1, f2, f3],
      assignments: {},
    });
    expect(result.folders.map((f) => f.folder.id)).toEqual(['f2', 'f1', 'f3']);
  });

  it('collectFolderSessionKeys stays local to one root-level group', () => {
    const sessions = [
      makeEntry(makeSession('s1', 1)),
      makeEntry(makeSession('s2', 2)),
      makeEntry(makeSession('s3', 3)),
    ];
    const result = buildSidebarWorkspaceFolderGroups({
      sessions,
      folders: [makeFolder('root', 'R', null, 0), makeFolder('child', 'C', 'root', 0)],
      assignments: { s1: 'root', s2: 'child', s3: 'root' },
    });
    const keys = result.folders.flatMap(collectFolderSessionKeys);
    expect(keys.sort()).toEqual(['s1', 's2', 's3']);
  });
});
