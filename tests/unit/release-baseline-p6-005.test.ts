import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCleanReleaseTree,
  createReleaseBaselineManifest,
  resolveReleaseIdentity,
} from '../../scripts/release-baseline-manifest.mjs';
import {
  canonicalReleaseConfigText,
  resolveReleaseBaselinePaths,
  validateReleaseBaseline,
  validateReleaseWorkflowBaselinePolicy,
} from '../../scripts/validate-release-baseline.mjs';
import { runReleaseGateCommand } from '../../scripts/lib/run-release-gate-command.mjs';
import { sha256CanonicalEvidenceFile } from '../../scripts/lib/canonical-evidence-hash.mjs';

const roots: string[] = [];
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'clawx-p6-005-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'p6-005@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'P6-005'], { cwd: root });
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.2.3"}\n');
  await writeFile(join(root, 'z.txt'), 'z\n');
  await writeFile(join(root, 'a.txt'), 'a\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['tag', 'v1.2.3'], { cwd: root });
  return { root, commit, ref: 'refs/tags/v1.2.3', version: '1.2.3' };
}

const fixtureGatesText = `${JSON.stringify({ loops: { release: { commands: [{ id: 'full', run: 'pnpm test' }] } } }, null, 2)}\n`;
const fixtureWorkflowText = 'jobs:\n  release-baseline:\n    steps:\n      - run: node scripts/collect-p6-005-evidence.mjs\n      - name: release-baseline\n  release:\n    needs: release-baseline\n    steps:\n      - run: node scripts/validate-release-baseline.mjs\n';

async function evidenceFixture(
  base: Awaited<ReturnType<typeof fixture>>,
  options: { evidenceDir?: string; gatesPath?: string; workflowPath?: string } = {},
) {
  const manifestText = createReleaseBaselineManifest(base);
  const evidenceDir = options.evidenceDir || join(base.root, '.evidence');
  const gatesDir = join(evidenceDir, 'gates');
  await mkdir(gatesDir, { recursive: true });
  const gatesPath = options.gatesPath || join(evidenceDir, 'gates.json');
  await mkdir(dirname(gatesPath), { recursive: true });
  await writeFile(gatesPath, fixtureGatesText);
  const workflowPath = options.workflowPath || join(evidenceDir, 'release.yml');
  await mkdir(dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, fixtureWorkflowText);
  const stdout = 'passed\n';
  const stderr = '';
  await writeFile(join(gatesDir, 'runtime-build-preflight.stdout.txt'), stdout);
  await writeFile(join(gatesDir, 'runtime-build-preflight.stderr.txt'), stderr);
  await writeFile(join(gatesDir, 'full.stdout.txt'), stdout);
  await writeFile(join(gatesDir, 'full.stderr.txt'), stderr);
  const manifestPath = join(evidenceDir, 'release-source-manifest.json');
  await writeFile(manifestPath, manifestText);
  const evidencePath = join(evidenceDir, 'release-gate-evidence.json');
  await writeFile(
    evidencePath,
    `${JSON.stringify({
      schemaVersion: 1,
      ...base,
      manifestSha256: sha256(manifestText),
      gatesConfigSha256: sha256(canonicalReleaseConfigText(fixtureGatesText)),
      preflight: {
        id: 'runtime-build-preflight', command: 'pnpm build:runtime', exitCode: 0,
        stdoutPath: 'gates/runtime-build-preflight.stdout.txt', stdoutSha256: sha256(stdout),
        stderrPath: 'gates/runtime-build-preflight.stderr.txt', stderrSha256: sha256(stderr),
      },
      gates: [{
        id: 'full', command: 'pnpm test', exitCode: 0,
        stdoutPath: 'gates/full.stdout.txt', stdoutSha256: sha256(stdout),
        stderrPath: 'gates/full.stderr.txt', stderrSha256: sha256(stderr),
      }],
    })}\n`,
  );
  return { manifestPath, evidencePath, gatesPath, workflowPath };
}

async function canonicalEvidenceFixture() {
  const initial = await fixture();
  const gatesPath = join(initial.root, 'plans/system-maturity/gates.json');
  const workflowPath = join(initial.root, '.github/workflows/release.yml');
  await mkdir(dirname(gatesPath), { recursive: true });
  await mkdir(dirname(workflowPath), { recursive: true });
  await writeFile(gatesPath, fixtureGatesText);
  await writeFile(workflowPath, fixtureWorkflowText);
  execFileSync('git', ['add', 'plans', '.github'], { cwd: initial.root });
  execFileSync('git', ['commit', '-m', 'release baseline config'], { cwd: initial.root });
  const current = {
    ...initial,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: initial.root, encoding: 'utf8' }).trim(),
    ref: 'refs/heads/main',
  };
  await writeFile(join(initial.root, '.git/info/exclude'), 'artifacts/\n');
  const evidenceDir = join(initial.root, 'artifacts/system-maturity/P6-005');
  return {
    ...current,
    priorRef: initial.ref,
    ...await evidenceFixture(current, { evidenceDir, gatesPath, workflowPath }),
  };
}

