import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeSourceSync, type KnowledgeSourceTransition } from '@electron/services/knowledge-source-sync';

const roots: string[] = [];
const active: Array<ReturnType<typeof createKnowledgeSourceSync>> = [];
async function fixture(options: Partial<Parameters<typeof createKnowledgeSourceSync>[0]> = {}) {
  const base = await mkdtemp(join(tmpdir(), 'knowledge-sync-'));
  roots.push(base);
  const root = join(base, 'sources'); await mkdir(root);
  const received: KnowledgeSourceTransition[] = [];
  const config = { id: 'native-source', root, patterns: ['**/*.md'], cursorPath: join(base, 'cursor.json'), capture: async (value: KnowledgeSourceTransition) => { received.push(value); }, onError: vi.fn(), debounceMs: 30, scanIntervalMs: 10000, ...options };
  const sync = createKnowledgeSourceSync(config); active.push(sync);
  return { base, root, received, config, sync };
}
afterEach(async () => {
  for (const sync of active.splice(0)) { sync.stop(); await sync.settled(); }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe('continuous local knowledge synchronization', () => {
  it('does not deduplicate later edit cycles or delete/recreate back to the same content', async () => {
    const f = await fixture(); const path = join(f.root, 'cycle.md');
    for (const body of ['A', 'B', 'A', 'B']) { await writeFile(path, body); await f.sync.scan(); }
    await unlink(path); await f.sync.scan(); await writeFile(path, 'A'); await f.sync.scan();
    expect(f.received).toHaveLength(6);
    expect(new Set(f.received.map(change => change.captureKey)).size).toBe(6);
    expect(new Set(f.received.map(change => change.sourceId)).size).toBe(1);
    expect(JSON.parse(await readFile(f.config.cursorPath, 'utf8')).sequence).toBe(6);
  });
  it('reconciles twenty native rename/change event bursts, updates and withdrawals without duplicates', async () => {
    const f = await fixture(); await f.sync.start();
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFile(join(f.root, `source-${i}.md`), `Version one ${i}`)));
    await vi.waitFor(() => expect(f.received.filter(x => x.kind === 'created')).toHaveLength(20), { timeout: 7000 });
    await f.sync.scan(); expect(f.received).toHaveLength(20);
    await writeFile(join(f.root, 'source-0.md'), 'Version two');
    await vi.waitFor(() => expect(f.received.some(x => x.kind === 'updated')).toBe(true), { timeout: 7000 });
    await unlink(join(f.root, 'source-1.md'));
    await vi.waitFor(() => expect(f.received.some(x => x.kind === 'withdrawn')).toBe(true), { timeout: 7000 });
    await f.sync.scan();
    expect(f.received).toHaveLength(22);
    expect(new Set(f.received.map(x => x.captureKey)).size).toBe(22);
    const cursor = JSON.parse(await readFile(f.config.cursorPath, 'utf8'));
    expect(Object.keys(cursor.files)).toHaveLength(19);
    expect(cursor.files['source-1.md']).toBeUndefined();
  });
  it('startup repairs modifications, new documents and deletions missed while stopped', async () => {
    const f = await fixture(); await writeFile(join(f.root, 'a.md'), 'before'); await f.sync.start(); f.sync.stop();
    await unlink(join(f.root, 'a.md')); await writeFile(join(f.root, 'b.md'), 'new while stopped');
    const restarted = createKnowledgeSourceSync(f.config); active.push(restarted); await restarted.start();
    expect(f.received.map(x => x.kind)).toEqual(['created', 'created', 'withdrawn']);
    await restarted.scan(); expect(f.received).toHaveLength(3);
  });
  it('failed candidate capture never commits a cursor and remains retryable', async () => {
    const f = await fixture(); await writeFile(join(f.root, 'a.md'), 'retry me');
    let fail = true;
    const sync = createKnowledgeSourceSync({ ...f.config, capture: async value => { if (fail) throw Error('storage unavailable'); f.received.push(value); } }); active.push(sync);
    await expect(sync.start()).rejects.toThrow('storage unavailable');
    await expect(readFile(f.config.cursorPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    fail = false; await sync.scan(); expect(f.received).toHaveLength(1);
    await sync.scan(); expect(f.received).toHaveLength(1);
  });
  it('rejects oversized/binary files and never follows a symlink outside the root', async () => {
    const f = await fixture({ maxBytesPerFile: 32 });
    await writeFile(join(f.root, 'large.md'), 'a'.repeat(100));
    await writeFile(join(f.root, 'binary.md'), Buffer.from([1, 0, 2]));
    await writeFile(join(f.base, 'outside.md'), 'private outside');
    await symlink(join(f.base, 'outside.md'), join(f.root, 'link.md'));
    await writeFile(join(f.root, 'good.md'), 'usable'); await f.sync.start();
    expect(f.received.map(x => x.relativePath)).toEqual(['good.md']);
  });
  it('does not infer deletions from a capped incomplete scan and stops pending work', async () => {
    const f = await fixture(); await writeFile(join(f.root, 'retained.md'), 'retained'); await f.sync.start(); f.sync.stop();
    await writeFile(join(f.root, 'a.md'), 'overflow');
    const capped = createKnowledgeSourceSync({ ...f.config, maxFiles: 1 }); active.push(capped); await capped.start();
    expect(f.received.some(x => x.kind === 'withdrawn')).toBe(false);
    capped.stop(); await writeFile(join(f.root, 'later.md'), 'after stop'); await capped.scan();
    expect(f.received.some(x => x.relativePath === 'later.md')).toBe(false);
  });
});
