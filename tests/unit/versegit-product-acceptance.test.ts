// @vitest-environment node
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeFrozenGitReplay } from '../helpers/frozen-source-replay';
import { PRODUCT_SURFACE_AUTHORITY_LINKS } from '../../shared/component-authority-manifest';
import {
  F5_DOCS_PATH,
  F5_EVIDENCE_ROOT,
  F5_MANIFEST_PATH,
  F5_PRODUCT_SEMANTICS_PATH,
  F5_README_PATHS,
  F5_RESIDUALS,
  F5_SHA_PATH,
  F5_SOURCE_INPUTS,
  buildAcceptanceState,
  documentDigest,
  recomputeStability,
  validateStoredArtifacts,
  validateVerseToolReadme,
  verifyShaManifest,
} from '../../scripts/verify-versegit-product-integration.mjs';

const root = process.cwd();
const samplesPath = resolve(root, `${F5_EVIDENCE_ROOT}/../f4/stability-samples.jsonl`);
let replayRoot: string;
const frozenIndex = JSON.parse(readFileSync(resolve(root, `${F5_EVIDENCE_ROOT}/criterion-evidence-index.json`), 'utf8'));

beforeAll(() => {
  replayRoot = mkdtempSync(join(tmpdir(), 'versegit-f5-source-replay-'));
  initializeFrozenGitReplay(root, replayRoot, frozenIndex.source.commit, [
    ...F5_SOURCE_INPUTS, 'harness/specs/fixtures/versegit-product-integration', 'docs/modules/verse-tools.md',
  ]);
  cpSync(resolve(root, F5_EVIDENCE_ROOT), resolve(replayRoot, F5_EVIDENCE_ROOT), { recursive: true });
  mkdirSync(resolve(replayRoot, 'resources/bin/win32-x64'), { recursive: true });
  const currentBinary = resolve(root, 'resources/bin/win32-x64/vg.exe');
  const historicalArtifact = JSON.parse(readFileSync(resolve(replayRoot, 'resources/versegit/manifest.json'), 'utf8')).artifact;
  if (existsSync(currentBinary)) {
    const bytes = readFileSync(currentBinary);
    // 历史回放仅接纳对应 manifest 的原生产物。
    if (bytes.length === historicalArtifact.bytes && createHash('sha256').update(bytes).digest('hex') === historicalArtifact.sha256) {
      cpSync(currentBinary, resolve(replayRoot, 'resources/bin/win32-x64/vg.exe'));
    }
  }
  writeFileSync(resolve(replayRoot, '.git/info/exclude'), 'resources/bin/\n');
  for (const input of frozenIndex.candidate.inputs) {
    const bytes = readFileSync(resolve(replayRoot, input.path));
    expect(bytes.length, input.path).toBe(input.bytes);
    expect(createHash('sha256').update(bytes).digest('hex'), input.path).toBe(input.sha256);
  }
}, 30_000);
afterAll(() => { if (replayRoot) rmSync(replayRoot, { recursive: true, force: true }); });

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Record<string, any>;
}