describe('P6-005 clean release baseline', () => {
  it('A2 rebuilds runtime and redacts local paths before collecting release gates', async () => {
    const collector = await readFile(join(process.cwd(), 'scripts/collect-p6-005-evidence.mjs'), 'utf8');
    const preflightIndex = collector.indexOf("captureCommand('runtime-build-preflight'");
    const releaseGateIndex = collector.indexOf('for (const gate of required)');
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(releaseGateIndex).toBeGreaterThan(preflightIndex);
    expect(collector).toContain('normalizeCapturedOutput(text');
    expect(collector).toContain('workspaceRoot: root');
    expect(collector).toContain('userHome: process.env.USERPROFILE || homedir()');
  });

  it('A2 preserves native release gate exit codes on the host shell', () => {
    const passed = runReleaseGateCommand('node -e "process.exit(0)"', { cwd: process.cwd() });
    const failed = runReleaseGateCommand('node -e "process.exit(7)"', { cwd: process.cwd() });
    expect(passed.status).toBe(0);
    expect(failed.status).toBe(7);
  });

  it('A2 hashes text evidence identically across LF and CRLF worktrees', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-evidence-lines-'));
    roots.push(root);
    const lf = join(root, 'lf.txt');
    const crlf = join(root, 'crlf.txt');
    await writeFile(lf, 'first\nsecond\n');
    await writeFile(crlf, 'first\r\nsecond\r\n');
    expect(sha256CanonicalEvidenceFile(crlf)).toBe(sha256CanonicalEvidenceFile(lf));
  });

  it('A1 denies modified, staged, and untracked source state', async () => {
    const clean = await fixture();
    expect(assertCleanReleaseTree(clean.root)).toBe(true);
    await writeFile(join(clean.root, 'untracked.txt'), 'nope\n');
    expect(() => assertCleanReleaseTree(clean.root)).toThrow(/dirty/i);
  });

  it('A1 binds HEAD to the exact requested tag and version', async () => {
    const clean = await fixture();
    expect(resolveReleaseIdentity(clean)).toMatchObject({ commit: clean.commit, ref: clean.ref });
    expect(() => resolveReleaseIdentity({ ...clean, commit: '0'.repeat(40) })).toThrow(/commit mismatch/i);
    expect(() => resolveReleaseIdentity({ ...clean, ref: 'refs/heads/main' })).not.toThrow();
    expect(() => resolveReleaseIdentity({ ...clean, ref: 'refs/tags/v9.9.9' })).toThrow();
  });

  it('A1 resolves canonical evidence without explicit paths and fails closed for dirty or old refs', async () => {
    const clean = await canonicalEvidenceFixture();
    expect(resolveReleaseBaselinePaths({ root: clean.root })).toMatchObject({
      manifestPath: clean.manifestPath,
      evidencePath: clean.evidencePath,
      gatesPath: clean.gatesPath,
      workflowPath: clean.workflowPath,
    });
    expect(() => validateReleaseBaseline({ root: clean.root })).not.toThrow();

    const childEnv = { ...process.env };
    delete childEnv.GITHUB_REF;
    delete childEnv.GITHUB_SHA;
    const output = execFileSync(
      process.execPath,
      [join(process.cwd(), 'scripts/validate-release-baseline.mjs'), '--root', clean.root],
      { encoding: 'utf8', env: childEnv },
    );
    expect(output).toContain('[release-baseline] validation OK');

    expect(() => validateReleaseBaseline({ root: clean.root, ref: clean.priorRef })).toThrow(
      /release ref\/commit mismatch/i,
    );
    await writeFile(join(clean.root, 'untracked.txt'), 'nope\n');
    expect(() => validateReleaseBaseline({ root: clean.root })).toThrow(/dirty/i);
  });

  it('A1 rejects canonical evidence when HEAD advances beyond its recorded source ref', async () => {
    const clean = await canonicalEvidenceFixture();
    execFileSync('git', ['commit', '--allow-empty', '-m', 'advance head'], { cwd: clean.root });
    expect(() => validateReleaseBaseline({ root: clean.root })).toThrow(
      /release source manifest commit mismatch/i,
    );
  });

  it('A3 regenerates a sorted source manifest byte-for-byte', async () => {
    const clean = await fixture();
    const first = createReleaseBaselineManifest(clean);
    const second = createReleaseBaselineManifest(clean);
    expect(second).toBe(first);
    const parsed = JSON.parse(first);
    expect(parsed.files.map((entry: { path: string }) => entry.path)).toEqual([
      'a.txt',
      'package.json',
      'z.txt',
    ]);
    expect(parsed.files.find((entry: { path: string }) => entry.path === 'a.txt')).toMatchObject({
      bytes: 2,
      sha256: sha256('a\n'),
    });
  });

  it('A2 denies missing, tampered, or nonzero full-gate evidence', async () => {
    const clean = await fixture();
    const evidence = await evidenceFixture(clean);
    expect(() => validateReleaseBaseline({ ...clean, ...evidence, evidenceOnly: true })).not.toThrow();
    const gatesText = await readFile(evidence.gatesPath, 'utf8');
    await writeFile(evidence.gatesPath, gatesText.replace(/\n/g, '\r\n'));
    expect(() => validateReleaseBaseline({ ...clean, ...evidence, evidenceOnly: true })).not.toThrow();
    const doc = JSON.parse(await readFile(evidence.evidencePath, 'utf8'));
    doc.preflight.exitCode = 1;
    await writeFile(evidence.evidencePath, JSON.stringify(doc));
    expect(() => validateReleaseBaseline({ ...clean, ...evidence, evidenceOnly: true })).toThrow(/runtime preflight failed/i);
    doc.preflight.exitCode = 0;
    doc.gates[0].exitCode = 1;
    await writeFile(evidence.evidencePath, JSON.stringify(doc));
    expect(() => validateReleaseBaseline({ ...clean, ...evidence, evidenceOnly: true })).toThrow(/failed/i);
  });

  it('A1 requires release packaging to depend on the baseline evidence job', async () => {
    const workflow = await readFile(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    expect(validateReleaseWorkflowBaselinePolicy(workflow)).toMatchObject({
      baselineJob: true,
      packagingDependency: true,
      evidenceTransfer: true,
    });
    expect(() => validateReleaseWorkflowBaselinePolicy(workflow.replace('needs: release-baseline', 'needs: validate-release'))).toThrow(/anchors missing/i);
  });
});
