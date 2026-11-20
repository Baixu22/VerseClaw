import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ROOT, collectDrift, listSourceIcons, readDependencyIdentity, syncLobeIcons } from '../../scripts/sync-lobe-icons.mjs';

const GENERATED_DIR = join(ROOT, 'public', 'lobe-icons');
const RENDERER = join(ROOT, 'src', 'pages', 'Chat', 'ChatInput.tsx');

/**
 * `public/lobe-icons` is generated, not vendored: the bytes come from the
 * MIT-licensed `@lobehub/assets-fileicon` dependency (issue #82). These tests
 * pin the two halves of that contract — the generator reproduces the served
 * bytes, and the renderer still asks for them at `/lobe-icons/<name>.svg`.
 */
describe('lobe file-type icon assets are generated, not vendored', () => {
  const scratchDirs: string[] = [];

  afterAll(() => {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  });

  function scratchTarget(): string {
    const dir = join(mkdtempSync(join(tmpdir(), 'lobe-icons-')), 'lobe-icons');
    scratchDirs.push(dir);
    return dir;
  }

  it('regenerates every icon from the pinned dependency and records provenance', () => {
    const targetDir = scratchTarget();
    const report = syncLobeIcons({ targetDir });

    expect(report.name).toBe('@lobehub/assets-fileicon');
    expect(report.license).toBe('MIT');
    expect(report.iconCount).toBe(listSourceIcons().length);
    expect(report.iconCount).toBeGreaterThan(0);
    expect(collectDrift(targetDir)).toEqual({ missing: [], differing: [], extra: [], iconCount: report.iconCount });

    const provenance = JSON.parse(readFileSync(join(targetDir, 'PROVENANCE.json'), 'utf8'));
    expect(provenance.package).toBe('@lobehub/assets-fileicon');
    expect(provenance.version).toBe(readDependencyIdentity().version);
    expect(provenance.license).toBe('MIT');
    expect(provenance.servedAt).toBe('/lobe-icons/<iconName>.svg');
    expect(provenance.icons).toHaveLength(report.iconCount);
    expect(provenance.aggregateSha256).toBe(report.aggregateDigest);
  });

  it('is idempotent and detects drift', () => {
    const targetDir = scratchTarget();
    const first = syncLobeIcons({ targetDir });
    expect(first.copied).toBe(first.iconCount);

    const second = syncLobeIcons({ targetDir });
    expect(second.copied).toBe(0);
    expect(second.unchanged).toBe(second.iconCount);
    expect(collectDrift(targetDir).differing).toEqual([]);

    // A mutated icon must be reported, so a half-copied directory cannot pass.
    const [victim] = listSourceIcons();
    writeFileSync(join(targetDir, victim), '<svg/>');
    expect(collectDrift(targetDir).differing).toEqual([victim]);
  });

  it('keeps the generated tree out of Git', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'public/lobe-icons'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe('');

    const ignored = execFileSync('git', ['check-ignore', '--', 'public/lobe-icons/typescript.svg'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    expect(ignored).toBe('public/lobe-icons/typescript.svg');
  });

  it('keeps the renderer CDN contract aligned with the generated directory name', () => {
    // @lobehub/ui's MaterialFileTypeIcon resolves <cdnFn()>/<iconName>.svg, and
    // ChatInput points that base at ./lobe-icons. If either side moves, the
    // generated directory must move with it.
    expect(readFileSync(RENDERER, 'utf8')).toContain("new URL('./lobe-icons'");
  });

  it('has no drift when the checkout has already been generated', () => {
    if (!existsSync(GENERATED_DIR)) return;
    expect(collectDrift(GENERATED_DIR)).toEqual({
      missing: [],
      differing: [],
      extra: [],
      iconCount: listSourceIcons().length,
    });
  });
});
