// @vitest-environment node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import * as semantics from '../../shared/product-semantics';
import {
  EVIDENCE_NORMALIZATION,
  EVIDENCE_REPORT_SCHEMA,
  SOURCE_DIAGNOSTIC_RULES,
  SUPPORTED_CONTRACT_VERSIONS,
  buildEvidenceReport,
  checkEvidenceRefs,
  describeCandidate,
  describeSourceRef,
  digestEvidenceBytes,
  sourceRefDiagnostics,
  verifyEvidenceReport,
} from '../../scripts/check-evidence-refs.mjs';
import type { EvidenceDiagnostic, ProductSemanticEvidenceReport } from '../../scripts/check-evidence-refs.mjs';

const ROOT = realpathSync(path.resolve(fileURLToPath(new URL('../..', import.meta.url))));
const ENTRY = 'scripts/check-evidence-refs.mjs';
const REPORT_FIXTURE_DIR = 'harness/specs/fixtures/ontology-lite-existing-contracts/report';
const FIXTURES = `${REPORT_FIXTURE_DIR}/fixtures`;
const RUNTIME_DIR = path.join(ROOT, REPORT_FIXTURE_DIR, 'runtime');
const RUNTIME_REL = `${REPORT_FIXTURE_DIR}/runtime`;
const execFileAsync = promisify(execFile);
const TMP = mkdtempSync(path.join(tmpdir(), 'tf0636-c3-'));
const ACTOR = 'vitest-evidence-refs';

// The contract's closed source rule set, written once here and once in the
// checker so a rule cannot be added or dropped silently.
const EXPECTED_SOURCE_RULES = [
  'source-missing',
  'source-outside-root',
  'source-untracked',
  'source-symlink-escape',
  'source-digest-mismatch',
  'candidate-mismatch',
  'version-unsupported',
  'report-field-missing',
];
const REPORT_KEYS = [
  'schema', 'contractVersion', 'generatedAt', 'node', 'actor', 'command', 'exitCode', 'candidate',
  'normalization', 'fixtures', 'rulesEvaluated', 'relations', 'diagnostics', 'unverified', 'status',
];
const SOURCE_REF_KEYS = ['path', 'exists', 'insideRoot', 'tracked', 'symlinkEscape', 'digest', 'rawDigest'];

// The checker ships a typed .d.mts, but tampered reports are deliberately malformed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let counter = 0;
function tmpPath(name: string): string {
  counter += 1;
  return path.join(TMP, `${counter}-${name}`);
}
function readJson(file: string): Json {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function rulesOf(diagnostics: EvidenceDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.rule);
}

async function run(args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (value !== undefined) childEnv[key] = value;
  }
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...args], { cwd: ROOT, encoding: 'utf8', env: childEnv, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return { code: typeof failure.code === 'number' ? failure.code : -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

async function report(args: string[], env: Record<string, string | undefined> = {}) {
  const file = tmpPath('report.json');
  const result = await run([...args, '--report', file], env);
  return { ...result, file, report: existsSync(file) ? (readJson(file) as ProductSemanticEvidenceReport) : null };
}

// Runtime files live under the tracked fixture directory (so they are inside the
// root) and are removed again whatever the test outcome.
async function withRuntimeFile<T>(name: string, bytes: Buffer, body: (relativePath: string) => Promise<T>): Promise<T> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const absolute = path.join(RUNTIME_DIR, name);
  writeFileSync(absolute, bytes);
  try {
    return await body(`${RUNTIME_REL}/${name}`);
  } finally {
    rmSync(RUNTIME_DIR, { recursive: true, force: true });
  }
}
async function withEscapeLink<T>(body: (relativePath: string) => Promise<T>): Promise<T> {
  const target = path.join(TMP, 'escape-target');
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'escaped.md'), 'escaped bytes that live outside the repository\n');
  mkdirSync(RUNTIME_DIR, { recursive: true });
  // 'junction' needs no privilege on Windows; POSIX ignores the type and creates a symlink.
  symlinkSync(target, path.join(RUNTIME_DIR, 'escape-link'), 'junction');
  try {
    return await body(`${RUNTIME_REL}/escape-link/escaped.md`);
  } finally {
    rmSync(RUNTIME_DIR, { recursive: true, force: true });
  }
}

