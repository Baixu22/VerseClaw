// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  validateTf0009AgentSurrogateCharter,
  validateTf0009AgentSurrogateReport,
  canCloseTf0009,
  verifyTf0009ClosureEvidence,
} from '../../scripts/lib/tf0009-agent-surrogate.mjs';

const root = process.cwd();
const tempRoots: string[] = [];
afterEach(() => { for (const directory of tempRoots.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as Record<string, unknown>;
}

describe('TF-0009 agent-surrogate evidence tier', () => {
  const charter = readJson('artifacts/first-product-preview/TF-0009/agent-surrogate-charter.json');
  const report = readJson('artifacts/first-product-preview/TF-0009/agent-surrogate-report.json');

  it('keeps the charter bounded below human/live/product authority', () => {
    expect(validateTf0009AgentSurrogateCharter(charter)).toEqual({ ok: true, errors: [] });
  });

  it('records 10 agent runs per profile while human counts remain zero', () => {
    expect(validateTf0009AgentSurrogateReport(report)).toEqual({ ok: true, errors: [] });
  });

  it('keeps historical v1 evidence valid without granting current closure authority', () => {
    const historical = readJson('artifacts/first-product-preview/TF-0009/historical-20260729/agent-surrogate-report.json');
    expect(validateTf0009AgentSurrogateReport(historical).ok).toBe(true);
    expect(canCloseTf0009(historical)).toBe(false);
  });

  it('does not authorize closure from a self-declared clean report alone', () => {
    const clean = { ...report, candidate: { ...(report.candidate as object), dirty: false } };
    expect(canCloseTf0009(clean)).toBe(false);
    expect(canCloseTf0009({ ...clean, candidate: { ...clean.candidate, dirty: true } })).toBe(false);
  });

  it.each(['continue', 'shrink', 'stop'])('accepts the bounded %s decision', (value) => {
    expect(validateTf0009AgentSurrogateReport({ ...report, decision: { ...(report.decision as object), value } }).ok).toBe(true);
  });

  it('binds closure to actual Git objects, unchanged source and all hashed disk evidence', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'tf0009-closure-'));
    tempRoots.push(workspace);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'fixture-agent');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(workspace, 'source.mjs'), 'export const value = 1;\n');
    writeFileSync(join(workspace, '.gitattributes'), readFileSync(join(root, '.gitattributes')));
    git('add', 'source.mjs', '.gitattributes');
    git('commit', '-qm', 'fixture source');
    const clean = { ...report, candidate: { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: false } };
    const artifacts = join(workspace, 'artifacts/first-product-preview/TF-0009');
    const evidence = join(artifacts, 'policy-acceptance');
    mkdirSync(evidence, { recursive: true });
    const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
    const reportPath = join(artifacts, 'agent-surrogate-report.json');
    const charterPath = join(artifacts, 'agent-surrogate-charter.json');
    writeFileSync(reportPath, JSON.stringify(clean));
    writeFileSync(charterPath, JSON.stringify(charter));
    const verification = {
      schema: 'tf0009-policy-verification/v1', driven_by: 'agent', candidate: clean.candidate,
      reportSha256: sha(reportPath), charterSha256: sha(charterPath), credentialScan: { hits: 0 },
      gates: ['campaign', 'unit', 'typecheck', 'lint', 'harness', 'autoreview'].map((id) => ({ id, exitCode: 0 })),
    };
    const save = () => {
      writeFileSync(join(evidence, 'campaign-report.json'), readFileSync(reportPath));
      writeFileSync(join(evidence, 'campaign-charter.json'), readFileSync(charterPath));
      writeFileSync(join(evidence, 'verification.json'), JSON.stringify(verification));
      const files = readdirSync(evidence).filter((file) => file !== 'SHA256SUMS').sort();
      writeFileSync(join(evidence, 'SHA256SUMS'), files.map((file) => `${sha(join(evidence, file))} *${file}`).join('\n') + '\n');
    };
    save();
    expect(canCloseTf0009(clean, workspace)).toBe(true);
    const archivedReport = join(evidence, 'campaign-report.json');
    writeFileSync(archivedReport, '{}');
    const sumsPath = join(evidence, 'SHA256SUMS');
    writeFileSync(sumsPath, readFileSync(sumsPath, 'utf8').replace(`${verification.reportSha256} *campaign-report.json`, `${sha(archivedReport)} *campaign-report.json`));
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    save();
    rmSync(archivedReport);
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    save();
    mkdirSync(join(workspace, 'scripts'));
    const injected = join(workspace, 'scripts/injected.mjs');
    writeFileSync(injected, 'export const injected = true;\n');
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    rmSync(injected);
    expect(canCloseTf0009({ ...clean, candidate: { ...clean.candidate, commit: 'f'.repeat(40) } }, workspace)).toBe(false);
    expect(canCloseTf0009({ ...clean, candidate: { ...clean.candidate, tree: 'f'.repeat(40) } }, workspace)).toBe(false);
    writeFileSync(join(workspace, 'source.mjs'), 'export const value = 2;\n');
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    expect(verifyTf0009ClosureEvidence(clean, workspace)).toBe(true);
    writeFileSync(reportPath, '{}');
    expect(verifyTf0009ClosureEvidence(clean, workspace)).toBe(true);
    writeFileSync(reportPath, JSON.stringify(clean));
    writeFileSync(join(workspace, 'source.mjs'), 'export const value = 1;\n');
    writeFileSync(join(evidence, 'verification.json'), '{}');
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    save();
    verification.credentialScan.hits = 1;
    save();
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    verification.credentialScan.hits = 0;
    verification.gates[0].exitCode = 1;
    save();
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    verification.gates[0].exitCode = 0;
    save();
    writeFileSync(join(evidence, 'unmanifested.txt'), 'extra evidence');
    expect(canCloseTf0009(clean, workspace)).toBe(false);
    rmSync(join(evidence, 'unmanifested.txt'));
    git('add', 'artifacts');
    git('commit', '-qm', 'fixture closure');
    const checkout = mkdtempSync(join(tmpdir(), 'tf0009-crlf-'));
    tempRoots.push(checkout);
    execFileSync('git', ['clone', '-c', 'core.autocrlf=true', '-q', workspace, checkout]);
    expect(readFileSync(join(checkout, 'artifacts/first-product-preview/TF-0009/agent-surrogate-report.json'))).toEqual(readFileSync(reportPath));
    expect(canCloseTf0009(clean, checkout)).toBe(true);
    // An unrelated checkout can inspect the sealed archive, but cannot use it
    // to authorize closure of its own source. The candidate object still exists.
    const unrelated = execFileSync('git', ['-C', checkout, '-c', 'user.name=fixture-agent',
      '-c', 'user.email=fixture@example.invalid', 'commit-tree', git('rev-parse', 'HEAD^{tree}'),
      '-m', 'unrelated fixture root'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', checkout, 'update-ref', 'HEAD', unrelated]);
    expect(verifyTf0009ClosureEvidence(clean, checkout)).toBe(true);
    expect(canCloseTf0009(clean, checkout)).toBe(false);
  });

  it.each([
    ['human relabel', { humanEquivalent: true }],
    ['live relabel', { liveEvidence: true }],
    ['missing policy', { policy: undefined }],
    ['missing driver', { driven_by: undefined }],
    ['missing candidate', { candidate: undefined }],
    ['missing runs', { runs: [] }],
    ['failed drill', { killRollbackDrill: { ...(report.killRollbackDrill as object), steps: [] } }],
    ['product promotion', { frozenBoundaries: { ...(report.frozenBoundaries as object), productApproved: true } }],
  ])('rejects %s', (_label, patch) => {
    expect(validateTf0009AgentSurrogateReport({ ...report, ...patch }).ok).toBe(false);
  });

  it('rejects duplicate records and unsafe runs even with a passing summary', () => {
    const runs = structuredClone(report.runs) as Array<{ runId: string; safety: { unauthorizedWrite: boolean } }>;
    runs[1] = structuredClone(runs[0]);
    expect(validateTf0009AgentSurrogateReport({ ...report, runs }).ok).toBe(false);
    const unsafe = structuredClone(report.runs) as typeof runs;
    unsafe[0].safety.unauthorizedWrite = true;
    expect(validateTf0009AgentSurrogateReport({ ...report, runs: unsafe }).ok).toBe(false);
  });
});

