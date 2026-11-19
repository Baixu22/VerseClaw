#!/usr/bin/env node
// Regression probe: an abbreviated fixture manifest must never qualify as
// RC-00 acceptance, even when its digests are recomputed. No gate is executed.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const outputDir = process.argv[2];
if (!outputDir) throw new Error('usage: node scripts/rc00-acceptance-bootstrap.mjs <output-dir>');

const lib = await import(pathToFileURL(join(repoRoot, 'scripts/lib/agent-engineering-acceptance.mjs')).href);
const {
  createAcceptancePlan,
  digestPlan,
  digestManifest,
  runAcceptance,
  verifyAcceptance,
  validateAcceptanceManifest,
} = lib;

// 1. Clean isolated fixture repository (real git repo, committed state).
const fixtureRoot = mkdtempSync(join(tmpdir(), 'rc00-bootstrap-fixture-'));
mkdirSync(join(fixtureRoot, 'harness', 'specs', 'tasks'), { recursive: true });
writeFileSync(join(fixtureRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
writeFileSync(join(fixtureRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
writeFileSync(join(fixtureRoot, '.npmrc'), 'strict-peer-dependencies=false\n');
writeFileSync(join(fixtureRoot, '.gitignore'), 'artifacts/\nopenclaw_runtime/apps/\n');
writeFileSync(join(fixtureRoot, 'harness', 'specs', 'tasks', 'fixture.md'), '---\nid: rc00-fixture\ntitle: RC-00 fixture\nhumanEvidence: not-required\n---\n# fixture\n');
mkdirSync(join(fixtureRoot, 'harness', 'src'), { recursive: true });
writeFileSync(join(fixtureRoot, 'harness', 'src', 'profiles.mjs'), readFileSync(join(repoRoot, 'harness/src/profiles.mjs')));
for (const path of [
  'resources/bin/win32-x64/vg.exe',
  'artifacts/uas-06-single-local-exec-canary/live-observations.json',
  'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json',
  'openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json',
]) {
  mkdirSync(join(fixtureRoot, path, '..'), { recursive: true });
  writeFileSync(join(fixtureRoot, path), '{}\n');
}
const g = (args) => execFileSync('git', args, { cwd: fixtureRoot, stdio: 'pipe' });
g(['init', '--quiet']);
g(['config', 'user.email', 'rc00@example.invalid']);
g(['config', 'user.name', 'RC-00 Fixture']);
g(['add', '.']);
g(['commit', '--quiet', '-m', 'fixture']);
writeFileSync(join(fixtureRoot, 'candidate.txt'), 'candidate\n');
g(['add', 'candidate.txt']);
g(['commit', '--quiet', '-m', 'candidate']);

// 2. Build a manifest with a real gate that emits a parseable test summary.
const manifest = createAcceptancePlan({
  root: fixtureRoot,
  specPath: 'harness/specs/tasks/fixture.md',
  since: 'HEAD^',
  runId: 'rc00-bootstrap-proof',
  createdAt: new Date().toISOString(),
});
const original = validateAcceptanceManifest(manifest, { root: fixtureRoot, requireClean: true, requireFull: true });
if (!original.ok) throw new Error(`fixture plan is invalid: ${original.errors.join('; ')}`);
manifest.gates = [{
  id: 'rc00-real-gate',
  name: 'RC-00 real gate',
  profile: 'fast',
  command: 'node',
  args: ['-e', 'console.log("Tests 1 passed (1)")'],
  required: true,
  allowSkip: false,
  timeoutMs: 30_000,
  safety: { network: 'none', productionEffects: false, humanEvidence: false },
  testExpectation: { requireCounts: true, expectedSkips: 0 },
}];
manifest.planDigest = digestPlan(manifest);
manifest.manifestDigest = digestManifest(manifest);

const env = { PATH: process.env.PATH ?? '' };

// 3. Executor.
const executor = runAcceptance(manifest, { sourceRoot: fixtureRoot, outputDir, actor: 'rc00-executor', env });
console.log(JSON.stringify({ step: 'executor', result: executor.result, failures: executor.failures }));

// 4. The Verifier role must reject the same invalid fixture without running it.
const verifier = verifyAcceptance(manifest, { sourceRoot: fixtureRoot, outputDir, actor: 'rc00-verifier', env, executorReport: executor });
console.log(JSON.stringify({
  step: 'verifier',
  result: verifier.result,
  engineeringAcceptedByAgent: verifier.engineeringAcceptedByAgent,
  executorActor: verifier.executorActor,
  verifierActor: verifier.verifierActor,
  failures: verifier.failures,
}));

try {
  rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
} catch (error) {
  const code = error?.code;
  if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw error;
}

if (
  executor.result !== 'NO-GO' || verifier.result !== 'NO-GO'
  || verifier.engineeringAcceptedByAgent !== false
  || !executor.failures.includes('manifest gates must match the candidate-derived gate contracts')
  || executor.gates.length !== 0 || verifier.gates.length !== 0
) {
  console.error('RC-00 incomplete-gate regression FAILED');
  process.exitCode = 1;
} else {
  console.log('RC-00 incomplete-gate regression PASSED (engineering acceptance remains NO-GO)');
}