function readSamples(): Array<Record<string, any>> {
  return readFileSync(samplesPath, 'utf8')
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

describe('VerseGit product integration acceptance', () => {
  it('recomputes all product criteria and the independent P0/P1/P2 verdict at the retained source revision', () => {
    const result = validateStoredArtifacts({ root: replayRoot });
    const pendingCommandIssues = result.issues.filter((issue: string) => issue.startsWith('required command not recorded:'));
    // Only command recording can be pending while this very suite runs during
    // sealing. Source/candidate drift is never a green acceptance result.
    expect(result.issues, result.issues.join('\n')).toEqual(pendingCommandIssues);
    expect(result.state.ok).toBe(true);
    expect(result.report.status).toBe('passed');
    expect(result.report.acceptance.map((entry: { id: string; status: string }) => [entry.id, entry.status])).toEqual([
      ['AC1', 'passed'],
      ['AC2', 'passed'],
      ['AC3', 'passed'],
    ]);
    expect(result.state.criteria.map((entry: { id: string; status: string }) => [entry.id, entry.status])).toEqual([
      ['risk-observation', 'passed'],
      ['agent-feedback', 'passed'],
      ['candidate-pre-verification', 'passed'],
      ['persistent-result', 'passed'],
      ['host-writeback', 'passed'],
      ['cleanup', 'passed'],
      ['package', 'passed'],
      ['bounded-stability', 'passed'],
      ['docs-capability-authority', 'passed'],
    ]);
    expect(result.report.evidence).toMatchObject({
      groups: 15,
      files: 66,
      shaManifests: 15,
      independentReviews: 15,
      oldestTask: 'TF-0524',
      newestTask: 'TF-0538',
    });
    expect(result.verdict).toMatchObject({
      verdict: 'pass',
      priority: { p0: 0, p1: 0, p2: F5_RESIDUALS.length },
      driven_by: 'agent',
      actor: 'codex',
      recomputed: true,
    });
    expect(result.report.posture).toEqual(expect.objectContaining({
      optIn: true,
      defaultOff: true,
      nonGa: true,
      liveReady: false,
      productApproved: false,
      ga: false,
      m4Authorized: false,
      hostAuthority: 'ClawX',
      vgLandingAuthority: false,
      providerLandAdmitAuthority: false,
      modelFacingUserCapability: false,
    }));
  });

  it('recomputes F4 P50/P95/RSS and rejects a sample whose duration no longer matches the frozen report', () => {
    const samples = readSamples();
    const report = readJson('harness/specs/fixtures/versegit-product-integration/f4/stability-report.json');
    const metrics = recomputeStability(samples);
    expect(metrics).toEqual({
      sampleCount: 10,
      successes: 10,
      failures: 0,
      failureRate: 0,
      p50LoopMs: 19651,
      p95LoopMs: 25452,
      peakRssMb: 57.1796875,
      duplicateApplyCount: 0,
      uniqueCandidateCount: 10,
      survivors: { processes: 0, managers: 0, worktrees: 0, tempRoots: 0 },
    });
    expect(metrics).toMatchObject({
      sampleCount: report.aggregate.sampleCount,
      successes: report.aggregate.successes,
      failures: report.aggregate.failures,
      failureRate: report.aggregate.failureRate,
      p50LoopMs: report.aggregate.p50LoopMs,
      p95LoopMs: report.aggregate.p95LoopMs,
      peakRssMb: report.aggregate.peakRssMb,
      duplicateApplyCount: report.aggregate.duplicateApplyCount,
      survivors: report.aggregate.survivors,
    });
    const tampered = structuredClone(samples);
    tampered[9].durationMs = 999_999;
    expect(recomputeStability(tampered).p95LoopMs).toBe(999_999);
    expect(recomputeStability(tampered).p95LoopMs).not.toBe(report.aggregate.p95LoopMs);
  });

  it('rejects a checksum surface after one retained target changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'versegit-f5-sha-'));
    try {
      const payload = '{"ok":true}\n';
      writeFileSync(resolve(directory, 'payload.json'), payload, 'utf8');
      const digest = createHash('sha256').update(payload).digest('hex');
      writeFileSync(resolve(directory, 'SHA256SUMS'), `${digest}  payload.json\n`, 'utf8');
      expect(verifyShaManifest({ root: directory, path: 'SHA256SUMS' })).toMatchObject({ ok: true, issues: [] });
      writeFileSync(resolve(directory, 'payload.json'), '{"ok":false}\n', 'utf8');
      const result = verifyShaManifest({ root: directory, path: 'SHA256SUMS' });
      expect(result.ok).toBe(false);
      expect(result.issues).toContain('SHA256SUMS mismatch: payload.json');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('seals document digests and exposes a re-hashed semantic overclaim', () => {
    const report = readJson(`${F5_EVIDENCE_ROOT}/global-acceptance.json`);
    const tampered = structuredClone(report);
    tampered.posture.productApproved = true;
    expect(documentDigest(tampered)).not.toBe(report.digest);
    tampered.digest = documentDigest(tampered);
    expect(tampered.digest).toBe(documentDigest(tampered));
    expect(tampered.posture.productApproved).toBe(true);
    expect(report.posture.productApproved).toBe(false);
  });

  it('keeps package reproducibility and current capability claims bounded', () => {
    const packageEvidence = readJson('harness/specs/fixtures/versegit-product-integration/f3/sidecar-package-manifest.json');
    const build = readJson('harness/specs/fixtures/versegit-product-integration/f3/build-provenance.json');
    expect(packageEvidence.package.profiles).toEqual(['M1']);
    expect(packageEvidence.package.retention.supportedTargets).toEqual(['win32-x64']);
    expect(packageEvidence.package.retention.codeCopied).toBe(false);
    expect(packageEvidence.package.retention.gitDirectoryCopied).toBe(false);
    expect(packageEvidence.package.retention.taskForestCopied).toBe(false);
    expect(packageEvidence.package.retention.privateEvidenceCopied).toBe(false);
    expect(build.byteIdentical).toBe(false);
    expect(build.semanticIdentityEqual).toBe(true);
    expect(build.reproducibility).toEqual(expect.objectContaining({ status: 'semantic-identity-only', claimable: false }));
  });

  it('requires all three README languages, the controlled-preview lock and explicit M4 boundaries', () => {
    for (const path of F5_README_PATHS) {
      const text = readFileSync(resolve(root, path), 'utf8');
      expect(text).toContain(F5_DOCS_PATH);
      expect(text).toContain('liveReady=false');
      expect(text).toContain('productApproved=false');
      expect(text).toContain('M4');
      expect(text).toContain('win32-x64');
      expect(text).toContain('M1');
      expect(validateVerseToolReadme(text, path)).toBe(true);
      expect(validateVerseToolReadme(text.replace('<!-- VERSE-TOOLS-BOUNDARY-END -->', 'GA ready\n<!-- VERSE-TOOLS-BOUNDARY-END -->'), path)).toBe(false);
      expect(validateVerseToolReadme(text.replace('M4', 'M9'), path)).toBe(false);
    }
    const semantics = readFileSync(resolve(root, F5_PRODUCT_SEMANTICS_PATH), 'utf8');
    const fpStart = semantics.indexOf('<!-- FP-P1-08-COMPONENT-STATUS-START -->');
    const fpEnd = semantics.indexOf('<!-- FP-P1-08-COMPONENT-STATUS-END -->');
    expect(fpStart).toBeGreaterThanOrEqual(0);
    expect(fpEnd).toBeGreaterThan(fpStart);
    const fpSection = semantics.slice(fpStart, fpEnd);
    const fpRows = fpSection.split(/\r?\n/u).filter((line) => /^\| [^|-].*\| `[^`]+` \|/u.test(line));
    expect(fpRows.map((line) => line.split('|')[1].trim()).sort())
      .toEqual(Object.keys(PRODUCT_SURFACE_AUTHORITY_LINKS).sort());
    expect(fpSection).not.toContain('VerseGit');
    const manifest = readFileSync(resolve(root, F5_MANIFEST_PATH), 'utf8');
    const block = manifest.slice(
      manifest.indexOf('export const PRODUCT_SURFACE_AUTHORITY_LINKS'),
      manifest.indexOf('export const DEFAULT_MATRIX_AUTHORITY_LINKS'),
    );
    expect(block).not.toContain('VerseGit');
    for (const owner of ['coding-execution-backend', 'verseshell-execution-adapter', 'permission-approval-authority', 'task-ledger', 'observability-recorder']) {
      expect(manifest).toContain(`id: '${owner}'`);
    }
    const docs = readFileSync(resolve(root, F5_DOCS_PATH), 'utf8');
    expect(docs).toContain('P0=0');
    expect(docs).toContain('P1=0');
    expect(docs).toContain('P2');
    expect(docs).toContain(`${F5_EVIDENCE_ROOT}/global-acceptance.json`);
    expect(existsSync(resolve(root, F5_SHA_PATH))).toBe(true);
  });

  it('rebuilds the acceptance state from evidence rather than trusting node status text', () => {
    const state = buildAcceptanceState({ root: replayRoot, sourceCommit: frozenIndex.source.commit });
    expect(state.ok).toBe(true);
    expect(state.evidence.groups.map((group: { task: string }) => group.task)).toEqual([
      'TF-0524', 'TF-0525', 'TF-0526', 'TF-0527', 'TF-0528', 'TF-0529', 'TF-0530', 'TF-0531',
      'TF-0532', 'TF-0533', 'TF-0534', 'TF-0535', 'TF-0536', 'TF-0537', 'TF-0538',
    ]);
    expect(state.evidence.groups.every((group: { status: string }) => group.status === 'passed')).toBe(true);
    expect(state.candidate.id).toMatch(/^[a-f0-9]{64}$/u);
    expect(state.candidate.packageId).toBe('vg-0.1.0-win32-x64-release-6b8330354da59118');
    expect(state.candidate.artifactSha256).toBe('6b8330354da59118274bdbbf2bfa210b66612e42924dcb2fd02f29882b0d85ea');
  });

  it('rejects source drift against the retained candidate', () => {
    const target = resolve(replayRoot, 'README.md');
    const original = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([original, Buffer.from('\nsource drift\n')]));
      const state = buildAcceptanceState({ root: replayRoot, sourceCommit: frozenIndex.source.commit });
      expect(state.ok).toBe(false);
      expect(state.sourceIssues).toContain(`source input differs from evidence source ${frozenIndex.source.commit}: README.md`);
    } finally {
      writeFileSync(target, original);
    }
  });
  it('rejects a foreign native artifact in the historical package', () => {
    const target = resolve(replayRoot, 'resources/bin/win32-x64/vg.exe');
    const original = existsSync(target) ? readFileSync(target) : undefined;
    try {
      writeFileSync(target, 'foreign native artifact');
      const state = buildAcceptanceState({ root: replayRoot, sourceCommit: frozenIndex.source.commit });
      expect(state.ok).toBe(false);
      expect(state.criteria.find((entry: { id: string }) => entry.id === 'package')?.status).toBe('failed');
      const verified = validateStoredArtifacts({ root: replayRoot });
      expect(verified.ok).toBe(false);
      expect(verified.issues).toContain('live criterion failed: package');
    } finally {
      if (original) writeFileSync(target, original);
      else rmSync(target);
    }
  });
});
