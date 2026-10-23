#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUT = join(ROOT, 'harness/specs/fixtures/versegit-product-integration/f3');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const commands: Array<Record<string, unknown>> = [];

async function run(name: string, argv: string[]) {
  const started = Date.now();
  try {
    const result = await execFileAsync(argv[0]!, argv.slice(1), {
      cwd: ROOT,
      env: { ...process.env, TEMP: 'D:\\tmp', TMP: 'D:\\tmp' },
      timeout: 300_000,
      windowsHide: true,
      shell: process.platform === 'win32',
      maxBuffer: 24 * 1024 * 1024,
    });
    commands.push({ name, argv, exitCode: 0, durationMs: Date.now() - started, stdoutTail: result.stdout.slice(-4000), stderrTail: result.stderr.slice(-4000) });
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    commands.push({ name, argv, exitCode: typeof failure.code === 'number' ? failure.code : 1, durationMs: Date.now() - started, stdoutTail: String(failure.stdout ?? '').slice(-4000), stderrTail: String(failure.stderr ?? failure.message ?? '').slice(-4000) });
    throw error;
  }
}

await run('assemble', [process.execPath, 'scripts/versegit-sidecar-package.mjs']);
await run('unit', [pnpm, 'exec', 'vitest', 'run', 'tests/unit/versegit-sidecar-delivery.test.ts', 'tests/unit/versegit-host-api.test.ts']);
await run('e2', [pnpm, 'exec', 'playwright', 'test', 'tests/e2e/versegit-diagnostics.spec.ts']);
await run('contract', [pnpm, 'contract:check']);
await run('harness', [pnpm, 'harness', 'validate', '--spec', 'harness/specs/tasks/versegit-product-f3-sidecar-delivery.md']);
await run('package-verify', [process.execPath, 'scripts/versegit-sidecar-package.mjs', '--verify']);
if (!existsSync(join(OUT, 'sidecar-package-manifest.json'))) throw new Error('sidecar package manifest evidence is missing');
const packageEvidence = JSON.parse(readFileSync(join(OUT, 'sidecar-package-manifest.json'), 'utf8'));
packageEvidence.verificationCommands = commands;
writeFileSync(join(OUT, 'sidecar-package-manifest.json'), JSON.stringify(packageEvidence, null, 2) + '\n', 'utf8');
const provenance = JSON.parse(readFileSync(join(OUT, 'build-provenance.json'), 'utf8'));
provenance.verificationCommands = commands;
writeFileSync(join(OUT, 'build-provenance.json'), JSON.stringify(provenance, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ok: true, commands: commands.map((entry) => ({ name: entry.name, exitCode: entry.exitCode, durationMs: entry.durationMs })) }, null, 2));
