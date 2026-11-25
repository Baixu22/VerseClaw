// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const buildScriptPath = path.join(root, 'scripts', 'build-openclaw-runtime.mjs');
const smokeScriptPath = path.join(root, 'scripts', 'smoke-openclaw-runtime.mjs');
const sekbEntryPath = path.join(
  root,
  'openclaw_runtime',
  'dist',
  'knowledge',
  'sekb',
  'index.js',
);

describe('SEKB runtime build contract', () => {
  it('refreshes static plugin assets in both package trees without restaging the overlay', async () => {
    const moduleUrl = pathToFileURL(path.join(root, 'openclaw_runtime/scripts/runtime-postbuild.mjs')).href;
    const { copyRuntimeStaticExtensionAssets } = await import(moduleUrl);
    const rootDir = mkdtempSync(path.join(tmpdir(), 'runtime-static-assets-'));
    try {
      const src = 'extensions/sample/worker.mjs';
      const dest = 'dist/extensions/sample/worker.mjs';
      const overlay = path.join(rootDir, 'dist-runtime/extensions/sample');
      mkdirSync(path.join(rootDir, 'extensions/sample'), { recursive: true });
      mkdirSync(overlay, { recursive: true });
      writeFileSync(path.join(rootDir, src), 'new worker');
      writeFileSync(path.join(overlay, 'worker.mjs'), 'old worker');
      writeFileSync(path.join(overlay, 'entry.js'), 'existing wrapper');
      const options = { rootDir, assets: [{ src, dest, pluginDir: 'sample' }] };
      copyRuntimeStaticExtensionAssets({ ...options, env: { OPENCLAW_RUNTIME_POSTBUILD_STATIC_ASSETS: '0' } });
      expect(existsSync(path.join(rootDir, dest))).toBe(false);
      expect(readFileSync(path.join(overlay, 'worker.mjs'), 'utf8')).toBe('old worker');
      copyRuntimeStaticExtensionAssets({ ...options, env: {} });
      expect(readFileSync(path.join(rootDir, dest), 'utf8')).toBe('new worker');
      expect(readFileSync(path.join(overlay, 'worker.mjs'), 'utf8')).toBe('new worker');
      expect(readFileSync(path.join(overlay, 'entry.js'), 'utf8')).toBe('existing wrapper');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('builds an importable stable host entry with the required exports', () => {
    execFileSync(process.execPath, [buildScriptPath, '--sekb-only'], {
      cwd: root,
      stdio: 'pipe',
    });

    expect(existsSync(sekbEntryPath)).toBe(true);
    const moduleUrl = pathToFileURL(sekbEntryPath).href;
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const m = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(['KnowledgeStore', 'DistillationTool', 'TrajectoryCapture', 'RetrievalEngine'].filter((key) => typeof m[key] !== 'function')));`,
      ],
      { cwd: root, encoding: 'utf8' },
    );

    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout)).toEqual([]);
  }, 120_000);

  it('restores and smoke-checks the SEKB entry after the full runtime clean build', () => {
    const buildSource = readFileSync(buildScriptPath, 'utf8');
    const smokeSource = readFileSync(smokeScriptPath, 'utf8');
    const assetBuildIndex = buildSource.indexOf("bundled-plugin-assets.mjs'), ['--phase', 'build']");
    const fullBuildIndex = buildSource.indexOf("build-all.mjs'), ['cliStartup']");
    const sekbBuildIndex = buildSource.indexOf("runNodeScript(SCRIPT_PATH, ['--sekb-only'], ROOT)");
    const staticAssetsIndex = buildSource.indexOf('copyRuntimeStaticExtensionAssets();');
    const assetCopyIndex = buildSource.indexOf("bundled-plugin-assets.mjs'), ['--phase', 'copy']");
    const smokeIndex = buildSource.indexOf("smoke-openclaw-runtime.mjs'), [], ROOT");

    expect(assetBuildIndex).toBeGreaterThanOrEqual(0);
    expect(fullBuildIndex).toBeGreaterThan(assetBuildIndex);
    expect(sekbBuildIndex).toBeGreaterThan(fullBuildIndex);
    expect(staticAssetsIndex).toBeGreaterThan(sekbBuildIndex);
    expect(assetCopyIndex).toBeGreaterThan(staticAssetsIndex);
    expect(buildSource).not.toMatch(/runNodeScript\([^;]*runtime-postbuild\.mjs/);
    expect(smokeIndex).toBeGreaterThan(assetCopyIndex);
    expect(smokeSource).toContain("'knowledge', 'sekb', 'index.js'");
    expect(smokeSource).toContain("'TrajectoryCapture'");
    expect(smokeSource).toContain("'RetrievalEngine'");
  });
});
