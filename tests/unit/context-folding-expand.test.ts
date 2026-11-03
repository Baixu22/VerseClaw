// @vitest-environment node
/**
 * context-folding-rlm / TF-0692 (CF-02): bounded ContextHandle expansion.
 *
 * Real code paths only: the context_expand tool, the resolver, and the real
 * archive owner. Covers the context_search -> context_expand read surface, the
 * character/byte bounds, and the fail-closed negatives (stale, missing,
 * ambiguous, expired, cross-session, cross-workspace, traversal, forged id).
 *
 * driven_by: agent; actor: claude-fable-5.1/context-folding-rlm
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceId } from '../../shared/types/identity-scope';
import {
  CONTEXT_FOLDING_ENV,
  CONTEXT_FOLDING_LIMITS,
  normalizeContextHandle,
  type ContextHandle,
  type ContextRequesterIdentity,
} from '../../shared/types/context-folding';
import type {
  BlockEntityQuery,
  BlockQuery,
  BlockStoreApi,
  ContextBlock,
} from '../../openclaw_runtime/src/context-engine/block';
import {
  contextFoldingHash,
  expandContextHandle,
  mintContextHandle,
  type ContextExpandDeps,
} from '../../openclaw_runtime/src/context-engine/context-folding/expand';
import {
  CONTEXT_EXPAND_TOOL_NAME,
  CONTEXT_FOLDING_TOOL_NAMES,
  createContextExpandTool,
  createContextSearchTool,
  createDcsContextAgentTools,
} from '../../openclaw_runtime/src/agents/tools/context-agent-tools';
import { createContextArchiveHandleForPayloadSync } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';

const WS_A = 'ws-a' as WorkspaceId;
const WS_B = 'ws-b' as WorkspaceId;
const NOW = '2026-11-03T00:00:00.000Z';
const TASKS_PY = ['from dataclasses import dataclass', '', '@dataclass', 'class Task:', '    task_id: str', '', '# ... 30 more lines ...', '', '    def complete_task(self, task_id: str) -> Task:', '        task = self.tasks[task_id]', '        task.status = "done"', '        task.revision += 1  # BUG: runs again on repeat', '        self.events.append({"type": "completed", "task_id": task_id, "revision": task.revision})', '        return task', ''].join('\n');
const dirs: string[] = [];
const savedArchiveDir = process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR;

function tmpDir(prefix = 'cf-expand-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function requester(sessionId = 'sess-parent', workspaceId: WorkspaceId = WS_A): ContextRequesterIdentity {
  return { workspaceId, sessionId, actor: 'parent', depth: 0 };
}

function makeBlock(overrides: Partial<ContextBlock> = {}): ContextBlock {
  return {
    block_id: 'block-1',
    block_type: 'experience',
    source_system: 'sekb',
    session_id: 'sess-parent',
    presence: { always_on: false, background: true },
    entities: ['taskboard'],
    valid_at: new Date('2026-11-01T00:00:00.000Z'),
    mutability: 'system_managed',
    summary: 'taskboard notes',
    full_content: 'revision is bumped unconditionally in complete_task',
    compression_depth: 0,
    entity_extraction_status: 'success',
    ...overrides,
  };
}

/** Minimal BlockStoreApi stand-in that keeps the real authorization shape. */
function makeStore(blocks: ContextBlock[]): Pick<BlockStoreApi, 'query' | 'queryByEntity'> {
  const visible = (params: BlockQuery): ContextBlock[] => {
    const target = params.session_id ?? params.requester_session_id;
    if (target !== params.requester_session_id) return [];
    return blocks.filter((block) => (params.include_global && !block.session_id) || block.session_id === target);
  };
  return {
    query: async (params: BlockQuery) => {
      const rows = visible(params);
      return params.block_types?.length ? rows.filter((row) => params.block_types!.includes(row.block_type)) : rows;
    },
    queryByEntity: async (params: BlockEntityQuery) => {
      const rows = visible(params);
      const entities = new Set(params.entities.map((entity) => entity.toLowerCase()));
      return rows.filter((row) => row.entities.some((entity) => entities.has(entity.toLowerCase())));
    },
  };
}

type ToolResult = { content: Array<{ type: string; text?: string }>; details?: unknown };

