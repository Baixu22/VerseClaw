// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
    const fullBuildIndex = buildSource.indexOf("build-all.mjs'), ['cliStartup']");
    const sekbBuildIndex = buildSource.indexOf("runNodeScript(SCRIPT_PATH, ['--sekb-only'], ROOT)");
    const smokeIndex = buildSource.indexOf("smoke-openclaw-runtime.mjs'), [], ROOT");

    expect(fullBuildIndex).toBeGreaterThanOrEqual(0);
    expect(sekbBuildIndex).toBeGreaterThan(fullBuildIndex);
    expect(smokeIndex).toBeGreaterThan(sekbBuildIndex);
    expect(smokeSource).toContain("'knowledge', 'sekb', 'index.js'");
    expect(smokeSource).toContain("'TrajectoryCapture'");
    expect(smokeSource).toContain("'RetrievalEngine'");
  });
});
