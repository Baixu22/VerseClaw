import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const pnpm = process.env.npm_execpath;
if (!/(?:^|[\\/])pnpm\.(?:mjs|cjs|js)$/.test(pnpm ?? '')) {
  throw new Error('Run this entry through pnpm run harness:ci.');
}
const entryIdentity = process.platform === 'win32' ? resolve(pnpm).toLowerCase() : resolve(pnpm);
if (process.env.CLAWX_HARNESS_CI_ACTIVE_PNPM === entryIdentity) {
  throw new Error('Recursive Harness CI invocation of the same pnpm entry is refused.');
}
const childEnv = { ...process.env, CLAWX_HARNESS_CI_ACTIVE_PNPM: entryIdentity };
const stages = [
  ['harness', 'list'],
  ['harness', 'validate', '--spec', 'harness/specs/scenarios/gateway-backend-communication.md'],
  ['harness', 'validate', '--spec', 'harness/specs/tasks/fix-chat-history-gateway-timeout.example.md', '--no-diff'],
  ['harness', 'run', '--spec', 'harness/specs/scenarios/gateway-backend-communication.md', '--dry-run'],
  ['exec', 'vitest', 'run', 'tests/unit/harness-specs.test.ts', 'tests/unit/harness-git.test.ts', 'tests/unit/harness-spec-lifecycle.test.ts', 'tests/unit/docs-index.test.ts', 'tests/unit/runtime-source-policy.test.ts', 'tests/unit/harness-ci-runner.test.ts'],
  ['harness:specs:lifecycle'],
  ['repo:duplicates:check'],
  ['docs:policy:validate'],
  ['catalogs:check'],
  ['agent-dev:audit'],
  ['repo:evidence:check'],
  ['repo:test-coverage:check'],
];
const output = resolve(process.env.CLAWX_HARNESS_CI_REPORT ?? 'artifacts/harness/ci-report.json');
const report = { schema: 'HarnessCiReport/v1', actor: 'harness-ci', driven_by: 'agent', success: false, totalStages: stages.length, results: [] };
mkdirSync(dirname(output), { recursive: true });
for (const args of stages) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: process.cwd(), env: childEnv, stdio: 'inherit', windowsHide: true });
  const exitCode = result.status ?? 1;
  report.results.push({ args, exitCode, durationMs: Date.now() - startedAt, ...(result.error ? { error: result.error.message } : {}) });
  report.success = exitCode === 0 && report.results.length === stages.length;
  writeFileSync(output, JSON.stringify(report, null, 2));
  if (exitCode !== 0) { process.exitCode = exitCode; break; }
}
console.log(JSON.stringify({ success: report.success, completedStages: report.results.length, totalStages: stages.length, report: output }));