function payloadOf(result: unknown): Record<string, unknown> {
  const typed = result as ToolResult;
  if (typed.details !== undefined && typed.details !== null) return typed.details as Record<string, unknown>;
  const text = typed.content.find((item) => item.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

function deps(overrides: Partial<ContextExpandDeps> = {}): ContextExpandDeps {
  return { requester: requester(), now: () => NOW, ...overrides };
}

async function mintFileHandle(filePath: string, workspace: string, selector?: ContextHandle['selector']): Promise<ContextHandle> {
  const minted = await mintContextHandle({
    owner: 'workspace-file',
    resourceId: filePath,
    ...(selector ? { selector } : {}),
  }, deps({ workspaceRoot: workspace }));
  if (!minted.ok) throw new Error(`mint failed: ${minted.diagnostic.code} ${minted.diagnostic.message}`);
  return minted.handle;
}

beforeEach(() => {
  delete process.env[CONTEXT_FOLDING_ENV];
});

afterEach(() => {
  delete process.env[CONTEXT_FOLDING_ENV];
  if (savedArchiveDir === undefined) delete process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR;
  else process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR = savedArchiveDir;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('context_expand registration and the search -> expand read surface', () => {
  it('exists only when the flag is on and never inside the frozen DCS tool families', () => {
    const workspace = tmpDir();
    const store = makeStore([makeBlock()]);
    const off = createDcsContextAgentTools({ sessionId: 'sess-parent', blockStore: store as never, workspaceRoot: workspace });
    expect(off.map((tool) => tool.name)).not.toContain(CONTEXT_EXPAND_TOOL_NAME);
    process.env[CONTEXT_FOLDING_ENV] = '0';
    expect(createContextExpandTool({ sessionId: 'sess-parent', blockStore: store as never, workspaceRoot: workspace, config: {} })).toBeNull();
    delete process.env[CONTEXT_FOLDING_ENV];
    expect(createContextExpandTool({ sessionId: 'sess-parent', blockStore: store as never, workspaceRoot: workspace, config: {} })).toBeNull();
    process.env[CONTEXT_FOLDING_ENV] = '1';
    const on = createDcsContextAgentTools({ sessionId: 'sess-parent', blockStore: store as never, workspaceRoot: workspace, config: {} });
    expect(on.map((tool) => tool.name)).toContain(CONTEXT_EXPAND_TOOL_NAME);
    expect([...CONTEXT_FOLDING_TOOL_NAMES]).toEqual([CONTEXT_EXPAND_TOOL_NAME]);
    delete process.env[CONTEXT_FOLDING_ENV];
  });

  it('hands out a scoped handle from context_search and expands it with bounded evidence', async () => {
    const workspace = tmpDir();
    const store = makeStore([makeBlock()]);
    const options = { sessionId: 'sess-parent', blockStore: store as never, workspaceRoot: workspace, contextFoldingEnabled: true, contextFoldingNow: () => NOW };
    const search = createContextSearchTool(options)!;
    const searched = payloadOf(await search.execute('call-1', { query: 'taskboard' }));
    expect(searched.ok).toBe(true);
    const results = searched.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    const handle = normalizeContextHandle(results[0]!.handle, { hash: contextFoldingHash });
    expect(handle.owner).toBe('block-store');
    // The workspace identity follows the owner-resolved mapping (workspace root),
    // never a session key; the session is the executing session.
    expect(handle.scope.workspaceId).toBe(workspace);
    expect(handle.scope.sessionId).toBe('sess-parent');
    expect(handle.scope.workspaceId).not.toBe(handle.scope.sessionId);
    expect(handle.resourceId).toBe('block:block-1');

    const expand = createContextExpandTool(options)!;
    const expanded = payloadOf(await expand.execute('call-2', { handle, mode: 'excerpt', max_chars: 64 }));
    expect(expanded.ok).toBe(true);
    expect(String(expanded.content).length).toBeLessThanOrEqual(64);
    expect(String(expanded.content)).toContain('revision is bumped');
    expect(expanded.truncated).toBe(false);
    expect(expanded.handleId).toBe(handle.handleId);
    expect((expanded.evidenceRefs as Array<Record<string, unknown>>)[0]!.handleId).toBe(handle.handleId);
    expect((expanded.event as Record<string, unknown>).type).toBe('context_expand');
    expect((expanded.event as Record<string, unknown>).ok).toBe(true);
  });

  it('returns the handle without content for aggregate, so a large artifact costs one handle', async () => {
    const workspace = tmpDir();
    const big = 'x'.repeat(3_000);
    const store = makeStore([makeBlock({ full_content: big })]);
    const options = { sessionId: 'sess-parent', blockStore: store as never, workspaceRoot: workspace, contextFoldingEnabled: true, contextFoldingNow: () => NOW };
    const expand = createContextExpandTool(options)!;
    // Mint inside the tool from the owner resource, then read only the aggregate.
    const minted = payloadOf(await expand.execute('call-3', { resource: { owner: 'block-store', resource_id: 'block:block-1' }, mode: 'aggregate' }));
    expect(minted.ok).toBe(true);
    expect(minted.minted).toBe(true);
    expect(minted.content).toBeUndefined();
    expect((minted.aggregate as Record<string, unknown>).chars).toBe(3_000);
    expect(minted.charCount).toBe(0);
    expect(minted.resolvedSelectorText).toBe('full');
    expect((minted.handle as Record<string, unknown>).resourceId).toBe('block:block-1');
  });
});

describe('workspace-file reads stay inside the workspace and the selector', () => {
  it('reads a bounded excerpt, a search window and an aggregate of the same handle', async () => {
    const workspace = tmpDir();
    writeFileSync(path.join(workspace, 'taskboard.py'), TASKS_PY, 'utf8');
    const handle = await mintFileHandle('taskboard.py', workspace, { kind: 'lines', startLine: 9, endLine: 14 });
    expect(handle.estimatedChars).toBeGreaterThan(0);

    const excerpt = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'excerpt', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(excerpt.ok).toBe(true);
    expect(excerpt.content).toContain('complete_task');
    expect(excerpt.content).not.toContain('dataclass');
    expect(excerpt.resolvedSelectorText).toBe('L9-L14');

    const searched = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'search', query: 'revision', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(searched.ok).toBe(true);
    // 'revision' appears on the increment line and in the appended event payload.
    expect(searched.aggregate?.matches).toBe(2);
    expect(searched.content).toContain('L12:');
    expect(searched.content).toContain('L13:');
    expect(searched.evidenceRefs[0]!.kind).toBe('search');

    const aggregated = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'aggregate', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(aggregated.ok).toBe(true);
    expect(aggregated.aggregate?.lines).toBe(6);
    expect(aggregated.aggregate?.checksum).toBe(handle.checksum);

    const bounded = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'excerpt', maxChars: 20, requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(bounded.ok).toBe(true);
    expect(bounded.truncated).toBe(true);
    expect(bounded.charCount).toBeLessThanOrEqual(20);
  });

  it('honours an absolute range only inside the handle selector', async () => {
    const workspace = tmpDir();
    writeFileSync(path.join(workspace, 'taskboard.py'), TASKS_PY, 'utf8');
    const handle = await mintFileHandle('taskboard.py', workspace, { kind: 'lines', startLine: 9, endLine: 14 });
    const inside = await expandContextHandle(
      { schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'excerpt', range: { kind: 'lines', startLine: 11, endLine: 12 }, requester: requester() },
      deps({ workspaceRoot: workspace }),
    );
    expect(inside.ok).toBe(true);
    expect(inside.content).toContain('task.status = "done"');
    expect(inside.resolvedSelectorText).toBe('L11-L12');

    const outside = await expandContextHandle(
      { schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'excerpt', range: { kind: 'lines', startLine: 1, endLine: 4 }, requester: requester() },
      deps({ workspaceRoot: workspace }),
    );
    expect(outside.ok).toBe(false);
    expect(outside.diagnostics[0]!.code).toBe('expansion_not_allowed');
  });

  it('fails closed on stale, missing, ambiguous, traversal, cross-scope and expired references', async () => {
    const workspace = tmpDir();
    const file = path.join(workspace, 'taskboard.py');
    writeFileSync(file, TASKS_PY, 'utf8');
    const handle = await mintFileHandle('taskboard.py', workspace);

    writeFileSync(file, `${TASKS_PY}\n# drift\n`, 'utf8');
    const stale = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'excerpt', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(stale.ok).toBe(false);
    expect(stale.diagnostics[0]!.code).toBe('stale_checksum');
    expect(stale.freshness.status).toBe('stale');

    const fresh = await mintFileHandle('taskboard.py', workspace);
    rmSync(file);
    const missing = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle: fresh, mode: 'excerpt', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(missing.ok).toBe(false);
    expect(missing.diagnostics[0]!.code).toBe('missing_resource');

    writeFileSync(file, TASKS_PY, 'utf8');
    const glob = await mintContextHandle({ owner: 'workspace-file', resourceId: '*.py' }, deps({ workspaceRoot: workspace }));
    expect(glob.ok).toBe(false);
    expect(glob.ok === false && glob.diagnostic.code).toBe('ambiguous_selector');
    mkdirSync(path.join(workspace, 'src'), { recursive: true });
    const directory = await mintContextHandle({ owner: 'workspace-file', resourceId: 'src' }, deps({ workspaceRoot: workspace }));
    expect(directory.ok).toBe(false);
    expect(directory.ok === false && directory.diagnostic.code).toBe('ambiguous_selector');
    const traversal = await mintContextHandle({ owner: 'workspace-file', resourceId: '../outside.txt' }, deps({ workspaceRoot: workspace }));
    expect(traversal.ok).toBe(false);
    expect(traversal.ok === false && traversal.diagnostic.code).toBe('scope_violation');
    const absolute = await mintContextHandle({ owner: 'workspace-file', resourceId: '/etc/hosts' }, deps({ workspaceRoot: workspace }));
    expect(absolute.ok).toBe(false);
    expect(absolute.ok === false && absolute.diagnostic.code).toBe('scope_violation');

    const crossSession = await expandContextHandle(
      { schemaVersion: 'ContextExpandRequest/v1', handle: fresh, mode: 'excerpt', requester: requester('sess-other') },
      deps({ workspaceRoot: workspace, requester: requester('sess-other') }),
    );
    expect(crossSession.ok).toBe(false);
    expect(crossSession.diagnostics[0]!.code).toBe('session_mismatch');
    const crossWorkspace = await expandContextHandle(
      { schemaVersion: 'ContextExpandRequest/v1', handle: fresh, mode: 'excerpt', requester: requester('sess-parent', WS_B) },
      deps({ workspaceRoot: workspace, requester: requester('sess-parent', WS_B) }),
    );
    expect(crossWorkspace.ok).toBe(false);
    expect(crossWorkspace.diagnostics[0]!.code).toBe('workspace_mismatch');
    const requesterMismatch = await expandContextHandle(
      { schemaVersion: 'ContextExpandRequest/v1', handle: fresh, mode: 'excerpt', requester: requester('sess-other') },
      deps({ workspaceRoot: workspace }),
    );
    expect(requesterMismatch.ok).toBe(false);
    expect(requesterMismatch.diagnostics[0]!.code).toBe('session_mismatch');

    const expiring = await mintContextHandle({ owner: 'workspace-file', resourceId: 'taskboard.py' }, deps({
      workspaceRoot: workspace,
      now: () => NOW,
    }));
    expect(expiring.ok).toBe(true);
    if (expiring.ok) {
      const withTtl: ContextHandle = { ...expiring.handle, freshness: { ...expiring.handle.freshness, ttlMs: 1_000 } };
      const late = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle: withTtl, mode: 'excerpt', requester: requester() }, deps({ workspaceRoot: workspace, now: () => '2026-11-03T00:05:00.000Z' }));
      expect(late.ok).toBe(false);
      expect(late.diagnostics[0]!.code).toBe('expired');
    }
  });

  it('refuses a forged handle id, an over-limit request and a disallowed mode', async () => {
    const workspace = tmpDir();
    writeFileSync(path.join(workspace, 'taskboard.py'), TASKS_PY, 'utf8');
    const handle = await mintFileHandle('taskboard.py', workspace, { kind: 'lines', startLine: 9, endLine: 14 });

    const forged: ContextHandle = { ...handle, handleId: `cfh_${'1'.repeat(32)}` };
    const forgedResult = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle: forged, mode: 'excerpt', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(forgedResult.ok).toBe(false);
    expect(forgedResult.diagnostics[0]!.code).toBe('invalid_handle_id');

    const overLimit = await expandContextHandle(
      { schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'excerpt', maxChars: CONTEXT_FOLDING_LIMITS.expandMaxChars + 1, requester: requester() },
      deps({ workspaceRoot: workspace }),
    );
    expect(overLimit.ok).toBe(false);
    expect(overLimit.diagnostics[0]!.code).toBe('limit_exceeded');

    const narrow: ContextHandle = { ...handle, allowedExpansion: { modes: ['aggregate'], maxChars: 100, maxBytes: 1_000 } };
    const disallowed = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle: narrow, mode: 'excerpt', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(disallowed.ok).toBe(false);
    expect(disallowed.diagnostics[0]!.code).toBe('expansion_not_allowed');
    const allowed = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle: narrow, mode: 'aggregate', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(allowed.ok).toBe(true);

    const searchWithoutQuery = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle, mode: 'search', requester: requester() }, deps({ workspaceRoot: workspace }));
    expect(searchWithoutQuery.ok).toBe(false);
    expect(searchWithoutQuery.diagnostics[0]!.code).toBe('invalid_request');
  });

  it('reports ambiguous and unavailable owners instead of guessing', async () => {
    const workspace = tmpDir();
    const duplicates = makeStore([makeBlock(), makeBlock({ valid_at: new Date('2026-11-02T00:00:00.000Z') })]);
    const ambiguous = await mintContextHandle({ owner: 'block-store', resourceId: 'block:block-1' }, deps({ blockStore: duplicates as never }));
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.ok === false && ambiguous.diagnostic.code).toBe('ambiguous_selector');
    const missingBlock = await mintContextHandle({ owner: 'block-store', resourceId: 'block:nope' }, deps({ blockStore: makeStore([makeBlock()]) as never }));
    expect(missingBlock.ok).toBe(false);
    expect(missingBlock.ok === false && missingBlock.diagnostic.code).toBe('missing_resource');
    const noStore = await mintContextHandle({ owner: 'block-store', resourceId: 'block:block-1' }, deps());
    expect(noStore.ok).toBe(false);
    expect(noStore.ok === false && noStore.diagnostic.code).toBe('owner_unavailable');
    const transcript = await mintContextHandle({ owner: 'transcript', resourceId: 'session:sess-parent' }, deps({ workspaceRoot: workspace }));
    expect(transcript.ok).toBe(false);
    expect(transcript.ok === false && transcript.diagnostic.code).toBe('owner_unavailable');
    const noRoot = await mintContextHandle({ owner: 'workspace-file', resourceId: 'taskboard.py' }, deps());
    expect(noRoot.ok).toBe(false);
    expect(noRoot.ok === false && noRoot.diagnostic.code).toBe('owner_unavailable');
  });
});

