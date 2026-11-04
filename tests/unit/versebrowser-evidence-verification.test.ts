// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyCurrent } from '../../scripts/versebrowser-evidence-verify.mjs';
import { verifyHostIntegration } from '../../scripts/versebrowser-host-integration-verify.mjs';

const roots: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
function write(root: string, file: string, content: string) {
  const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verse-evidence-test-')); roots.push(root);
  git(root, ['init', '--initial-branch=main']);
  write(root, 'shared/host-api/contract.ts', 'export const contract = 1;\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Agent fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  return root;
}
afterAll(() => {
  for (const root of roots) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture cleanup path');
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Verse evidence candidate identity', () => {
  it('rejects both dirty tracked changes and untracked source even when HEAD is unchanged', async () => {
    const root = fixture();
    const dir = 'harness/specs/fixtures/versebrowser-invocation-maturity/current-20261105';
    // Synthetic verifier fixture, never product/runtime acceptance evidence.
    const json = (file: string, value: unknown) => write(root, `${dir}/${file}`, JSON.stringify(value));
    const artifacts = ['Verse Claw.exe', 'resources/app.asar', 'resources/main-runtime.asar'].map(path => ({ path, bytes: 1, sha256: hash(path) }));
    const sourceCommit = git(root, ['rev-parse', 'HEAD']);
    const sourceTree = git(root, ['rev-parse', 'HEAD^{tree}']);
    const provenance = {schemaVersion:1,scope:'versebrowser-desktop-build-v1',status:'bound',driven_by:'agent',actor:'unit-fixture',sourceCommit,sourceTree,dirty:false,outputs:[
      {archive:'app.asar',path:'dist/index.html',sha256:hash('renderer')},
      {archive:'app.asar',path:'dist-electron/main/index.js',sha256:hash('main')},
      {archive:'main-runtime.asar',path:'node_modules/@verse-claw/versebrowser/dist/engine/service.js',sha256:hash('browser')},
    ]};
    const build = { schemaVersion: 2, artifacts, digest: hash(JSON.stringify(artifacts)), provenance, provenanceSha256:hash(JSON.stringify(provenance)+'\n') };
    const candidate = { driven_by: 'agent', actor: 'unit-fixture', dirty: false, sourceCommit, sourceTree, productBuildCommit:sourceCommit, build };
    json('candidate.json', candidate);
    json('status.json', { status: 'pass' });
    json('n8-result.json', { status: 'pass', build });
    json('n9-result.json', { status: 'pass', build, summary: { loops: { passed: 30, fullLoops: 30 }, coldStarts: { passed: 10 }, interrupts: { killedWithLiveSession: 3, recoveryPassed: 3 }, runDirsReclaimed: 46, totalRounds: 46 } });
    const seal = () => write(root, `${dir}/SHA256SUMS`, readdirSync(join(root, dir)).filter(file=>file!=='SHA256SUMS').sort().map(file => `${hash(readFileSync(join(root, dir, file)))}  ${file}`).join('\n') + '\n');
    seal();
    expect((await verifyCurrent(root)).status).toBe('pass');
    json('candidate.json',{...candidate,productBuildCommit:'f'.repeat(40)});
    expect((await verifyCurrent(root)).issues).toContainEqual({kind:'current_product_build_commit_mismatch'});
    json('candidate.json',candidate);seal();
    json('n8-result.json', { status: 'pass' });
    expect((await verifyCurrent(root)).issues).toContainEqual({ kind: 'current_run_build_mismatch', run: 'n8' });
    json('n8-result.json', { status: 'pass', build });
    write(root, 'shared/host-api/contract.ts', 'export const contract = 2;\n');
    expect((await verifyCurrent(root)).issues).toContainEqual({ kind: 'current_evidence_stale', changed: ['shared/host-api/contract.ts'] });
    write(root, 'shared/host-api/contract.ts', 'export const contract = 1;\n');
    write(root, 'shared/host-api/contract.ts', 'export const contract = 2;\n');
    git(root, ['add', 'shared/host-api/contract.ts']);
    write(root, 'shared/host-api/contract.ts', 'export const contract = 1;\n');
    expect((await verifyCurrent(root)).issues).toContainEqual({ kind: 'current_evidence_stale', changed: ['shared/host-api/contract.ts'] });
    git(root, ['add', 'shared/host-api/contract.ts']);
    write(root, 'packages/versebrowser/new-source.ts', 'export const additional = true;\n');
    expect((await verifyCurrent(root)).issues).toContainEqual({ kind: 'current_evidence_stale', changed: ['packages/versebrowser/new-source.ts'] });
    write(root, 'shared/host-api/contract.ts', 'export const contract = 2;\n');
    git(root, ['add', 'shared/host-api/contract.ts']);
    git(root, ['-c', 'user.name=Agent fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'untested source']);
    write(root, 'shared/host-api/contract.ts', 'export const contract = 1;\n');
    expect((await verifyCurrent(root)).issues).toContainEqual({ kind: 'current_evidence_stale', changed: expect.arrayContaining(['shared/host-api/contract.ts']) });
    rmSync(join(root,'packages/versebrowser/new-source.ts'));
    write(root, 'shared/host-api/contract.ts', 'export const contract = 2;\n');
    json('candidate.json',{...candidate,sourceCommit:git(root,['rev-parse','HEAD']),sourceTree:git(root,['rev-parse','HEAD^{tree}'])});
    seal();
    expect((await verifyCurrent(root)).issues).toContainEqual({kind:'current_product_build_source_drift',changed:['shared/host-api/contract.ts']});
  });

  it('uses the pinned Git object despite checkout drift and verifies the applied patch result', async () => {
    const sourceRoot = fixture();
    const sourceCommit = git(sourceRoot, ['rev-parse', 'HEAD']);
    const hostRoot = fixture();
    const sourcePath = 'shared/host-api/contract.ts';
    const original = 'export const contract = 1;\n';
    const target = 'export const contract = 2;\n';
    const targetPath = 'packages/versebrowser/fixture.ts';
    const patchPath = 'packages/versebrowser/fixture.patch';
    const patch = `--- a/${sourcePath}\n+++ b/${sourcePath}\n@@ -1 +1 @@\n-${original.trim()}\n+${target.trim()}\n`;
    write(hostRoot, targetPath, target); write(hostRoot, patchPath, patch);
    write(hostRoot, 'packages/versebrowser/import-manifest.json', JSON.stringify({ sourceCommit }));
    write(hostRoot, 'packages/versebrowser/integration-patches.json', JSON.stringify({ entries: [{ id: 'fixture', sourcePath, targetPath, patchPath, originalRawSha256: hash(original), originalLfSha256: hash(original), patchedSha256: hash(target), patchSha256: hash(patch) }] }));
    for (const file of ['electron/services/agent-browser-api.ts', 'electron/gateway/agent-browser-bridge.ts', 'packages/versebrowser/src/engine/api.ts']) write(hostRoot, file, readFileSync(resolve(file), 'utf8'));
    write(sourceRoot, sourcePath, 'changed checkout\n');
    expect((await verifyHostIntegration({ hostRoot, sourceRoot, sourceCommit })).status).toBe('pass');
    expect((await verifyHostIntegration({ hostRoot, sourceRoot })).issues.some(issue => issue.kind === 'patch_source_hash_mismatch')).toBe(true);
    write(hostRoot, targetPath, 'corrupt target\n');
    expect((await verifyHostIntegration({ hostRoot, sourceRoot, sourceCommit })).issues).toContainEqual({ kind: 'patch_result_mismatch', id: 'fixture' });
  });
});
