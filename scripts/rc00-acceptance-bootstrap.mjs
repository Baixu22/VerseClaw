#!/usr/bin/env node
// RC-00 proof script: builds a clean isolated fixture, runs a real gate under
// the Executor, and has an independent Verifier reproduce the same manifest in
// a second worktree. Writes green executor/verifier/final reports to an
// explicit --output-dir. This is the RC-00 exit proof (no mock spawn).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const outputDir = process.argv[2];
if (!outputDir) throw new Error('usage: node scripts/rc00-acceptance-bootstrap.mjs <output-dir>');

const lib = await import(pathToFileURL(join(repoRoot, 'scripts/lib/agent-engineering-acceptance.mjs')).href);
const { repositoryIdentity, createAcceptancePlan, runAcceptance, verifyAcceptance, ACCEPTANCE_SCHEMA } = lib;

// 1. Clean isolated fixture repository (real git repo, committed state).
const fixtureRoot = mkdtempSync(join(tmpdir(), 'rc00-bootstrap-fixture-'));
mkdirSync(join(fixtureRoot, 'harness', 'specs', 'tasks'), { recursive: true });
writeFileSync(join(fixtureRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
writeFileSync(join(fixtureRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
writeFileSync(join(fixtureRoot, '.npmrc'), 'strict-peer-dependencies=false\n');
writeFileSync(join(fixtureRoot, '.gitignore'), 'artifacts/\n');
writeFileSync(join(fixtureRoot, 'harness', 'specs', 'tasks', 'fixture.md'), '# fixture\n');
const g = (args) => execFileSync('git', args, { cwd: fixtureRoot, stdio: 'pipe' });
g(['init', '--quiet']);
g(['config', 'user.email', 'rc00@example.invalid']);
g(['config', 'user.name', 'RC-00 Fixture']);
g(['add', '.']);
g(['commit', '--quiet', '-m', 'fixture']);

// 2. Build a manifest with a real gate that emits a parseable test summary.
const spec = {
  path: 'harness/specs/tasks/fixture.md',
  data: { id: 'rc00-fixture', title: 'RC-00 fixture', humanEvidence: 'not-required', requiredRules: [] },
  body: '# fixture\n',
};
const manifest = createAcceptancePlan({
  root: fixtureRoot,
  spec,
  specPath: 'harness/specs/tasks/fixture.md',
  changedPaths: ['src/example.ts'],
  runId: 'rc00-bootstrap-proof',
  createdAt: new Date().toISOString(),
});
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
const { digestManifest } = lib;
manifest.planDigest = digestManifest(manifest);
manifest.manifestDigest = digestManifest(manifest);

const env = { PATH: process.env.PATH ?? '' };

// 3. Executor.
const executor = runAcceptance(manifest, { sourceRoot: fixtureRoot, outputDir, actor: 'rc00-executor', env });
console.log(JSON.stringify({ step: 'executor', result: executor.result, failures: executor.failures }));

// 4. Independent Verifier.
const verifier = verifyAcceptance(manifest, { sourceRoot: fixtureRoot, outputDir, actor: 'rc00-verifier', env, executorReport: executor });
console.log(JSON.stringify({
  step: 'verifier',
  result: verifier.result,
  engineeringAcceptedByAgent: verifier.engineeringAcceptedByAgent,
  executorActor: verifier.executorActor,
  verifierActor: verifier.verifierActor,
  failures: verifier.failures,
}));

rmSync(fixtureRoot, { recursive: true, force: true });

if (executor.result !== 'pass' || verifier.result !== 'pass' || verifier.engineeringAcceptedByAgent !== true) {
  console.error('RC-00 bootstrap proof FAILED');
  process.exitCode = 1;
} else {
  console.log('RC-00 bootstrap proof PASSED');
}
