/**
 * Lightweight smoke for DCS P0 opt-in packaging.
 * Verifies catalog honesty + runtime safe defaults. Does not flip flags.
 *
 *   node scripts/dcs-prod-p0-smoke.mjs
 *   pnpm run dcs:prod-p0:smoke
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--dir', 'openclaw_runtime', 'exec', 'node', '--import', 'tsx', 'scripts/coding-prod-p0-packaging.mts'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('dcs-prod-p0-smoke: ok (defaults unchanged, packaging report written)');