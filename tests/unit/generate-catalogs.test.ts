// R6: generated catalog precedent — the generated files must be byte-equal to
// the same-module source exports, and --check must fail closed on any drift.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listCoreToolSections,
  resolveCoreToolProfiles,
} from '../../openclaw_runtime/src/agents/tool-catalog';
import { DCS_PROD_FLAGS } from '../../shared/dcs/prod-flags-catalog';
import {
  checkCatalogs,
  generateCatalogs,
  setCatalogResolvers,
} from '../../scripts/generate-catalogs.mjs';

const tempDirs: string[] = [];

beforeEach(() => {
  // The generator resolves profiles through the injected live resolver; keep
  // it wired to the real source export in every test.
  setCatalogResolvers({ resolveCoreToolProfiles });
});

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempOutDir() {
  const dir = await mkdtemp(join(tmpdir(), 'r6-catalogs-'));
  tempDirs.push(dir);
  return dir;
}

describe('generated catalogs (R6-4)', () => {
  it('renders every tool and flag from the same-module source exports', async () => {
    const outDir = await tempOutDir();
    const pinned = '2026-08-14T00:00:00.000Z';
    const result = await generateCatalogs({ outDir, now: pinned });

    expect(result.sections).toHaveLength(listCoreToolSections().length);
    expect(result.flags).toHaveLength(DCS_PROD_FLAGS.length);

    const toolsText = await readFile(join(outDir, 'tools.md'), 'utf8');
    expect(toolsText).toContain('GENERATED FILE — DO NOT EDIT');
    expect(toolsText).toContain('openclaw_runtime/src/agents/tool-catalog.ts');
    expect(toolsText).toContain('Generated at: ' + pinned);
    for (const section of listCoreToolSections()) {
      expect(toolsText).toContain('## ' + section.label);
      for (const tool of section.tools) {
        expect(toolsText).toContain(tool.id);
        expect(toolsText).toContain(tool.description);
        for (const profile of resolveCoreToolProfiles(tool.id)) {
          expect(toolsText).toContain(profile);
        }
      }
    }

    const flagsText = await readFile(join(outDir, 'prod-flags.md'), 'utf8');
    expect(flagsText).toContain('shared/dcs/prod-flags-catalog.ts');
    for (const flag of DCS_PROD_FLAGS) {
      expect(flagsText).toContain('## ' + flag.id);
      expect(flagsText).toContain(flag.key);
      expect(flagsText).toContain(JSON.stringify(flag.defaultValue));
      expect(flagsText).toContain(flag.risk);
      expect(flagsText).toContain(flag.enable);
      expect(flagsText).toContain(flag.rollback);
      expect(flagsText).toContain(flag.riskNote);
    }
  });

  it('is byte-deterministic for a pinned timestamp', async () => {
    const outDir = await tempOutDir();
    const pinned = '2026-08-14T00:00:00.000Z';
    const first = await generateCatalogs({ outDir, now: pinned });
    const second = await generateCatalogs({ outDir, now: pinned });
    expect(second.toolsMarkdown).toBe(first.toolsMarkdown);
    expect(second.flagsMarkdown).toBe(first.flagsMarkdown);
  });

  it('--check passes on fresh output and fails closed on stale or missing files', async () => {
    const outDir = await tempOutDir();
    const pinned = '2026-08-14T00:00:00.000Z';
    await generateCatalogs({ outDir, now: pinned });

    // Fresh: content is compared with the generated-at line stripped, so a
    // later clock cannot make the check red on its own.
    const fresh = await checkCatalogs({ outDir, now: '2026-08-15T00:00:00.000Z' });
    expect(fresh.fresh).toBe(true);

    // Stale / hand-edited: one drifted line must fail closed.
    const toolsPath = join(outDir, 'tools.md');
    const original = await readFile(toolsPath, 'utf8');
    await writeFile(toolsPath, original.replace('Read file contents', 'HAND EDITED'), 'utf8');
    const stale = await checkCatalogs({ outDir, now: pinned });
    expect(stale.fresh).toBe(false);
    expect(stale.issues.some((issue) => issue.file === 'tools')).toBe(true);
    // --check must never write disk: the drifted content stays untouched.
    expect(await readFile(toolsPath, 'utf8')).toContain('HAND EDITED');
    await writeFile(toolsPath, original, 'utf8');

    // Missing file: fail closed with the missing-file reason.
    await rm(join(outDir, 'prod-flags.md'), { force: true });
    const missing = await checkCatalogs({ outDir, now: pinned });
    expect(missing.fresh).toBe(false);
    expect(missing.issues.some((issue) => issue.file === 'prod-flags')).toBe(true);
  });
});
