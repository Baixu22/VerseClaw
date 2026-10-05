// @vitest-environment node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'verseconf-sync-'));
  roots.push(root);
  const plugin = path.join(root, 'openclaw_runtime/extensions/verseconf-artifacts');
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(plugin, 'vendor/verseconf'), { recursive: true });
  cpSync(path.join(repo, 'scripts/sync-verseconf.mjs'), path.join(root, 'scripts/sync-verseconf.mjs'));
  writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ openclaw: { build: { staticAssets: [{ source: 'schemas/keep.json', output: 'schemas/keep.json' }] } } }));
  writeFileSync(path.join(plugin, 'vendor/verseconf/previous.txt'), 'old module');
  const source = path.join(root, 'input');
  cpSync(path.join(repo, 'openclaw_runtime/extensions/verseconf-artifacts/vendor/verseconf'), source, { recursive: true });
  const digest = createHash('sha256').update(readFileSync(path.join(source, 'delivery-manifest.json'))).digest('hex');
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/sync-verseconf.mjs'), '--from', source, '--manifest-sha256', digest, '--backup-dir', path.join(root, 'backups')], { cwd: root, encoding: 'utf8', windowsHide: true });
  return { root, plugin, source, run };
}

describe('local VerseConf module synchronization', () => {
  it('does not autofix hash-locked generated declarations', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: repo, fix: true });
    for (const directory of ['pkg', 'pkg-web']) {
      const filePath = path.join(repo, 'openclaw_runtime/extensions/verseconf-artifacts/vendor/verseconf', directory, 'verseconf_wasm_bg.wasm.d.ts');
      const results = await eslint.lintText(readFileSync(filePath, 'utf8'), { filePath });
      expect(results).toHaveLength(1);
      expect(results[0].output).toBeUndefined();
    }
  });

  it('build pruning keeps declared module types and still removes stray emitted declarations', async () => {
    const env = setup();
    expect(env.run().status).toBe(0);
    const runtimeRoot = path.join(env.root, 'openclaw_runtime');
    const stray = path.join(env.plugin, 'stray');
    writeFileSync(`${stray}.js`, 'export {};');
    writeFileSync(`${stray}.d.ts`, 'export {};');
    const moduleUrl = new URL('../../openclaw_runtime/scripts/tsdown-build.mjs', import.meta.url);
    const { pruneUntrackedGeneratedSourceDeclarations } = await import(moduleUrl.href) as {
      pruneUntrackedGeneratedSourceDeclarations: (params: {
        cwd: string;
        spawnSync: () => { status: number; stdout: string };
      }) => number;
    };
    const removed = pruneUntrackedGeneratedSourceDeclarations({
      cwd: runtimeRoot,
      spawnSync: () => ({ status: 0, stdout: 'extensions/verseconf-artifacts/vendor/verseconf/worker/index.d.ts\nextensions/verseconf-artifacts/stray.d.ts\n' }),
    });
    expect(removed).toBe(1);
    expect(existsSync(path.join(env.plugin, 'vendor/verseconf/worker/index.d.ts'))).toBe(true);
    expect(existsSync(`${stray}.d.ts`)).toBe(false);
  });
  it.each([false, true])('materializes complete runtime overlay assets before cleanup (dist fallback: %s)', async (distFallback) => {
    const env = setup();
    expect(env.run().status).toBe(0);
    const runtimeRoot = path.join(env.root, 'openclaw_runtime');
    mkdirSync(path.join(env.plugin, 'schemas'), { recursive: true });
    writeFileSync(path.join(env.plugin, 'schemas/keep.json'), '{}');
    const metadata = JSON.parse(readFileSync(path.join(env.plugin, 'package.json'), 'utf8'));
    const assets = metadata.openclaw.build.staticAssets
      .filter((asset: { source: string }) => asset.source !== 'schemas/keep.json')
      .map((asset: { source: string; output: string }) => ({
        pluginDir: 'verseconf-artifacts',
        src: `extensions/verseconf-artifacts/${asset.source}`,
        dest: `dist/extensions/verseconf-artifacts/${asset.output}`,
      }));
    const distPlugin = path.join(runtimeRoot, 'dist/extensions/verseconf-artifacts');
    const overlayPlugin = path.join(runtimeRoot, 'dist-runtime/extensions/verseconf-artifacts');
    cpSync(env.plugin, distPlugin, { recursive: true });
    for (const asset of assets) {
      const target = path.join(runtimeRoot, 'dist-runtime', asset.dest.slice('dist/'.length));
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(path.join(runtimeRoot, asset.dest), target, process.platform === 'win32' ? 'junction' : 'file');
    }
    const declaration = 'vendor/verseconf/worker/index.d.ts';
    if (!distFallback) {
      rmSync(path.join(overlayPlugin, declaration), { force: true });
      symlinkSync(path.join(env.root, 'absent.d.ts'), path.join(overlayPlugin, declaration), process.platform === 'win32' ? 'junction' : 'file');
    } else {
      rmSync(env.plugin, { recursive: true });
    }
    const moduleUrl = new URL('../../openclaw_runtime/scripts/lib/static-extension-assets.mjs', import.meta.url);
    const { copyStaticExtensionAssetsToRuntimeOverlay } = await import(moduleUrl.href) as {
      copyStaticExtensionAssetsToRuntimeOverlay: (params: { rootDir: string; assets: typeof assets }) => void;
    };
    copyStaticExtensionAssetsToRuntimeOverlay({ rootDir: runtimeRoot, assets });
    copyStaticExtensionAssetsToRuntimeOverlay({ rootDir: runtimeRoot, assets });
    const cleanupUrl = new URL('../../scripts/after-pack.cjs', import.meta.url);
    const afterPack = await import(cleanupUrl.href) as {
      __test: { cleanupUnnecessaryFiles: (dir: string) => number };
    };
    afterPack.__test.cleanupUnnecessaryFiles(overlayPlugin);
    const manifest = JSON.parse(readFileSync(path.join(env.source, 'delivery-manifest.json'), 'utf8'));
    for (const entry of [{ path: 'delivery-manifest.json' }, ...manifest.files]) {
      const relative = `vendor/verseconf/${entry.path}`;
      const actual = path.join(overlayPlugin, relative);
      expect(lstatSync(actual).isFile(), relative).toBe(true);
      expect(lstatSync(actual).isSymbolicLink(), relative).toBe(false);
      const expected = readFileSync(path.join(env.source, entry.path));
      expect(readFileSync(actual).equals(expected), relative).toBe(true);
      expect(readFileSync(path.join(distPlugin, relative)).equals(expected), relative).toBe(true);
      if (!distFallback) expect(readFileSync(path.join(env.plugin, relative)).equals(expected), relative).toBe(true);
    }
  });

  it('imports the complete module and preserves the previous package outside the plugin', () => {
    const env = setup();
    const result = env.run();
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(readFileSync(path.join(receipt.backup, 'previous/previous.txt'), 'utf8')).toBe('old module');
    for (const file of ['worker/availability.mjs', 'worker/index.d.mts', 'pkg-web/verseconf_wasm_bg.wasm', 'bin/verseconf-mcp-wasm.mjs']) {
      expect(existsSync(path.join(env.plugin, 'vendor/verseconf', file))).toBe(true);
    }
    const metadata = JSON.parse(readFileSync(path.join(env.plugin, 'package.json'), 'utf8'));
    expect(metadata.openclaw.build.staticAssets).toContainEqual({ source: 'schemas/keep.json', output: 'schemas/keep.json' });
    expect(metadata.openclaw.build.staticAssets.some((a: { source: string }) => a.source === 'vendor/verseconf/worker/availability.mjs')).toBe(true);
  });

  it.each(['tamper', 'extra'])('rejects %s without replacing the old module', (kind) => {
    const env = setup();
    if (kind === 'tamper') writeFileSync(path.join(env.source, 'worker/index.mjs'), 'changed implementation');
    else { mkdirSync(path.join(env.source, 'research')); writeFileSync(path.join(env.source, 'research/process.txt'), 'not runtime'); }
    const result = env.run();
    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(env.plugin, 'vendor/verseconf/previous.txt'), 'utf8')).toBe('old module');
    expect(readdirSync(path.join(env.plugin, 'vendor/verseconf'))).toEqual(['previous.txt']);
  });
});
