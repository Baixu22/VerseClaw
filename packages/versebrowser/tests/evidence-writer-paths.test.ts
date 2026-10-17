import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { writeEvidencePack } from '../src/evidence/writer.ts';
import { readEvidencePack } from '../src/evidence/reader.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const png = 'data:image/png;base64,aGVsbG8=';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'vb-writer-path-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('dot-segment pack ids stay beneath the selected root', async () => {
  const evidenceRoot = join(root, 'evidence');
  const pack = await writeEvidencePack({ rootDir: evidenceRoot, packId: '..', label: 'test' });
  expect(relative(evidenceRoot, pack.packDir)).not.toMatch(/^\.\.(?:[\\/]|$)/);
});

it('screenshot names cannot overwrite a file outside the pack', async () => {
  const outside = join(root, 'outside.png');
  await writeFile(outside, 'sentinel');
  await writeEvidencePack({ rootDir: join(root, 'evidence'), packId: 'safe', label: 'test', screenshots: [{ name: '../../../outside.png', dataUrl: png }] });
  expect(await readFile(outside, 'utf8')).toBe('sentinel');
});

it('a pack directory junction cannot redirect writes outside the evidence root', async () => {
  const evidenceRoot = join(root, 'evidence');
  const outside = join(root, 'outside');
  await mkdir(evidenceRoot); await mkdir(outside);
  await symlink(outside, join(evidenceRoot, 'linked'), 'junction');
  await expect(writeEvidencePack({ rootDir: evidenceRoot, packId: 'linked', label: 'test' })).rejects.toMatchObject({ code: 'E_EVIDENCE_PATH' });
});

it('fixed pack filenames cannot read through a junction outside the pack', async () => {
  const written = await writeEvidencePack({ rootDir: root, label: 'test' });
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.json'), JSON.stringify({ marker: 'outside-secret' }));
  // Directory links need no Windows symlink privilege; reading a directory must
  // still be rejected at containment, before an EISDIR is silently swallowed.
  await symlink(outside, join(written.packDir, 'diagnosis.json'), 'junction');
  await expect(readEvidencePack(written.packDir)).rejects.toMatchObject({ code: 'E_EVIDENCE_PATH' });
});

it('the screenshot sink rejects an existing shots junction before creating directories', async () => {
  const evidenceRoot = join(root, 'evidence');
  const outside = join(root, 'outside');
  await mkdir(evidenceRoot); await mkdir(outside);
  await symlink(outside, join(evidenceRoot, 'shots'), 'junction');
  const api = { screenshot: async () => ({ success: true, dataUrl: png, format: 'png' }) } as unknown as AgentBrowserHostApi;
  const result = await new AgentBrowserFacade({ api, evidenceRoot }).screenshotToDisk('session', { fileName: 'shot.png' });
  expect(result).toMatchObject({ ok: false, error: { code: 'E_SCREENSHOT' } });
  const { readdir } = await import('node:fs/promises');
  expect(await readdir(outside)).toEqual([]);
});
