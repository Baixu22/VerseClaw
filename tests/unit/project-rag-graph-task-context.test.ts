// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FactStore } from '../../openclaw_runtime/src/context-engine/factstore/store';
import { createMaterializer } from '../../openclaw_runtime/src/context-engine/factstore/materialize';
import { expandCodeRelationships } from '../../openclaw_runtime/src/context-engine/views/retrieval/relationship-expansion';
import { retrieveHybrid } from '../../openclaw_runtime/src/context-engine/views/retrieval/hybrid-retriever';
import { buildQueryContext } from '../../openclaw_runtime/src/context-engine/views/retrieval/query-context';
import { createContextUnderstandTool, createContextImpactTool } from '../../openclaw_runtime/src/agents/tools/context-agent-tools';
import { readTaskContextHint } from '../../openclaw_runtime/src/knowledge/retrieval/task-context-hint';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import type { TaskContractInput } from '../../shared/task-system/types';
import { upsertSessionEntry, updateSessionStore } from '../../openclaw_runtime/src/config/sessions/store';
import { closeSqliteSessionStoreDatabase } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';

let root: string, facts: FactStore, tasks: TaskSystemStore | undefined;
const code = {
  'src/entry.ts': 'import { calculate as compute } from "../a/model.js";\nexport function run() { return compute(); }\n',
  'a/model.ts': 'import { next } from "./next.js";\nexport function calculate() { return "RIGHT_MODEL" + next(); }\n',
  'a/next.ts': 'import { last } from "./last.js";\nexport function next() { return last(); }\n',
  'a/last.ts': 'export function last() { return "THIRD_HOP"; }\n',
  'b/model.ts': 'export function calculate() { return "WRONG_MODEL"; }\n',
};
function index(extra: Record<string, string> = {}) {
  for (const [file, content] of Object.entries({ ...code, ...extra })) {
    mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), content);
  }
  const materializer = createMaterializer(facts, root);
  const result = materializer.ensureFacts({ paths: Object.keys({ ...code, ...extra }), budget: { maxParsePerQuery: 32 } });
  expect(result.failed).toEqual([]);
  return { repoRoot: root, fingerprint: 'fixture', store: facts, materializer };
}
const expand = (options: Partial<Parameters<typeof expandCodeRelationships>[0]> = {}) =>
  expandCodeRelationships({ store: facts, repoRoot: root, seeds: ['src/entry.ts'], intent: 'relationship', ...options });
const contract = (objective = 'Find related implementation'): TaskContractInput => ({
  objective, target: 'artifact.txt', constraints: ['Keep edits in the current workspace'],
  acceptance: [{ id: 'artifact', description: 'Read the artifact', verification: { kind: 'file-sha256', path: 'artifact.txt', sha256: 'a'.repeat(64) } }],
});
function bindTask() {
  tasks = new TaskSystemStore(resolveTaskDomain(root));
  const task = tasks.create(contract(), 'create').task;
  const owner = tasks.claim(task.contract.taskNodeId, 'session-a', 'generation-a', 'claim').claim!;
  return owner;
}
const hint = (options: Partial<Parameters<typeof readTaskContextHint>[0]> = {}) =>
  readTaskContextHint({ workspaceRoot: root, sessionKey: 'session-a', generation: 'generation-a', ...options });
