/**
 * Workstream view helpers — lineage threading and time slices.
 * These pure functions carry the sidebar's flat-workstream restructuring
 * (docs/dev/session-workstreams-design.md); the component tests only cover
 * wiring, the semantics live here.
 */
import { describe, expect, it } from 'vitest';
import {
  flattenFolderNodes,
  sliceSessionsByTime,
  threadSessionsByLineage,
  workstreamColorIndex,
  type SidebarFolderNode,
  type SidebarSessionEntry,
} from '@/components/layout/session-buckets';

const entry = (key: string, parent?: string, activityMs = 0): SidebarSessionEntry => ({
  session: { key, displayName: key, parentSessionKey: parent },
  activityMs,
});

describe('threadSessionsByLineage', () => {
  it('attaches fork children beneath their origin, keeping incoming order elsewhere', () => {
    const rows = threadSessionsByLineage([
      entry('a'),
      entry('b'),
      entry('a-child', 'a'),
    ]);
    expect(rows.map((row) => [row.entry.session.key, row.lineageDepth])).toEqual([
      ['a', 0],
      ['a-child', 1],
      ['b', 0],
    ]);
    expect(rows[1].originKey).toBe('a');
  });

  it('collapses chains onto the topmost ancestor present (depth never exceeds 1)', () => {
    const rows = threadSessionsByLineage([
      entry('root'),
      entry('mid', 'root'),
      entry('leaf', 'mid'),
    ]);
    expect(rows.map((row) => [row.entry.session.key, row.lineageDepth])).toEqual([
      ['root', 0],
      ['mid', 1],
      ['leaf', 1],
    ]);
    expect(rows[2].originKey).toBe('root');
  });

  it('degrades to plain rows when the parent is missing or the chain loops', () => {
    const rows = threadSessionsByLineage([
      entry('orphan', 'not-in-list'),
      entry('loop-a', 'loop-b'),
      entry('loop-b', 'loop-a'),
    ]);
    // The orphan has no origin in the list; the loop pair resolve to each
    // other, which still yields a stable one-level attachment, never a hang.
    expect(rows.find((row) => row.entry.session.key === 'orphan')?.lineageDepth).toBe(0);
    expect(rows).toHaveLength(3);
  });
});

describe('sliceSessionsByTime', () => {
  const now = new Date('2026-08-11T15:00:00').getTime();

  it('splits into today / week / earlier and drops empty slices', () => {
    const slices = sliceSessionsByTime([
      entry('today', undefined, new Date('2026-08-11T01:00:00').getTime()),
      entry('week', undefined, now - 3 * 86_400_000),
      entry('old', undefined, now - 40 * 86_400_000),
    ], now);
    expect(slices.map((slice) => [slice.key, slice.entries.map((e) => e.session.key)])).toEqual([
      ['today', ['today']],
      ['week', ['week']],
      ['earlier', ['old']],
    ]);
  });

  it('sinks unknown activity to earlier and keeps single-slice output minimal', () => {
    const slices = sliceSessionsByTime([entry('unknown', undefined, 0)], now);
    expect(slices).toEqual([
      { key: 'earlier', entries: [expect.objectContaining({ activityMs: 0 })] },
    ]);
  });
});

describe('flattenFolderNodes / workstreamColorIndex', () => {
  it('flattens nested folders depth-first with ancestor path prefixes', () => {
    const node = (id: string, name: string, children: SidebarFolderNode[] = []): SidebarFolderNode => ({
      folder: { id, name, parentId: null, order: 0, kind: 'workgroup', createdAt: 0, updatedAt: 0 },
      depth: 0,
      sessions: [],
      children,
    });
    const flat = flattenFolderNodes([
      node('a', '渲染修复', [node('b', '审计回归', [node('c', '深层用例')])]),
      node('d', '发布准备'),
    ]);
    expect(flat.map((stream) => [stream.node.folder.id, stream.pathPrefix])).toEqual([
      ['a', []],
      ['b', ['渲染修复']],
      ['c', ['渲染修复', '审计回归']],
      ['d', []],
    ]);
  });

  it('assigns a stable palette index per folder id', () => {
    expect(workstreamColorIndex('folder-root-a')).toBe(workstreamColorIndex('folder-root-a'));
    expect(workstreamColorIndex('folder-root-a')).toBeGreaterThanOrEqual(0);
    expect(workstreamColorIndex('folder-root-a')).toBeLessThan(8);
  });
});
