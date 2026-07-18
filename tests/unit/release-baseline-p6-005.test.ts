import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCleanReleaseTree,
  createReleaseBaselineManifest,
  resolveReleaseIdentity,
} from '../../scripts/release-baseline-manifest.mjs';
import {
  canonicalReleaseConfigText,
  validateReleaseBaseline,
  validateReleaseWorkflowBaselinePolicy,
} from '../../scripts/validate-release-baseline.mjs';

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

async function evidenceFixture(base: Awaited<ReturnType<typeof fixture>>) {
  const manifestText = createReleaseBaselineManifest(base);
  const evidenceDir = join(base.root, '.evidence');
  const gatesDir = join(evidenceDir, 'gates');
  await mkdir(gatesDir, { recursive: true });
  const gatesPath = join(evidenceDir, 'gates.json');
  const gatesText = `${JSON.stringify({ loops: { release: { commands: [{ id: 'full', run: 'pnpm test' }] } } }, null, 2)}\n`;
  await writeFile(gatesPath, gatesText);
  const workflowPath = join(evidenceDir, 'release.yml');
  await writeFile(
    workflowPath,
    'jobs:\n  release-baseline:\n    steps:\n      - run: node scripts/collect-p6-005-evidence.mjs\n      - name: release-baseline\n  release:\n    needs: release-baseline\n    steps:\n      - run: node scripts/validate-release-baseline.mjs\n',
  );
  const stdout = 'passed\n';
  const stderr = '';
  await writeFile(join(gatesDir, 'full.stdout.txt'), stdout);
  await writeFile(join(gatesDir, 'full.stderr.txt'), stderr);
  const manifestPath = join(evidenceDir, 'manifest.json');
  await writeFile(manifestPath, manifestText);
  const evidencePath = join(evidenceDir, 'release-gate-evidence.json');
  await writeFile(
    evidencePath,
    `${JSON.stringify({
      schemaVersion: 1,
      ...base,
      manifestSha256: sha256(manifestText),
      gatesConfigSha256: sha256(canonicalReleaseConfigText(gatesText)),
      gates: [{
        id: 'full', command: 'pnpm test', exitCode: 0,
        stdoutPath: 'gates/full.stdout.txt', stdoutSha256: sha256(stdout),
        stderrPath: 'gates/full.stderr.txt', stderrSha256: sha256(stderr),
      }],
    })}\n`,
  );
  return { manifestPath, evidencePath, gatesPath, workflowPath };
}

describe('P6-005 clean release baseline', () => {
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