describe('context-archive reads reuse the owner verifier', () => {
  it('expands a verified archive for its own session, and refuses drift, strangers and missing payloads', async () => {
    const archiveRoot = path.join(tmpDir(), 'archives');
    process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR = archiveRoot;
    const created = createContextArchiveHandleForPayloadSync({
      sessionId: 'sess-parent',
      itemId: 'observation:tool-call-1' as never,
      payload: 'archived tool output: revision=2 after duplicate completion',
      source: { type: 'tool_call', sessionId: 'sess-parent', toolCallId: 'tool-call-1' },
      archiveRoot,
    });

    const minted = await mintContextHandle(
      { owner: 'context-archive', resourceId: created.uri },
      deps(),
      { checksum: created.checksum },
    );
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.handle.checksum).toBe(created.checksum);
    const expanded = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle: minted.handle, mode: 'excerpt', requester: requester() }, deps());
    expect(expanded.ok).toBe(true);
    expect(expanded.content).toContain('revision=2');

    // The archive carries its own session binding: a stranger cannot even mint a
    // handle for it, so there is nothing to expand.
    const strangerMint = await mintContextHandle(
      { owner: 'context-archive', resourceId: created.uri },
      deps({ requester: requester('sess-other') }),
      { checksum: created.checksum },
    );
    expect(strangerMint.ok).toBe(false);
    expect(strangerMint.ok === false && strangerMint.diagnostic.code).toBe('session_mismatch');
    // And a valid handle is still refused when the executing requester differs.
    const strangerExpand = await expandContextHandle(
      { schemaVersion: 'ContextExpandRequest/v1', handle: minted.handle, mode: 'excerpt', requester: requester('sess-other') },
      deps({ requester: requester('sess-other') }),
    );
    expect(strangerExpand.ok).toBe(false);
    expect(strangerExpand.diagnostics[0]!.code).toBe('session_mismatch');

    const uriParts = /^context-archive:\/\/([^/]+)\/([^/]+)$/.exec(created.uri)!;
    // Well-formed artifact whose payload no longer matches the handle checksum.
    writeFileSync(
      path.join(archiveRoot, decodeURIComponent(uriParts[1]!), decodeURIComponent(uriParts[2]!)),
      JSON.stringify({ schemaVersion: 1, handle: created, payload: 'tampered payload' }),
      'utf8',
    );
    const drifted = await expandContextHandle({ schemaVersion: 'ContextExpandRequest/v1', handle: minted.handle, mode: 'excerpt', requester: requester() }, deps());
    expect(drifted.ok).toBe(false);
    expect(drifted.diagnostics[0]!.code).toBe('stale_checksum');

    const gone = await mintContextHandle(
      { owner: 'context-archive', resourceId: 'context-archive://sess-parent/never.context-archive.json' },
      deps(),
      { checksum: `sha256:${'a'.repeat(64)}` },
    );
    expect(gone.ok).toBe(false);
    expect(gone.ok === false && gone.diagnostic.code).toBe('missing_resource');
  });
});
