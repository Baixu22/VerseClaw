// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('../../electron/utils/token-usage', async () => ({
  ...await vi.importActual('../../electron/utils/token-usage-core'),
  getOpenClawUsageDirs: () => [fixture.root],
}));
import { getSessionContextSnapshot, projectContextComposition } from '../../electron/utils/session-context';
import { closeSqliteSessionStoreDatabase, replaceSqliteSessionStore, resolveSqliteSessionStoreDatabasePath } from '../../openclaw_runtime/src/config/sessions/store-sqlite';

const sessionKey = 'agent:main:context-a';
const sessionId = 'generation-a';
const report = (patch: Record<string, unknown> = {}) => ({
  source: 'run', generatedAt: 100, sessionKey, sessionId, provider: 'test', model: 'model',
  systemPrompt: { chars: 6000, projectContextChars: 3000, nonProjectContextChars: 3000 },
  currentTurn: { promptChars: 100, runtimeContextChars: 200 },
  injectedWorkspaceFiles: [{ name: 'AGENTS.md', path: '/project/AGENTS.md', missing: false, rawChars: 4000, injectedChars: 3000, truncated: true }],
  skills: { promptChars: 1000, entries: [{ name: 'search', blockChars: 1000 }] },
  tools: { listChars: 500, schemaChars: 1500, definitionChars: 2000, entries: [{ name: 'exec', summaryChars: 500, schemaChars: 1500 }] },
  ...patch,
});

async function seed(entry: Record<string, unknown>, messages?: unknown[]) {
  const dir = join(fixture.root, 'agents', 'main', 'sessions');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sessions.json'), JSON.stringify({ [sessionKey]: { sessionId, ...entry } }));
  if (messages) await writeFile(join(dir, `${sessionId}.jsonl`), messages.map(message => JSON.stringify(message)).join('\n'));
}

function seedRuntimeStore(storePath: string, entries: Parameters<typeof replaceSqliteSessionStore>[1]) {
  const databasePath = resolveSqliteSessionStoreDatabasePath(storePath);
  const withinFixture = relative(fixture.root, databasePath);
  if (withinFixture.startsWith('..') || isAbsolute(withinFixture)) throw new Error('Database escaped the agent fixture');
  try { replaceSqliteSessionStore(storePath, entries); }
  finally { closeSqliteSessionStoreDatabase(storePath); }
  return databasePath;
}

beforeEach(async () => { fixture.root = await mkdtemp(join(tmpdir(), 'clawx-context-unit-')); });

describe('context report projection', () => {
  it('separates embedded skills/tool lists and returns only source metadata', () => {
    const projected = projectContextComposition(report({ rawPrompt: 'private-prompt', apiKey: 'private-key' }), sessionKey, sessionId)!;
    expect(projected.instructionsChars).toBe(1500);
    expect(projected.workspaceFiles.chars).toBe(3000);
    expect(projected.skills.chars).toBe(1000);
    expect(projected.tools.chars).toBe(2000);
    expect(projected.workspaceFiles.entries[0]).toMatchObject({ name: 'AGENTS.md', chars: 3000, rawChars: 4000, status: 'truncated' });
    expect(JSON.stringify(projected)).not.toMatch(/private-prompt|private-key|rawPrompt|apiKey/);
  });

  it('rejects reports from another key or generation and reports missing data as null', () => {
    expect(projectContextComposition(report({ sessionId: 'old-generation' }), sessionKey, sessionId)).toBeNull();
    expect(projectContextComposition(report({ sessionKey: 'agent:main:other' }), sessionKey, sessionId)).toBeNull();
    expect(projectContextComposition(null, sessionKey, sessionId)).toBeNull();
    const projected = projectContextComposition(report({ currentTurn: {}, skills: { promptChars: -3 }, tools: { listChars: Infinity } }), sessionKey, sessionId)!;
    expect(projected.currentTurnChars).toBeNull();
    expect(projected.skills.chars).toBeNull();
    expect(projected.instructionsChars).toBeNull();
  });

  it('bounds long source lists while retaining their reported total', () => {
    const entries = Array.from({ length: 130 }, (_, index) => ({ name: `skill-${index}`, blockChars: 20, rawBody: 'hidden' }));
    const projected = projectContextComposition(report({ skills: { promptChars: 2600, entries } }), sessionKey, sessionId)!;
    expect(projected.skills.entries).toHaveLength(100);
    expect(projected.skills.totalEntries).toBe(130);
    expect(JSON.stringify(projected.skills)).not.toContain('hidden');
  });
});