function taskRows() {
  const names = tasks!.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'task_%' ORDER BY name").all() as Array<{ name: string }>;
  return names.map(({ name }) => [name, tasks!.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rag15-'));
  facts = new FactStore(join(root, 'facts.sqlite'));
});
afterEach(() => { vi.restoreAllMocks(); tasks?.close(); tasks = undefined; facts.close(); closeSqliteSessionStoreDatabase(join(root, 'sessions.json')); rmSync(root, { recursive: true, force: true }); });

describe('Project RAG exact owner-admitted relationships', () => {
  it('resolves aliased calls to the actual path despite identical file and symbol names', async () => {
    index(); const result = await expand();
    expect(result.expansion.status).toBe('complete');
    expect(result.expansion.sources.map(source => source.subjectId)).toEqual(['src/entry.ts', 'a/model.ts']);
    const call = result.expansion.edges.find(edge => edge.kind === 'calls')!;
    expect(call.target).toMatchObject({ domain: 'code', subjectId: 'a/model.ts', schema: 'SourceRef/v2' });
    expect(call.targetSymbol).toBe('calculate'); expect(call.sourceSymbol).toBe('run');
    expect(call.targetSymbolId).toBe(facts.getSymbolsByFile(root, 'a/model.ts').find(symbol => symbol.name === 'calculate')!.id);
    expect(JSON.stringify(result)).not.toContain('WRONG_MODEL');
    expect(call.source.revision).toContain(facts.getFileRecord(root, 'src/entry.ts')!.provenance.producedHash);
  });
  it('caps traversal at two hops and excludes a third-hop body', async () => {
    index(); const result = await expand({ depth: 99 });
    expect(result.expansion.maxDepth).toBe(2);
    expect(result.expansion.sources.map(source => source.subjectId)).toContain('a/next.ts');
    expect(result.expansion.sources.map(source => source.subjectId)).not.toContain('a/last.ts');
    expect(JSON.stringify(result)).not.toContain('THIRD_HOP');
    expect(result.expansion.edges.every(edge => edge.depth <= 2)).toBe(true);
  });
  it('bounds admitted endpoints and reports a truncated expansion', async () => {
    index(); const result = await expand({ depth: 2, maxNodes: 2 });
    expect(result.expansion.sources.length).toBeLessThanOrEqual(2);
    expect(result.expansion.status).toBe('partial'); expect(result.expansion.truncated).toBe(true);
  });
  it('does no graph read for lookup and preserves hybrid lookup ordering', async () => {
    index(); const owner = vi.fn(); const result = await expand({ intent: 'lookup', assertCurrent: owner });
    expect(result.expansion.status).toBe('disabled'); expect(result.snippets).toEqual([]); expect(owner).not.toHaveBeenCalled();
    expect(retrieveHybrid(facts, root, buildQueryContext('calculate'))).toEqual(
      retrieveHybrid(facts, root, buildQueryContext('calculate'), { disableGraphRerank: true }));
  });
  it('rejects a stale landing file before its indexed body can enter a snippet', async () => {
    index(); writeFileSync(join(root, 'a/model.ts'), 'export function calculate() { return "REPLACED_BODY"; }');
    const result = await expand();
    expect(result.expansion.status).toBe('partial');
    expect(result.expansion.rejected).toContainEqual({ filePath: 'a/model.ts', reason: 'stale_edge' });
    expect(result.snippets.map(snippet => snippet.filePath)).not.toContain('a/model.ts');
    expect(JSON.stringify(result)).not.toContain('RIGHT_MODEL');
  });
  it('rejects stale source edges without following the former target', async () => {
    index(); writeFileSync(join(root, 'src/entry.ts'), 'export function run() { return "CHANGED_SOURCE"; }');
    const result = await expand(); expect(result.expansion.status).toBe('unavailable');
    expect(result.expansion.edges).toEqual([]); expect(result.snippets).toEqual([]);
  });
  it('rejects cross-workspace seeds', async () => {
    index(); const outside = mkdtempSync(join(tmpdir(), 'rag15-outside-'));
    try {
      writeFileSync(join(outside, 'model.ts'), 'OUTSIDE_BODY');
      const result = await expand({ seeds: [join(outside, 'model.ts')] });
      expect(result.expansion.status).toBe('unavailable'); expect(result.snippets).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('OUTSIDE_BODY');
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
  it('keeps a denied endpoint denied across import and call candidates', async () => {
    index(); const denied = vi.fn((file: string) => { if (file === 'a/model.ts') throw Error('owner_revoked'); });
    const result = await expand({ assertCurrent: denied });
    expect(result.expansion.rejected).toContainEqual({ filePath: 'a/model.ts', reason: 'owner_revoked' });
    expect(result.expansion.sources.map(source => source.subjectId)).not.toContain('a/model.ts');
    expect(denied.mock.calls.filter(([file]) => file === 'a/model.ts')).toHaveLength(1);
  });
  it('discards the result if an endpoint changes after the first safe read', async () => {
    index(); let checks = 0;
    const result = await expand({ assertCurrent: file => {
      if (file === 'a/model.ts' && ++checks === 2) writeFileSync(join(root, file), 'export function calculate() { return "LATE_BODY"; }');
    } });
    expect(result.expansion.status).toBe('unavailable'); expect(result.expansion.edges).toEqual([]); expect(result.snippets).toEqual([]);
  });
  it('resolves namespace imports and refuses a same-name unrelated method', async () => {
    index({ 'src/namespace.ts': 'import * as model from "../a/model.js";\nexport function viaNamespace() { return model.calculate(); }\n',
      'src/object.ts': 'export function unrelated() { const object = { calculate() { return 1; } }; return object.calculate(); }\n' });
    const namespace = await expand({ seeds: ['src/namespace.ts'] });
    expect(namespace.expansion.edges.some(edge => edge.kind === 'calls' && edge.target.subjectId === 'a/model.ts')).toBe(true);
    const unrelated = await expand({ seeds: ['src/object.ts'] });
    expect(unrelated.expansion.sources.map(source => source.subjectId)).not.toContain('a/model.ts');
    expect(unrelated.expansion.sources.map(source => source.subjectId)).not.toContain('b/model.ts');
  });
  it('does not follow an imported binding shadowed by a parameter', async () => {
    index({ 'src/shadow.ts': 'import { calculate } from "../a/model.js";\nexport function shadow(calculate: () => string) { return calculate(); }\n' });
    const result = await expand({ seeds: ['src/shadow.ts'] });
    expect(result.expansion.edges.filter(edge => edge.kind === 'calls')).toEqual([]);
  });
  it('resolves a named default export through its imported alias', async () => {
    index({ 'src/default.ts': 'import compute from "../a/default.js";\nexport function defaultCaller() { return compute(); }\n',
      'a/default.ts': 'export default function calculate() { return "DEFAULT_BODY"; }\n' });
    const result = await expand({ seeds: ['src/default.ts'] });
    expect(result.expansion.edges).toContainEqual(expect.objectContaining({ kind: 'calls', targetSymbol: 'calculate',
      target: expect.objectContaining({ subjectId: 'a/default.ts' }) }));
  });
  it('finds an actual incoming call in one hop and keeps qualified impact symbols exact', async () => {
    const service = index(); const result = await expand({ seeds: ['a/model.ts'] });
    expect(result.expansion.edges).toContainEqual(expect.objectContaining({ kind: 'calls', sourceSymbol: 'run', targetSymbol: 'calculate', depth: 1 }));
    const impact = await createContextImpactTool({ factService: service, workspaceRoot: root, sessionId: 'generation-a' })!
      .execute('impact', { target: 'a/model.ts:calculate' });
    const data = impact.details as { matchedSymbols: Array<{ name: string; filePath: string }>; callers: Array<{ name: string; depth: number }> };
    expect(data.matchedSymbols).toHaveLength(1); expect(data.matchedSymbols[0]).toMatchObject({ name: 'calculate', filePath: 'a/model.ts' });
    expect(data.callers).toContainEqual(expect.objectContaining({ name: 'run', depth: 1 }));
  });
  it('returns the actual symbol body and exact UTF-8 range within the character budget', async () => {
    index({ 'a/model.ts': '// 中文😀 header\r\n'.repeat(300) + 'export function calculate() { return "FOCUSED_BODY😀"; }\r\n' });
    const result = await expand({ budgetChars: 400 });
    const snippet = result.snippets.find(snippet => snippet.filePath === 'a/model.ts')!;
    expect(snippet.content).toContain('FOCUSED_BODY😀'); expect(snippet.startLine).toBeGreaterThan(1);
    expect(result.snippets.reduce((size, snippet) => size + snippet.content.length, 0)).toBeLessThanOrEqual(400);
    const bytes = Buffer.from('// 中文😀 header\r\n'.repeat(300) + 'export function calculate() { return "FOCUSED_BODY😀"; }\r\n');
    expect(bytes.subarray(snippet.sourceRef.locator!.startByte, snippet.sourceRef.locator!.endByteExclusive).toString()).toBe(snippet.content);
  });
  it('keeps a surrogate boundary valid and returns no empty evidence', async () => {
    index({ 'a/emoji.ts': '//😀 code\nexport function emoji() { return 1; }\n', 'a/empty.ts': '' });
    const result = await expand({ seeds: ['a/emoji.ts'], budgetChars: 3 });
    expect(result.snippets[0]!.content).toBe('//'); expect(result.expansion.status).toBe('partial');
    expect((await expand({ seeds: ['a/empty.ts'] })).snippets).toEqual([]);
  });
  it('rechecks the bound task after code expansion before returning the combined result', async () => {
    const owner = bindTask(), service = index();
    const read = facts.getFileRecord.bind(facts); let revised = false;
    vi.spyOn(facts, 'getFileRecord').mockImplementation((repo, file) => {
      if (file === 'a/model.ts' && !revised) { revised = true; tasks!.revise(owner.taskNodeId, 1, contract('Revised during graph read')); }
      return read(repo, file);
    });
    const result = await createContextUnderstandTool({ factService: service, workspaceRoot: root, sessionId: 'generation-a', agentSessionKey: 'session-a' })!
      .execute('combined', { query: 'src/entry.ts', intent: 'relationship' });
    const data = result.details as { relationships: { status: string }; taskHint: { status: string; reason: string } };
    expect(data.relationships.status).toBe('complete');
    expect(data.taskHint).toMatchObject({ status: 'unavailable', reason: 'missing_task_binding' });
  });
  it('rechecks task hints when the final code read fails and the task changes', async () => {
    const owner = bindTask(), service = index();
    const read = facts.getSymbolsByFile.bind(facts); let changed = false;
    vi.spyOn(facts, 'getSymbolsByFile').mockImplementation((repo, file) => {
      const symbols = read(repo, file);
      if (file === 'a/model.ts' && !changed) {
        changed = true;
        writeFileSync(join(root, file), 'export function calculate() { return "LATE_CHANGE"; }');
        tasks!.revise(owner.taskNodeId, 1, contract('Revised after code read'));
      }
      return symbols;
    });
    const result = await createContextUnderstandTool({ factService: service, workspaceRoot: root, sessionId: 'generation-a', agentSessionKey: 'session-a' })!
      .execute('failed-combined', { query: 'src/entry.ts', intent: 'relationship' });
    const data = result.details as { relationships: { status: string }; taskHint: { status: string }; snippets: unknown[] };
    expect(data.relationships.status).toBe('unavailable'); expect(data.snippets).toEqual([]); expect(data.taskHint.status).toBe('unavailable');
  });
  it('uses the production context tool and degrades an ambiguous symbol query', async () => {
    const service = index(); const tool = createContextUnderstandTool({ factService: service, workspaceRoot: root, sessionId: 'generation-a' })!;
    const result = await tool.execute('relationship', { query: 'src/entry.ts', intent: 'relationship' });
    expect(JSON.stringify(result)).toContain('RelationshipExpansion/v1'); expect(JSON.stringify(result)).toContain('RIGHT_MODEL');
    const ambiguous = await tool.execute('ambiguous', { query: 'calculate', intent: 'relationship' });
    expect(JSON.stringify(ambiguous)).toContain('ambiguous_symbol_use_exact_path');
    expect(JSON.stringify(ambiguous)).not.toContain('RIGHT_MODEL');
    const impact = await createContextImpactTool({ factService: service, workspaceRoot: root, sessionId: 'generation-a' })!.execute('impact', { target: 'src/entry.ts' });
    expect(JSON.stringify(impact)).not.toContain('WRONG_MODEL'); expect(JSON.stringify(impact)).toContain('a/model.ts');
  });
  it('uses an explicit query path ahead of previously active session files', async () => {
    const service = index(); const result = await createContextUnderstandTool({ factService: service, workspaceRoot: root,
      activeFiles: ['b/model.ts'], sessionId: 'generation-a' })!.execute('exact', { query: 'src/entry.ts', intent: 'relationship' });
    expect(JSON.stringify(result)).toContain('RIGHT_MODEL'); expect(JSON.stringify(result)).not.toContain('WRONG_MODEL');
  });
  it('reads the live session owner and rejects rotation or removal of its generation', async () => {
    const service = index(), sessionKey = 'agent:main:rag15', storePath = join(root, 'sessions.json');
    const cfg: OpenClawConfig = { agents: { defaults: { workspace: root } }, session: { store: storePath } };
    const put = (sessionId: string) => upsertSessionEntry({ agentId: 'main', storePath, sessionKey,
      entry: { sessionId, workspaceDir: root, updatedAt: Date.now(), status: 'done' } });
    await put('generation-a');
    const tool = createContextUnderstandTool({ factService: service, workspaceRoot: root, config: cfg,
      sessionId: 'generation-a', agentSessionKey: sessionKey })!;
    expect(JSON.stringify(await tool.execute('live', { query: 'src/entry.ts', intent: 'relationship' }))).toContain('RIGHT_MODEL');
    await put('generation-b');
    await expect(tool.execute('rotated', { query: 'src/entry.ts', intent: 'relationship' })).rejects.toThrow('session_changed');
    await updateSessionStore(storePath, store => { delete store[sessionKey]; });
    await expect(tool.execute('removed', { query: 'src/entry.ts', intent: 'relationship' })).rejects.toThrow('session_changed');
  });
});

describe('Project RAG current task hint', () => {
  it('reads the current contract and checkpoint refs without rewriting any task table', async () => {
    const owner = bindTask();
    tasks!.checkpoint(owner, { nextAction: 'Inspect evidence', completed: [], unresolved: [], artifacts: [{ path: 'artifact.txt', sha256: 'b'.repeat(64) }] });
    const before = taskRows(); const result = await hint();
    expect(result).toMatchObject({ schema: 'TaskContextHint/v1', status: 'available', taskNodeId: owner.taskNodeId,
      revision: 1, objective: 'Find related implementation', constraints: contract().constraints,
      evidenceRefs: [{ path: 'artifact.txt', sha256: 'b'.repeat(64) }] });
    expect(result.sourceRef).toMatchObject({ domain: 'task', subjectId: owner.taskNodeId, revision: '1' });
    expect(taskRows()).toEqual(before);
  });
  it('returns a missing ledger without creating a task database', async () => {
    const database = resolveTaskDomain(root).database;
    expect((await hint()).reason).toBe('missing_ledger'); expect(existsSync(database)).toBe(false);
  });
  it('requires the current session binding and generation', async () => {
    bindTask(); expect((await hint({ sessionKey: 'other' })).reason).toBe('missing_task_binding');
    expect((await hint({ generation: 'old-generation' })).status).toBe('unavailable');
    expect((await hint({ generation: undefined })).reason).toBe('missing_session_generation');
  });
  it('fences a changed task revision during the read and rejects old pins', async () => {
    const owner = bindTask(); const original = await hint(); let checks = 0;
    const changed = await hint({ assertCurrent: () => { if (++checks === 2) tasks!.revise(owner.taskNodeId, 1, contract('New revision')); } });
    expect(changed.reason).toBe('task_changed');
    tasks!.claim(owner.taskNodeId, 'session-a', 'generation-a', 'claim-revision-2');
    expect((await hint({ sourceRef: original.sourceRef })).reason).toBe('task_pin_changed');
    expect((await hint()).revision).toBe(2);
  });
  it('excludes checkpoint refs from a preceding contract revision without rewriting the checkpoint', async () => {
    const owner = bindTask();
    tasks!.checkpoint(owner, { nextAction: 'Old revision', completed: [], unresolved: [], artifacts: [{ path: 'old.txt', sha256: 'b'.repeat(64) }] });
    const checkpoint = tasks!.get(owner.taskNodeId).checkpoint;
    tasks!.revise(owner.taskNodeId, 1, contract('New revision'));
    const next = tasks!.claim(owner.taskNodeId, 'session-a', 'generation-a', 'claim-v2').claim!;
    expect(await hint()).toMatchObject({ status: 'available', revision: 2, reason: 'checkpoint_revision_mismatch', evidenceRefs: [] });
    expect(tasks!.get(owner.taskNodeId).checkpoint).toEqual(checkpoint);
    tasks!.checkpoint(next, { nextAction: 'Current revision', completed: [], unresolved: [], artifacts: [{ path: 'new.txt', sha256: 'c'.repeat(64) }] });
    expect((await hint()).evidenceRefs).toEqual([{ path: 'new.txt', sha256: 'c'.repeat(64) }]);
  });
  it('checks external identity after the second snapshot and fences a last-moment revision', async () => {
    const owner = bindTask(); let checks = 0;
    expect((await hint({ assertCurrent: () => { if (++checks === 3) throw Error('workspace_changed'); } })).reason).toBe('workspace_changed');
    checks = 0;
    expect((await hint({ assertCurrent: () => { if (++checks === 3) tasks!.revise(owner.taskNodeId, 1, contract('Late task revision')); } })).reason).toBe('task_changed');
  });
  it('disables task hints and rejects a changed owner without writes', async () => {
    bindTask(); const before = taskRows();
    expect(await hint({ enabled: false })).toMatchObject({ status: 'disabled', constraints: [], evidenceRefs: [] });
    expect((await hint({ assertCurrent: () => { throw Error('workspace_changed'); } })).reason).toBe('workspace_changed');
    expect(taskRows()).toEqual(before);
  });
});
