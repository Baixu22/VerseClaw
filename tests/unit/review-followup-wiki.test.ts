// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { applyMemoryWikiMutation, normalizeMemoryWikiMutationInput, resolveMemoryWikiConfig, ingestMemoryWikiSource,
  readMemoryWikiLifecycleMetadata, getMemoryWikiPage } from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'review-wiki-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const config = () => resolveMemoryWikiConfig({ vault: { path: join(root, 'vault') }, search: { backend: 'local', corpus: 'wiki' } });
const mutate = (mutation: Record<string, unknown>) => applyMemoryWikiMutation({ config: config(), mutation: normalizeMemoryWikiMutationInput(mutation) });

it('keeps same-named sources separate and preserves notes on re-import', async () => {
  const a = join(root, 'a', 'README.md'), b = join(root, 'b', 'README.md');
  await mkdir(join(root, 'a')); await mkdir(join(root, 'b'));
  await writeFile(a, 'source A'); await writeFile(b, 'source B');
  const [one, two] = await Promise.all([a, b].map(inputPath => ingestMemoryWikiSource({ config: config(), inputPath, title: 'Shared title' })));
  expect(one.pagePath).not.toBe(two.pagePath); expect(one.pageId).not.toBe(two.pageId);
  const file = join(config().vault.path, one.pagePath);
  await writeFile(file, (await readFile(file, 'utf8')).replace('<!-- openclaw:human:start -->', '<!-- openclaw:human:start -->\nKeep manual annotation'));
  await writeFile(a, 'source A changed');
  const updated = await ingestMemoryWikiSource({ config: config(), inputPath: a, title: 'Renamed title' });
  expect(updated).toMatchObject({ pagePath: one.pagePath, pageId: one.pageId, created: false });
  expect(await readFile(file, 'utf8')).toContain('Keep manual annotation');
  expect(await readFile(file, 'utf8')).toContain('source A changed');
  expect((await readMemoryWikiLifecycleMetadata(config(), one.pagePath)).revision).toBe(2);
  expect(await readFile(join(config().vault.path, two.pagePath), 'utf8')).toContain('source B');
});

it('rejects create collisions without replacing an accepted page', async () => {
  const first = await mutate({ op: 'create_synthesis', title: 'Target Page', body: 'Accepted original', sourceIds: ['source-A'], status: 'active' });
  const bytes = await readFile(join(config().vault.path, first.pagePath), 'utf8');
  await expect(mutate({ op: 'create_synthesis', title: 'Target-Page', body: 'Replacement', sourceIds: ['source-B'], status: 'draft' })).rejects.toThrow('create_conflict');
  expect(await readFile(join(config().vault.path, first.pagePath), 'utf8')).toBe(bytes);
});

it.each(['update_page', 'archive_page', 'delete_page'])('serializes concurrent update versus %s and rejects the stale writer', async (op) => {
  const first = await mutate({ op: 'create_synthesis', title: 'Concurrent', body: 'Original', sourceIds: ['source-A'] });
  const results = await Promise.allSettled([
    mutate({ op: 'update_page', lookup: first.pagePath, expectedRevision: 1, body: 'Writer A' }),
    mutate({ op, lookup: first.pagePath, expectedRevision: 1, body: 'Writer B' }),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  expect(String(failed.reason)).toMatch(/stale_revision|not found/);
});

it('advances the owner revision for metadata edits before later guarded writes', async () => {
  const page = await mutate({ op: 'create_synthesis', title: 'Metadata', body: 'Original', sourceIds: ['source-A'] });
  await mutate({ op: 'update_metadata', lookup: page.pagePath, confidence: 0.8 });
  expect((await readMemoryWikiLifecycleMetadata(config(), page.pagePath)).revision).toBe(2);
  await expect(mutate({ op: 'update_page', lookup: page.pagePath, expectedRevision: 1, body: 'stale' })).rejects.toThrow('stale_revision');
});

it.each(['archive_page', 'revoke_page'])('reads lifecycle revision without archived content and restores after %s', async (op) => {
  const created = await mutate({ op: 'create_synthesis', title: 'Lifecycle', body: 'Private archived body', sourceIds: ['source-A'] });
  await mutate({ op, lookup: created.pagePath, expectedRevision: 1 });
  const metadata = await readMemoryWikiLifecycleMetadata(config(), created.pagePath);
  expect(metadata.revision).toBe(2); expect(JSON.stringify(metadata)).not.toContain('Private archived body');
  expect(JSON.stringify(await getMemoryWikiPage({ config: config(), lookup: created.pagePath }))).not.toContain('Private archived body');
  expect(await mutate({ op: 'restore_page', lookup: created.pagePath, expectedRevision: metadata.revision })).toMatchObject({ revision: 3, status: 'active' });
});