describe('current session context snapshot', () => {
  it('reads the actual runtime SQLite store ahead of a stale JSON index without changing database bytes', async () => {
    await seed({ totalTokens: 900000, contextTokens: 1000000 });
    const storePath = join(fixture.root, 'agents', 'main', 'sessions', 'sessions.json');
    const databasePath = seedRuntimeStore(storePath, { [sessionKey]: { sessionId, updatedAt: 200, totalTokens: 7000, totalTokensFresh: true, contextTokens: 16000 } });
    const before = await readFile(databasePath);
    expect(await getSessionContextSnapshot(sessionKey, sessionId)).toMatchObject({ sessionId, usedTokens: 7000, contextTokens: 16000, usageSource: 'runtime' });
    expect(await readFile(databasePath)).toEqual(before);
  });

  it('does not revive a legacy JSON row missing from the authoritative SQLite store', async () => {
    await seed({ totalTokens: 900000 });
    const storePath = join(fixture.root, 'agents', 'main', 'sessions', 'sessions.json');
    seedRuntimeStore(storePath, { 'agent:main:other': { sessionId: 'other-generation', updatedAt: 200 } });
    expect(await getSessionContextSnapshot(sessionKey, sessionId)).toBeNull();
  });

  it('reads the current runtime count and binds the composition to its transcript', async () => {
    await seed({ totalTokens: 7000, totalTokensFresh: true, contextTokens: 16000, updatedAt: 200, systemPromptReport: report() });
    expect(await getSessionContextSnapshot(sessionKey, sessionId)).toMatchObject({ sessionId, usedTokens: 7000, contextTokens: 16000, usageSource: 'runtime', composition: { sessionId } });
  });

  it('uses the last request including cache tokens instead of accumulating turns', async () => {
    await seed({}, [
      { type: 'message', timestamp: '2026-11-24T01:00:00Z', message: { role: 'assistant', usage: { input: 50000, cacheRead: 40000, output: 100, total: 90100 } } },
      { type: 'message', timestamp: '2026-11-24T01:00:01Z', message: { role: 'assistant', usage: { input: 120, cacheRead: 380, cacheWrite: 20, output: 30, total: 550 } } },
    ]);
    expect(await getSessionContextSnapshot(sessionKey, sessionId)).toMatchObject({ usedTokens: 520, usageSource: 'last-request' });
  });

  it('keeps a post-compaction stale count unknown until the runtime measures it again', async () => {
    await seed({ totalTokens: 40000, totalTokensFresh: false }, [
      { type: 'message', timestamp: '2026-11-24T01:00:00Z', message: { role: 'assistant', usage: { input: 39900, output: 100, total: 40000 } } },
    ]);
    expect(await getSessionContextSnapshot(sessionKey, sessionId)).toMatchObject({ usedTokens: null, usageSource: 'unavailable' });
  });

  it('refuses mismatched generations and paths outside the agent session directory', async () => {
    await seed({ totalTokens: 500 });
    expect(await getSessionContextSnapshot(sessionKey, 'generation-b')).toBeNull();
    await seed({ sessionFile: join(fixture.root, 'outside.jsonl') });
    expect(await getSessionContextSnapshot(sessionKey, sessionId)).toBeNull();
  });

  it('does not borrow an unrelated transcript for an empty main conversation', async () => {
    const dir = join(fixture.root, 'agents', 'main', 'sessions');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'unrelated.jsonl'), JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 3000, total: 3000 } } }));
    expect(await getSessionContextSnapshot('agent:main:main')).toBeNull();
    expect(await getSessionContextSnapshot('agent:../escape:main')).toBeNull();
  });

  it('surfaces a corrupt owning index as a read failure', async () => {
    await seed({});
    await writeFile(join(fixture.root, 'agents', 'main', 'sessions', 'sessions.json'), '{broken');
    await expect(getSessionContextSnapshot(sessionKey, sessionId)).rejects.toThrow();
  });
});
