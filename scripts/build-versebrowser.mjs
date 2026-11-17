#!/usr/bin/env node
// Compile the embedded package without nested package-manager processes.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const manifest = new URL('../packages/versebrowser/package.json', import.meta.url);
const cwd = fileURLToPath(new URL('.', manifest));
const require = createRequire(manifest);
for (const args of [
  ['scripts/patch-upstream.mjs'],
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