afterAll(() => {
  rmSync(RUNTIME_DIR, { recursive: true, force: true });
  rmSync(TMP, { recursive: true, force: true });
});

describe('evidence reference path validation (#92)', () => {
  it('resolves every declared shared evidence path from a clean checkout', () => {
    const result = checkEvidenceRefs(process.cwd());
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('check-evidence-refs default invocation is byte-identical to the pre-C3 behaviour', () => {
  it('prints the pinned stdout, nothing on stderr and exits 0', async () => {
    const expected = readFileSync(path.join(ROOT, REPORT_FIXTURE_DIR, 'default-stdout.expected.txt'), 'utf8');
    expect(expected).toMatch(/^\[evidence-refs\] PASS \d+ referenced path\(s\)\n$/);
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe('');
  });
});

describe('ProductSemanticEvidenceReport/v1 closed vocabularies', () => {
  it('declares the eight source rules of the contract, disjoint from the registry relation rules', () => {
    expect([...SOURCE_DIAGNOSTIC_RULES]).toEqual(EXPECTED_SOURCE_RULES);
    const relationRules = new Set<string>(semantics.PRODUCT_SEMANTIC_RELATION_RULES);
    for (const rule of SOURCE_DIAGNOSTIC_RULES) expect(relationRules.has(rule)).toBe(false);
  });

  it('binds the live contract version and nothing newer', () => {
    expect(SUPPORTED_CONTRACT_VERSIONS).toContain(semantics.PRODUCT_SEMANTIC_CONTRACT_VERSION);
    expect(SUPPORTED_CONTRACT_VERSIONS).not.toContain('ProductSemanticRelations/v2');
    expect(EVIDENCE_REPORT_SCHEMA).toBe('ProductSemanticEvidenceReport/v1');
  });

  it('keeps the canonical and the raw digest apart', () => {
    const crlf = Buffer.from('alpha\r\nbeta\r\n', 'utf8');
    const cr = Buffer.from('alpha\rbeta\r', 'utf8');
    const lf = Buffer.from('alpha\nbeta\n', 'utf8');
    const binary = Buffer.from([0x61, 0x0d, 0x0a, 0x00, 0x62]);
    for (const bytes of [crlf, cr]) {
      const digests = digestEvidenceBytes(bytes);
      expect(digests.digest).toBe(sha256(lf));
      expect(digests.rawDigest).toBe(sha256(bytes));
      expect(digests.digest).not.toBe(digests.rawDigest);
    }
    expect(digestEvidenceBytes(lf)).toEqual({ digest: sha256(lf), rawDigest: sha256(lf) });
    expect(digestEvidenceBytes(binary)).toEqual({ digest: sha256(binary), rawDigest: sha256(binary) });
  });

  it('never reads or hashes a reference outside the repository root', () => {
    const outside = path.join(TMP, 'outside.md');
    writeFileSync(outside, 'outside\r\n');
    const facts = describeSourceRef(ROOT, path.relative(ROOT, outside));
    expect(facts).toMatchObject({ exists: false, insideRoot: false, tracked: null, symlinkEscape: false, digest: null, rawDigest: null });
    expect(rulesOf(sourceRefDiagnostics('a--b--c', facts))).toEqual(['source-outside-root']);
    const absoluteFacts = describeSourceRef(ROOT, outside);
    expect(absoluteFacts.insideRoot).toBe(false);
  });

  it('treats an unobserved tracking answer as untracked, never as tracked', () => {
    const facts = describeSourceRef(ROOT, 'docs/modules/multi-agent-and-tasks.md', { trackedPaths: null });
    expect(facts.exists).toBe(true);
    expect(facts.tracked).toBeNull();
    const diagnostics = sourceRefDiagnostics('x--y--z', facts);
    expect(rulesOf(diagnostics)).toEqual(['source-untracked']);
    expect(diagnostics[0].message).toMatch(/could not be observed/);
    const missing = describeSourceRef(ROOT, 'docs/does-not-exist.md', { trackedPaths: new Set() });
    expect(rulesOf(sourceRefDiagnostics('x--y--z', missing))).toEqual(['source-missing']);
  });
});

describe('--report on the live registry', () => {
  it('writes a valid report that binds every relation, its sources and the candidate', async () => {
    const result = await report(['--actor', ACTOR]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\[evidence-refs\] report valid: 6 relation\(s\), \d+ source ref\(s\), 0 diagnostic\(s\) -> /);
    const generated = result.report;
    expect(generated).not.toBeNull();
    if (!generated) return;

    expect(Object.keys(generated)).toEqual(REPORT_KEYS);
    expect(generated.schema).toBe(EVIDENCE_REPORT_SCHEMA);
    expect(generated.contractVersion).toBe(semantics.PRODUCT_SEMANTIC_CONTRACT_VERSION);
    expect(Number.isNaN(Date.parse(generated.generatedAt))).toBe(false);
    expect(generated.node).toBe(process.version);
    expect(generated.actor).toEqual({ driven_by: 'agent', actor: ACTOR });
    expect(generated.command.slice(0, 3)).toEqual(['node', ENTRY, '--actor']);
    expect(generated.exitCode).toBe(0);
    expect(generated.status).toBe('valid');
    expect(generated.diagnostics).toEqual([]);
    expect(generated.unverified).toEqual([]);
    expect(generated.fixtures).toEqual([]);
    expect(generated.normalization).toEqual(EVIDENCE_NORMALIZATION);
    expect(generated.rulesEvaluated).toEqual([...semantics.PRODUCT_SEMANTIC_RELATION_RULES, ...SOURCE_DIAGNOSTIC_RULES]);

    const candidate = describeCandidate(ROOT);
    expect(generated.candidate.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(generated.candidate.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(generated.candidate.commit).toBe(candidate.commit);
    expect(generated.candidate.tree).toBe(candidate.tree);
    expect(typeof generated.candidate.dirty).toBe('boolean');
    expect(Array.isArray(generated.candidate.dirtyPaths)).toBe(true);

    expect(generated.relations).toHaveLength(semantics.PRODUCT_SEMANTIC_RELATIONS.length);
    generated.relations.forEach((entry, index) => {
      const relation = semantics.PRODUCT_SEMANTIC_RELATIONS[index];
      expect(Object.keys(entry)).toEqual(['relationKey', 'sourceRefs']);
      expect(entry.relationKey).toBe(semantics.relationKey(relation));
      expect(entry.sourceRefs.map((ref) => ref.path)).toEqual([...relation.evidenceRefs]);
      for (const ref of entry.sourceRefs) {
        expect(Object.keys(ref)).toEqual(SOURCE_REF_KEYS);
        expect(ref).toMatchObject({ exists: true, insideRoot: true, tracked: true, symlinkEscape: false });
        const expected = digestEvidenceBytes(readFileSync(path.join(ROOT, ref.path)));
        expect(ref.digest).toBe(expected.digest);
        expect(ref.rawDigest).toBe(expected.rawDigest);
      }
    });
  });

  it('--verify accepts a fresh report and leaves the file untouched', async () => {
    const generated = await report(['--actor', ACTOR]);
    expect(generated.code).toBe(0);
    const before = readFileSync(generated.file);
    const verified = await run(['--verify', generated.file]);
    expect(verified.code).toBe(0);
    expect(verified.stdout).toMatch(/^\[evidence-refs\] verify valid: .* \(6 relation\(s\), \d+ source ref\(s\), candidate [0-9a-f]{9}\)\n$/);
    expect(readFileSync(generated.file).equals(before)).toBe(true);
  });

  it('never overwrites an existing report', async () => {
    const generated = await report(['--actor', ACTOR]);
    const before = readFileSync(generated.file);
    const again = await run(['--report', generated.file, '--actor', ACTOR]);
    expect(again.code).toBe(2);
    expect(again.stderr).toMatch(/refusing to overwrite/);
    expect(readFileSync(generated.file).equals(before)).toBe(true);
  });

  it('records the actor from CLAWX_EVIDENCE_ACTOR, then "unknown", and never a human', async () => {
    const fromEnv = await report([], { CLAWX_EVIDENCE_ACTOR: 'env-agent' });
    expect(fromEnv.report?.actor).toEqual({ driven_by: 'agent', actor: 'env-agent' });
    const unknown = await report([], { CLAWX_EVIDENCE_ACTOR: undefined });
    expect(unknown.report?.actor).toEqual({ driven_by: 'agent', actor: 'unknown' });
    const human = await report(['--actor', 'real-human']);
    expect(human.code).toBe(2);
    expect(human.stderr).toMatch(/claims a human/);
    expect(human.report).toBeNull();
  });

  it('rejects malformed invocations with exit 2 and no report', async () => {
    const unknownFlag = await run(['--bogus']);
    expect(unknownFlag.code).toBe(2);
    expect(unknownFlag.stderr).toMatch(/unknown argument: --bogus/);
    const missingValue = await run(['--report']);
    expect(missingValue.code).toBe(2);
    expect(missingValue.stderr).toMatch(/--report requires a value/);
    const both = await run(['--report', tmpPath('never.json'), '--verify', tmpPath('never.json')]);
    expect(both.code).toBe(2);
    expect(both.stderr).toMatch(/exclusive/);
    const unreadable = await run(['--verify', tmpPath('missing.json')]);
    expect(unreadable.code).toBe(2);
    expect(unreadable.stderr).toMatch(/could not be read as JSON/);
  });
});

describe('--fixture negatives through the real entry (in-memory rewrites, tree untouched)', () => {
  const porcelainBefore = describeCandidate(ROOT).dirtyPaths;

  async function negative(fixtureId: string, runtimePath?: string) {
    const fixture = readJson(path.join(ROOT, FIXTURES, `${fixtureId}.json`));
    const result = await report(['--fixture', `${FIXTURES}/${fixtureId}.json`, '--actor', ACTOR]);
    expect(result.code).toBe(fixture.expect.exitCode);
    expect(result.stderr).toMatch(new RegExp(`fixtures applied in memory: ${fixtureId}`));
    const generated = result.report;
    expect(generated).not.toBeNull();
    if (!generated) throw new Error('report missing');
    expect(generated.fixtures).toEqual([fixtureId]);
    expect(generated.status).toBe(fixture.expect.status);
    expect(generated.exitCode).toBe(fixture.expect.exitCode);
    expect(generated.relations).toHaveLength(semantics.PRODUCT_SEMANTIC_RELATIONS.length);
    if (fixture.expect.rule) {
      const hit = generated.diagnostics.find((diagnostic) => diagnostic.rule === fixture.expect.rule);
      expect(hit, `diagnostic ${fixture.expect.rule}`).toBeDefined();
      if (fixture.expect.relationKey) expect(hit?.relationKey).toBe(fixture.expect.relationKey);
      if (fixture.expect.field) expect(hit?.field).toBe(fixture.expect.field);
      if (fixture.expect.path) expect(hit?.path).toBe(runtimePath ?? fixture.expect.path);
      expect(result.stderr).toContain(`[${fixture.expect.rule}]`);
    }
    return { fixture, ...result, report: generated };
  }

  it('a bad relation is rejected by the registry validator at the real entry', async () => {
    const { report: generated } = await negative('bad-relation-self-loop');
    expect(rulesOf(generated.diagnostics)).toEqual(['self-loop']);
    expect(generated.relations[0].relationKey).toBe('chat--suggests-upgrade-to--chat');
  });

  it('a deleted or moved source is recorded as missing and unverified', async () => {
    const { report: generated, fixture } = await negative('source-missing');
    const ref = generated.relations[3].sourceRefs[0];
    expect(ref).toMatchObject({ path: fixture.expect.path, exists: false, insideRoot: true, tracked: null, symlinkEscape: false, digest: null, rawDigest: null });
    expect(generated.unverified).toEqual([{ relationKey: fixture.expect.relationKey, path: fixture.expect.path, reason: 'source-missing' }]);
  });

  it('a source outside the repository root is neither read nor hashed', async () => {
    const { report: generated } = await negative('source-outside-root');
    const ref = generated.relations[3].sourceRefs[0];
    expect(ref).toMatchObject({ path: '../outside-the-repository.md', exists: false, insideRoot: false, digest: null, rawDigest: null });
    expect(generated.unverified[0].reason).toBe('source-outside-root');
  });

  it('an untracked local file is rejected while both of its digests are still recorded', async () => {
    const bytes = Buffer.from('# untracked probe\r\nsecond line\r\n', 'utf8');
    await withRuntimeFile('untracked-probe.md', bytes, async () => {
      const { report: generated } = await negative('source-untracked');
      const ref = generated.relations[3].sourceRefs[0];
      expect(ref).toMatchObject({ exists: true, insideRoot: true, tracked: false, symlinkEscape: false });
      expect(ref.digest).toBe(sha256(Buffer.from('# untracked probe\nsecond line\n', 'utf8')));
      expect(ref.rawDigest).toBe(sha256(bytes));
      expect(ref.digest).not.toBe(ref.rawDigest);
      expect(generated.unverified).toEqual([]);
    });
    expect(existsSync(RUNTIME_DIR)).toBe(false);
  });

  it('a link whose real path leaves the root is rejected and its bytes are not hashed', async () => {
    await withEscapeLink(async () => {
      const { report: generated } = await negative('source-symlink-escape');
      const ref = generated.relations[3].sourceRefs[0];
      expect(ref).toMatchObject({ exists: true, insideRoot: true, symlinkEscape: true, digest: null, rawDigest: null });
      expect(generated.unverified[0].reason).toBe('source-symlink-escape');
    });
    expect(existsSync(RUNTIME_DIR)).toBe(false);
  });

  it('an unsupported contract version is reported, not read as the latest', async () => {
    const { report: generated, fixture } = await negative('version-unsupported');
    expect(generated.contractVersion).toBe(fixture.expect.contractVersion);
    expect(rulesOf(generated.diagnostics)).toEqual(['version-unsupported']);
  });

  it('tracked sources with LF and lone-CR bytes stay valid and record distinct digests', async () => {
    const fixture = readJson(path.join(ROOT, FIXTURES, 'source-line-endings.json'));
    const result = await report(['--fixture', `${FIXTURES}/source-line-endings.json`, '--actor', ACTOR]);
    expect(result.stderr).not.toMatch(/FAIL/);
    expect(result.code).toBe(0);
    const generated = result.report;
    expect(generated?.status).toBe('valid');
    const entry = generated?.relations.find((candidate) => candidate.relationKey === fixture.expect.relationKey);
    expect(entry?.sourceRefs.map((ref) => ref.path)).toEqual([fixture.expect.paths.lf, fixture.expect.paths.cr]);
    const [lf, cr] = entry?.sourceRefs ?? [];
    expect(lf).toMatchObject({ exists: true, tracked: true, symlinkEscape: false });
    expect(cr).toMatchObject({ exists: true, tracked: true, symlinkEscape: false });
    const lfBytes = readFileSync(path.join(ROOT, fixture.expect.paths.lf));
    const crBytes = readFileSync(path.join(ROOT, fixture.expect.paths.cr));
    expect(crBytes.includes(0x0d)).toBe(true);
    expect(lf.digest).toBe(sha256(lfBytes));
    expect(lf.rawDigest).toBe(sha256(lfBytes));
    expect(cr.rawDigest).toBe(sha256(crBytes));
    expect(cr.digest).toBe(sha256(Buffer.from(crBytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8')));
    expect(cr.digest).not.toBe(cr.rawDigest);
  });

  it('a source that changed after the report was written invalidates --verify', async () => {
    const fixture = readJson(path.join(ROOT, FIXTURES, 'stale-source-rewrite.json'));
    const generated = await report(['--actor', ACTOR]);
    expect(generated.code).toBe(0);
    const before = readFileSync(generated.file);
    const verified = await run(['--fixture', `${FIXTURES}/stale-source-rewrite.json`, '--verify', generated.file]);
    expect(verified.code).toBe(fixture.expect.exitCode);
    const citing = semantics.PRODUCT_SEMANTIC_RELATIONS.filter((relation) => (relation.evidenceRefs as readonly string[]).includes(fixture.expect.path));
    expect(citing.length).toBeGreaterThan(0);
    const mismatches = verified.stderr.split('\n').filter((line) => line.includes('[source-digest-mismatch]'));
    expect(mismatches).toHaveLength(citing.length * 2);
    expect(mismatches.every((line) => line.includes(fixture.expect.path))).toBe(true);
    expect(readFileSync(generated.file).equals(before)).toBe(true);
  });

  it('a fixture that mutates a file the gate never reads is an error, not a pass', async () => {
    const fixtureFile = tmpPath('unapplied-fixture.json');
    writeFileSync(fixtureFile, JSON.stringify({ schema: 'ContractCheckFixture/v1', id: 'unapplied', mutations: [{ file: 'README.md', append: '\nprobe\n' }] }));
    const result = await report(['--fixture', fixtureFile, '--actor', ACTOR]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/fixture mutation never applied/);
    expect(result.report).toBeNull();
  });

  it('a fixture whose target text does not exist fails to load and leaves an exit-2 report', async () => {
    const fixtureFile = tmpPath('miss-fixture.json');
    writeFileSync(fixtureFile, JSON.stringify({ schema: 'ContractCheckFixture/v1', id: 'target-miss', mutations: [{ file: 'shared/product-semantics.ts', find: 'this text is not in the registry', replace: '' }] }));
    const result = await report(['--fixture', fixtureFile, '--actor', ACTOR]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/fixture mutation target not found/);
    expect(result.report).toMatchObject({ schema: EVIDENCE_REPORT_SCHEMA, exitCode: 2, status: 'invalid', relations: [], contractVersion: null });
    expect(typeof result.report?.loadError).toBe('string');
    const verified = await run(['--verify', result.file]);
    expect(verified.code).toBe(1);
  });

  it('left the working tree as it found it', () => {
    expect(describeCandidate(ROOT).dirtyPaths).toEqual(porcelainBefore);
    expect(existsSync(RUNTIME_DIR)).toBe(false);
  });
});

describe('--verify invalidates tampered or incomplete reports', () => {
  const candidate = describeCandidate(ROOT);
  const options = { root: ROOT, contractVersion: semantics.PRODUCT_SEMANTIC_CONTRACT_VERSION, candidate };
  const base = buildEvidenceReport({ root: ROOT, registry: semantics, candidate, actor: ACTOR, command: ['node', ENTRY] });

  function verifyTampered(mutate: (copy: Json) => void) {
    const copy: Json = structuredClone(base);
    mutate(copy);
    return verifyEvidenceReport(copy, options);
  }

  it('accepts the untampered report', () => {
    expect(base.status).toBe('valid');
    const result = verifyEvidenceReport(base, options);
    expect(result).toEqual({ status: 'valid', diagnostics: [], rulesEvaluated: [...SOURCE_DIAGNOSTIC_RULES] });
  });

  const TAMPER_CASES: Array<[string, (copy: Json) => void, string, string]> = [
    ['canonical digest', (copy) => { copy.relations[0].sourceRefs[0].digest = '0'.repeat(64); }, 'source-digest-mismatch', 'digest'],
    ['raw digest', (copy) => { copy.relations[0].sourceRefs[0].rawDigest = '0'.repeat(64); }, 'source-digest-mismatch', 'rawDigest'],
    ['candidate commit', (copy) => { copy.candidate.commit = '0'.repeat(40); }, 'candidate-mismatch', 'candidate.commit'],
    ['candidate tree', (copy) => { copy.candidate.tree = '0'.repeat(40); }, 'candidate-mismatch', 'candidate.tree'],
    ['contract version', (copy) => { copy.contractVersion = 'ProductSemanticRelations/v2'; }, 'version-unsupported', 'contractVersion'],
    ['report schema', (copy) => { copy.schema = 'SomethingElse/v1'; }, 'version-unsupported', 'schema'],
    ['normalization policy', (copy) => { copy.normalization.policy = 'md5 over whatever'; }, 'version-unsupported', 'normalization.policy'],
    ['fixture-born report', (copy) => { copy.fixtures = ['bad-relation-self-loop']; }, 'candidate-mismatch', 'fixtures'],
    ['missing actor', (copy) => { delete copy.actor; }, 'report-field-missing', 'actor'],
    ['human actor', (copy) => { copy.actor.driven_by = 'human'; }, 'report-field-missing', 'actor.driven_by'],
    ['blank actor name', (copy) => { copy.actor.actor = '  '; }, 'report-field-missing', 'actor.actor'],
    ['missing exit code', (copy) => { delete copy.exitCode; }, 'report-field-missing', 'exitCode'],
    ['missing command', (copy) => { copy.command = []; }, 'report-field-missing', 'command'],
    ['missing candidate', (copy) => { delete copy.candidate; }, 'report-field-missing', 'candidate'],
    ['no relation results', (copy) => { copy.relations = []; }, 'report-field-missing', 'relations'],
    ['self-declared invalid', (copy) => { copy.status = 'invalid'; copy.exitCode = 1; }, 'report-field-missing', 'status'],
    ['exit code disagreeing with status', (copy) => { copy.exitCode = 1; }, 'report-field-missing', 'exitCode'],
    ['moved source', (copy) => { copy.relations[0].sourceRefs[0].path = 'docs/moved-away.md'; }, 'source-missing', 'evidenceRefs'],
    ['source outside root', (copy) => { copy.relations[0].sourceRefs[0].path = '../outside.md'; }, 'source-outside-root', 'evidenceRefs'],
    ['malformed source digest', (copy) => { copy.relations[0].sourceRefs[0].digest = 'not-hex'; }, 'report-field-missing', 'relations[0].sourceRefs[0].digest'],
  ];

  it.each(TAMPER_CASES)('%s -> invalid', (_label, mutate, rule, field) => {
    const result = verifyTampered(mutate);
    expect(result.status).toBe('invalid');
    const hit = result.diagnostics.find((diagnostic) => diagnostic.rule === rule && diagnostic.field === field);
    expect(hit, `${rule} on ${field}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
  });

  it('an empty report is missing every required field', () => {
    const result = verifyEvidenceReport({}, options);
    expect(result.status).toBe('invalid');
    expect(new Set(rulesOf(result.diagnostics))).toEqual(new Set(['report-field-missing']));
    const fields = result.diagnostics.map((diagnostic) => diagnostic.field);
    for (const field of ['schema', 'contractVersion', 'generatedAt', 'node', 'actor', 'command', 'exitCode', 'candidate', 'normalization', 'fixtures', 'rulesEvaluated', 'relations', 'diagnostics', 'unverified', 'status']) {
      expect(fields, field).toContain(field);
    }
    expect(verifyEvidenceReport(null, options).status).toBe('invalid');
    expect(verifyEvidenceReport([], options).status).toBe('invalid');
  });

  it('a source that became untracked after the report invalidates it', async () => {
    await withRuntimeFile('later-untracked.md', Buffer.from('local only\n'), async (relativePath) => {
      const result = verifyTampered((copy) => {
        copy.relations[0].sourceRefs[0].path = relativePath;
        Object.assign(copy.relations[0].sourceRefs[0], digestEvidenceBytes(Buffer.from('local only\n')), { tracked: true });
      });
      expect(result.status).toBe('invalid');
      expect(rulesOf(result.diagnostics)).toEqual(['source-untracked']);
    });
  });

  it('through the real entry an empty report and a tampered digest both exit 1 without rewriting the file', async () => {
    const empty = tmpPath('empty-report.json');
    writeFileSync(empty, '{}\n');
    const emptyResult = await run(['--verify', empty]);
    expect(emptyResult.code).toBe(1);
    expect(emptyResult.stderr).toMatch(/FAIL verify invalid/);
    expect(emptyResult.stderr).toMatch(/\[report-field-missing\] - relations/);
    expect(readFileSync(empty, 'utf8')).toBe('{}\n');

    const tampered = tmpPath('tampered-report.json');
    const copy: Json = structuredClone(base);
    copy.relations[1].sourceRefs[0].digest = 'f'.repeat(64);
    const text = `${JSON.stringify(copy, null, 2)}\n`;
    writeFileSync(tampered, text);
    const tamperedResult = await run(['--verify', tampered]);
    expect(tamperedResult.code).toBe(1);
    expect(tamperedResult.stderr).toMatch(/\[source-digest-mismatch\] chat--projects--task-ledger digest docs\/clawx-product-semantics\.md/);
    expect(readFileSync(tampered, 'utf8')).toBe(text);
  });
});
