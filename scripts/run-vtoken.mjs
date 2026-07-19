import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'packages', 'vtoken');
const binName = process.platform === 'win32' ? 'uv.exe' : 'uv';
const bundledUv = path.join(
  root,
  'resources',
  'bin',
  `${process.platform}-${process.arch}`,
  binName,
);
const uvBin = process.env.UV_BIN?.trim() || (existsSync(bundledUv) ? bundledUv : binName);

const commands = {
  test: ['run', '--directory', packageRoot, '--python', '3.12', '--with', 'pytest', 'python', 'scripts/run_tests.py'],
  bench: ['run', '--directory', packageRoot, '--python', '3.12', 'python', 'benchmarks/p5_multi_source_density.py'],
  worker: ['run', '--directory', packageRoot, '--python', '3.12', 'python', 'scripts/run_host_rpc.py'],
};

const command = process.argv[2];
const args = commands[command];
if (!args) {
  console.error('Usage: node scripts/run-vtoken.mjs <test|bench|worker>');
  process.exit(2);
}

const result = spawnSync(uvBin, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`Failed to start uv (${uvBin}): ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
