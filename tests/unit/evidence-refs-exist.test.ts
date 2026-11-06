// @vitest-environment node

import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import * as semantics from '../../shared/product-semantics';
import {
  EVIDENCE_NORMALIZATION,
  EVIDENCE_REPORT_SCHEMA,
  RELATION_RULE_PROBES,
  SOURCE_DIAGNOSTIC_RULES,
  SUPPORTED_CONTRACT_VERSIONS,
  buildEvidenceReport,
  checkEvidenceRefs,
  describeCandidate,
  describeSourceRef,
  digestEvidenceBytes,
  observeRelationRules,
  sourceRefDiagnostics,
  verifyEvidenceReport,
} from '../../scripts/check-evidence-refs.mjs';
import type { EvidenceDiagnostic, ProductSemanticEvidenceReport } from '../../scripts/check-evidence-refs.mjs';

const ROOT = realpathSync(path.resolve(fileURLToPath(new URL('../..', import.meta.url))));
const ENTRY = 'scripts/check-evidence-refs.mjs';
const REPORT_FIXTURE_DIR = 'harness/specs/fixtures/ontology-lite-existing-contracts/report';
const FIXTURES = `${REPORT_FIXTURE_DIR}/fixtures`;
const FINAL_DIR = 'harness/specs/fixtures/ontology-lite-existing-contracts/final';
const RUNTIME_REL = `${REPORT_FIXTURE_DIR}/runtime`;
const execFileAsync = promisify(execFile);
const TMP = mkdtempSync(path.join(tmpdir(), 'tf0639-c5-'));
const ACTOR = 'vitest-evidence-refs';

// ---------------------------------------------------------------------------
// Clean candidate sandbox
//
// The gate judges a *clean* candidate: a dirty working tree makes every report
// invalid (TF-0639). The real checkout is routinely dirty while this file runs
// (uncommitted edits, other sessions' untracked directories), so every
// --report / --verify case below runs against a throwaway git repository under
// os.tmpdir() that holds the working-tree copies of exactly the tracked files
// the gate needs, committed once. It exercises the checker as edited (not
// HEAD's copy), never touches the real checkout or its .git, and is deleted
// in afterAll. The default no-argument invocation and checkEvidenceRefs still
// run against the real checkout: they need all referenced paths and do not
// depend on cleanliness.
// ---------------------------------------------------------------------------
const SANDBOX_TREES = ['scripts', 'shared', 'harness/specs/fixtures/ontology-lite-existing-contracts'];
const SANDBOX_FILES = ['docs/clawx-product-semantics.md', 'docs/modules/multi-agent-and-tasks.md', 'README.md'];

function git(args: string[], cwd: string, encoding: 'utf8' | 'buffer' = 'utf8'): string | Buffer {
  const result = spawnSync('git', args, { cwd, encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr?.toString() ?? result.error?.message}`);
  }
  return result.stdout;
}

function buildSandbox(): string {
  const sandbox = path.join(TMP, 'candidate');
  mkdirSync(sandbox, { recursive: true });
  // Tracked and untracked-but-not-ignored files: the working tree is the candidate
  // under test, so a fixture added in this change set is part of it too.
  const files = (git(['ls-files', '-z', '-co', '--exclude-standard', '--', ...SANDBOX_TREES, ...SANDBOX_FILES], ROOT) as string).split('\0').filter(Boolean);
  for (const relative of files) {
    const source = path.join(ROOT, relative);
    if (!existsSync(source)) continue;
    const target = path.join(sandbox, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  // Only the rule under test; the real .gitignore ignores docs/** wholesale
  // and would keep the two cited documents out of the sandbox commit.
  writeFileSync(path.join(sandbox, '.gitignore'), `/${RUNTIME_REL}/\n`);
  git(['init', '-q', '-b', 'main'], sandbox);
  for (const [key, value] of [['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['user.name', 'tf0639-sandbox'], ['user.email', 'tf0639@sandbox.invalid']]) {
    git(['config', key, value], sandbox);
  }
  git(['add', '-A'], sandbox);
  git(['commit', '-q', '-m', 'tf0639 clean candidate sandbox'], sandbox);
  return realpathSync(sandbox);
}

const SANDBOX = buildSandbox();
const SANDBOX_ENTRY = path.join(SANDBOX, ENTRY);
const SANDBOX_RUNTIME_DIR = path.join(SANDBOX, RUNTIME_REL);

/** Bytes of a path as committed in the sandbox candidate — what the checker must hash. */
function candidateBlob(relative: string): Buffer {
  return git(['cat-file', 'blob', `HEAD:${relative}`], SANDBOX, 'buffer') as Buffer;
}

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

async function spawnChecker(entry: string, cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (value !== undefined) childEnv[key] = value;
  }
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8', env: childEnv, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return { code: typeof failure.code === 'number' ? failure.code : -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}
/** The checker as copied into the clean candidate sandbox. */
const run = (args: string[], env: Record<string, string | undefined> = {}) => spawnChecker(SANDBOX_ENTRY, SANDBOX, args, env);
/** The checker in the real checkout (default invocation only). */
const runReal = (args: string[]) => spawnChecker(ENTRY, ROOT, args);

async function report(args: string[], env: Record<string, string | undefined> = {}) {
  const file = tmpPath('report.json');
  const result = await run([...args, '--report', file], env);
  return { ...result, file, report: existsSync(file) ? (readJson(file) as ProductSemanticEvidenceReport) : null };
}

// Bounded runtime files live under the sandbox's ignored report/runtime/ (inside
// the sandbox root, untracked, not dirtying it) and are removed whatever the
// outcome. Nothing is ever written under the real checkout.
async function withRuntimeFile<T>(name: string, bytes: Buffer, body: (relativePath: string) => Promise<T>): Promise<T> {
  mkdirSync(SANDBOX_RUNTIME_DIR, { recursive: true });
  writeFileSync(path.join(SANDBOX_RUNTIME_DIR, name), bytes);
  try {
    return await body(`${RUNTIME_REL}/${name}`);
  } finally {
    rmSync(SANDBOX_RUNTIME_DIR, { recursive: true, force: true });
  }
}
async function withEscapeLink<T>(body: (relativePath: string) => Promise<T>): Promise<T> {
  const target = path.join(TMP, 'escape-target');
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'escaped.md'), 'escaped bytes that live outside the repository\n');
  mkdirSync(SANDBOX_RUNTIME_DIR, { recursive: true });
  // 'junction' needs no privilege on Windows; POSIX ignores the type and creates a symlink.
  symlinkSync(target, path.join(SANDBOX_RUNTIME_DIR, 'escape-link'), 'junction');
  try {
    return await body(`${RUNTIME_REL}/escape-link/escaped.md`);
  } finally {
    rmSync(SANDBOX_RUNTIME_DIR, { recursive: true, force: true });
  }
}
/** An untracked, un-ignored file at the sandbox root: the smallest dirty candidate. */
async function withDirtySandbox<T>(body: (dirtyPath: string) => Promise<T>): Promise<T> {
  const name = 'tf0639-dirty-probe.txt';
  writeFileSync(path.join(SANDBOX, name), 'untracked probe\n');
  try {
    return await body(name);
  } finally {
    rmSync(path.join(SANDBOX, name), { force: true });
  }
}
/** Overwrites a tracked sandbox file's working copy, restoring it from the candidate afterwards. */
async function withWorkingCopy<T>(relative: string, bytes: Buffer, body: () => Promise<T>): Promise<T> {
  writeFileSync(path.join(SANDBOX, relative), bytes);
  try {
    return await body();
  } finally {
    git(['checkout', '--', relative], SANDBOX);
  }
}

afterAll(() => {
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
    const result = await runReal([]);
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

  it('probes every declared relation rule exactly once and observes all of them on the live validator', () => {
    expect(RELATION_RULE_PROBES.map((probe) => probe.rule)).toEqual([...semantics.PRODUCT_SEMANTIC_RELATION_RULES]);
    for (const probe of RELATION_RULE_PROBES) {
      const { diagnostics } = semantics.validateProductSemanticRelations(probe.candidates, probe.context);
      expect(rulesOf(diagnostics), probe.rule).toContain(probe.rule);
    }
    const observation = observeRelationRules(semantics);
    expect(observation.observed).toEqual([...semantics.PRODUCT_SEMANTIC_RELATION_RULES]);
    expect(observation.missing).toEqual([]);
    expect(observation.unknown).toEqual([]);
  });

  it('observes nothing from a validator that reports nothing, and names what is missing', () => {
    const noop = { ...semantics, validateProductSemanticRelations: () => ({ ok: true, diagnostics: [] }) };
    const observation = observeRelationRules(noop);
    expect(observation.observed).toEqual([]);
    expect(observation.missing).toEqual([...semantics.PRODUCT_SEMANTIC_RELATION_RULES]);
    const undeclared = { ...semantics, validateProductSemanticRelations: () => ({ ok: false, diagnostics: [{ relationKey: 'a--b--c', field: 'x', rule: 'made-up-rule', message: 'x' }] }) };
    expect(observeRelationRules(undeclared).unknown).toEqual(['made-up-rule']);
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
    const facts = describeSourceRef(ROOT, 'docs/modules/multi-agent-and-tasks.md', { candidateBlobs: null });
    expect(facts.exists).toBe(true);
    expect(facts.tracked).toBeNull();
    const diagnostics = sourceRefDiagnostics('x--y--z', facts);
    expect(rulesOf(diagnostics)).toEqual(['source-untracked']);
    expect(diagnostics[0].message).toMatch(/could not be observed/);
    const missing = describeSourceRef(ROOT, 'docs/does-not-exist.md', { candidateBlobs: new Map() });
    expect(rulesOf(sourceRefDiagnostics('x--y--z', missing))).toEqual(['source-missing']);
  });

  it('hashes the candidate blob, never the working-tree bytes, and hashes nothing without a candidate blob', () => {
    const relative = 'docs/modules/multi-agent-and-tasks.md';
    const onDisk = readFileSync(path.join(SANDBOX, relative));
    const committed = Buffer.from('alpha\nbeta\n', 'utf8');
    expect(onDisk.equals(committed)).toBe(false);
    const fromBlob = describeSourceRef(SANDBOX, relative, { candidateBlobs: new Map([[relative, committed]]) });
    expect(fromBlob).toMatchObject({ exists: true, tracked: true, symlinkEscape: false, digest: sha256(committed), rawDigest: sha256(committed) });
    const notInCandidate = describeSourceRef(SANDBOX, relative, { candidateBlobs: new Map() });
    expect(notInCandidate).toMatchObject({ exists: true, tracked: false, digest: null, rawDigest: null });
    expect(rulesOf(sourceRefDiagnostics('x--y--z', notInCandidate))).toEqual(['source-untracked']);
  });
});

describe('--report on the live registry (clean candidate sandbox)', () => {
  it('writes a valid report that binds every relation, its candidate-blob digests and a clean candidate', async () => {
    const result = await report(['--actor', ACTOR]);
    expect(result.stderr).toBe('');
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
    expect(generated.normalization.rawDigestPolicy).toMatch(/candidate blob \(git cat-file blob HEAD:<path>\)/);
    expect(generated.rulesEvaluated).toEqual([...semantics.PRODUCT_SEMANTIC_RELATION_RULES, ...SOURCE_DIAGNOSTIC_RULES]);

    const candidate = describeCandidate(SANDBOX);
    expect(generated.candidate).toEqual({ commit: candidate.commit, tree: candidate.tree, dirty: false, dirtyPaths: [] });
    expect(generated.candidate.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(generated.candidate.tree).toMatch(/^[0-9a-f]{40}$/);

    expect(generated.relations).toHaveLength(semantics.PRODUCT_SEMANTIC_RELATIONS.length);
    generated.relations.forEach((entry, index) => {
      const relation = semantics.PRODUCT_SEMANTIC_RELATIONS[index];
      expect(Object.keys(entry)).toEqual(['relationKey', 'sourceRefs']);
      expect(entry.relationKey).toBe(semantics.relationKey(relation));
      expect(entry.sourceRefs.map((ref) => ref.path)).toEqual([...relation.evidenceRefs]);
      for (const ref of entry.sourceRefs) {
        expect(Object.keys(ref)).toEqual(SOURCE_REF_KEYS);
        expect(ref).toMatchObject({ exists: true, insideRoot: true, tracked: true, symlinkEscape: false });
        const expected = digestEvidenceBytes(candidateBlob(ref.path));
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

  it('rejects a known but wrong relation endpoint through the real entry', async () => {
    const generated = await report(['--fixture', `${FIXTURES}/known-wrong-endpoint.json`]);
    expect(generated.code).toBe(1);
    expect(generated.report?.status).toBe('invalid');
    expect(generated.report?.diagnostics).toContainEqual(expect.objectContaining({
      rule: 'relation-endpoint-mismatch', field: 'to', relationKey: 'routing-memo--quality-gated-by--chat',
    }));
  });

  it('a validator stubbed to a no-op cannot keep the declared rules: rulesEvaluated shrinks and the report is invalid', async () => {
    const { report: generated, fixture } = await negative('validator-noop');
    expect(rulesOf(generated.diagnostics)).toEqual(['report-field-missing']);
    expect(generated.diagnostics[0].field).toBe('rulesEvaluated');
    expect(generated.diagnostics[0].message).toMatch(new RegExp(`reported 0 of ${fixture.expect.missingRuleCount} declared relation rule\\(s\\)`));
    for (const rule of semantics.PRODUCT_SEMANTIC_RELATION_RULES) expect(generated.diagnostics[0].message).toContain(rule);
    expect(generated.rulesEvaluated).toEqual([...SOURCE_DIAGNOSTIC_RULES]);
    expect(generated.rulesEvaluated).toHaveLength(fixture.expect.rulesEvaluatedLength);
    // The relations themselves were still enumerated and their sources still bound.
    expect(generated.relations.reduce((sum, entry) => sum + entry.sourceRefs.length, 0)).toBe(8);
    expect(generated.unverified).toEqual([]);
  });

  it('rechecks the validator probes when verifying an earlier valid report', async () => {
    const generated = await report(['--actor', ACTOR]);
    expect(generated.code).toBe(0);
    const bytes = readFileSync(generated.file);
    const candidate = describeCandidate(SANDBOX);

    const verified = await run(['--fixture', `${FIXTURES}/validator-noop.json`, '--verify', generated.file]);
    expect(verified.code).toBe(1);
    expect(verified.stderr).toContain('[report-field-missing] - rulesEvaluated:');
    for (const rule of semantics.PRODUCT_SEMANTIC_RELATION_RULES) expect(verified.stderr).toContain(rule);
    expect(readFileSync(generated.file)).toEqual(bytes);
    expect(describeCandidate(SANDBOX)).toEqual(candidate);
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

  it('an untracked local file is rejected and, having no candidate blob, is not hashed', async () => {
    const bytes = Buffer.from('# untracked probe\r\nsecond line\r\n', 'utf8');
    await withRuntimeFile('untracked-probe.md', bytes, async () => {
      const { report: generated, fixture } = await negative('source-untracked');
      const ref = generated.relations[3].sourceRefs[0];
      expect(ref).toMatchObject({ exists: true, insideRoot: true, tracked: false, symlinkEscape: false, digest: null, rawDigest: null });
      expect(generated.unverified).toEqual([{ relationKey: fixture.expect.relationKey, path: fixture.expect.path, reason: 'source-untracked' }]);
      // The ignored runtime probe is untracked without dirtying the candidate.
      expect(generated.candidate.dirty).toBe(false);
      expect(rulesOf(generated.diagnostics)).toEqual(['source-untracked']);
    });
    expect(existsSync(SANDBOX_RUNTIME_DIR)).toBe(false);
  });

  it('a link whose real path leaves the root is rejected and its bytes are not hashed', async () => {
    await withEscapeLink(async () => {
      const { report: generated } = await negative('source-symlink-escape');
      const ref = generated.relations[3].sourceRefs[0];
      expect(ref).toMatchObject({ exists: true, insideRoot: true, symlinkEscape: true, digest: null, rawDigest: null });
      expect(generated.unverified[0].reason).toBe('source-symlink-escape');
      expect(generated.candidate.dirty).toBe(false);
    });
    expect(existsSync(SANDBOX_RUNTIME_DIR)).toBe(false);
  });

  it('an unsupported contract version is reported, not read as the latest', async () => {
    const { report: generated, fixture } = await negative('version-unsupported');
    expect(generated.contractVersion).toBe(fixture.expect.contractVersion);
    expect(rulesOf(generated.diagnostics)).toEqual(['version-unsupported']);
  });

  it('tracked sources with LF and lone-CR bytes stay valid and record distinct digests of their candidate blobs', async () => {
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
    const lfBytes = candidateBlob(fixture.expect.paths.lf);
    const crBytes = candidateBlob(fixture.expect.paths.cr);
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

  it('a dirty candidate cannot pass: an untracked file makes --report invalid and --verify refuses the report', async () => {
    const dirty = await withDirtySandbox(async (dirtyPath) => {
      const result = await report(['--actor', ACTOR]);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/\[evidence-refs\] FAIL report invalid: 6 relation\(s\), 8 source ref\(s\), 1 diagnostic\(s\)/);
      expect(result.stderr).toMatch(/\[candidate-mismatch\] - candidate\.dirty: The working tree is dirty \(1 path\(s\): tf0639-dirty-probe\.txt\)/);
      const generated = result.report;
      expect(generated).not.toBeNull();
      if (!generated) throw new Error('report missing');
      expect(generated).toMatchObject({ status: 'invalid', exitCode: 1, fixtures: [] });
      expect(generated.candidate.dirty).toBe(true);
      expect(generated.candidate.dirtyPaths).toEqual([dirtyPath]);
      expect(rulesOf(generated.diagnostics)).toEqual(['candidate-mismatch']);
      expect(generated.diagnostics[0].field).toBe('candidate.dirty');
      // Digests are still the candidate blobs': the dirty tree changes the verdict, not the bytes bound.
      for (const entry of generated.relations) {
        for (const ref of entry.sourceRefs) expect(ref.rawDigest).toBe(digestEvidenceBytes(candidateBlob(ref.path)).rawDigest);
      }
      return result;
    });
    expect(describeCandidate(SANDBOX).dirty).toBe(false);
    const verified = await run(['--verify', dirty.file]);
    expect(verified.code).toBe(1);
    expect(verified.stderr).toMatch(/\[candidate-mismatch\] - candidate\.dirty: Report records a dirty candidate \(1 path\(s\)\)/);
    expect(verified.stderr).toMatch(/\[report-field-missing\] - status: Report recorded status "invalid"/);
  });

  it('working-tree bytes never enter a digest: a CRLF re-checkout or edit of a tracked source leaves its digests equal to the candidate blob and fails only as a dirty candidate', async () => {
    const relative = 'docs/modules/multi-agent-and-tasks.md';
    const blob = candidateBlob(relative);
    expect(blob.includes(0x0d)).toBe(false);
    const clean = await report(['--actor', ACTOR]);
    expect(clean.code).toBe(0);
    const cleanRefs = clean.report?.relations.flatMap((entry) => entry.sourceRefs.filter((ref) => ref.path === relative)) ?? [];
    expect(cleanRefs.length).toBeGreaterThan(0);

    const crlf = Buffer.from(blob.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    await withWorkingCopy(relative, crlf, async () => {
      expect(readFileSync(path.join(SANDBOX, relative)).equals(blob)).toBe(false);
      const edited = await report(['--actor', ACTOR]);
      expect(edited.code).toBe(1);
      expect(edited.stderr).not.toMatch(/source-digest-mismatch/);
      const generated = edited.report;
      expect(generated).not.toBeNull();
      if (!generated) throw new Error('report missing');
      expect(rulesOf(generated.diagnostics)).toEqual(['candidate-mismatch']);
      expect(generated.diagnostics[0].field).toBe('candidate.dirty');
      expect(generated.candidate.dirtyPaths).toEqual([relative]);
      const editedRefs = generated.relations.flatMap((entry) => entry.sourceRefs.filter((ref) => ref.path === relative));
      expect(editedRefs).toEqual(cleanRefs);
      for (const ref of editedRefs) {
        expect(ref.digest).toBe(digestEvidenceBytes(blob).digest);
        expect(ref.rawDigest).toBe(sha256(blob));
        expect(ref.rawDigest).not.toBe(sha256(crlf));
      }
    });
    expect(describeCandidate(SANDBOX)).toMatchObject({ dirty: false, dirtyPaths: [] });
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

  it('left the candidate sandbox clean and never wrote into the real checkout', () => {
    expect(describeCandidate(SANDBOX)).toMatchObject({ dirty: false, dirtyPaths: [] });
    expect(existsSync(SANDBOX_RUNTIME_DIR)).toBe(false);
    expect(existsSync(path.join(ROOT, RUNTIME_REL))).toBe(false);
  });
});

describe('--verify invalidates tampered or incomplete reports', () => {
  const candidate = describeCandidate(SANDBOX);
  const options = { root: SANDBOX, contractVersion: semantics.PRODUCT_SEMANTIC_CONTRACT_VERSION, candidate, registry: semantics };
  const base = buildEvidenceReport({ root: SANDBOX, registry: semantics, candidate, actor: ACTOR, command: ['node', ENTRY] });

  function verifyTampered(mutate: (copy: Json) => void) {
    const copy: Json = structuredClone(base);
    mutate(copy);
    return verifyEvidenceReport(copy, options);
  }

  it('accepts the untampered report', () => {
    expect(base.status).toBe('valid');
    expect(base.candidate.dirty).toBe(false);
    const result = verifyEvidenceReport(base, options);
    expect(result).toEqual({ status: 'valid', diagnostics: [], rulesEvaluated: [...semantics.PRODUCT_SEMANTIC_RELATION_RULES, ...SOURCE_DIAGNOSTIC_RULES] });
  });

  it.each(['missing', 'unknown'] as const)('rejects %s rules observed from the current validator probes', (mutation) => {
    const registry = {
      ...semantics,
      validateProductSemanticRelations: (...args: Parameters<typeof semantics.validateProductSemanticRelations>) => {
        const result = semantics.validateProductSemanticRelations(...args);
        const diagnostics = mutation === 'missing'
          ? result.diagnostics.filter(({ rule }) => rule !== 'relation-endpoint-mismatch')
          : result.diagnostics.length > 0
            ? [...result.diagnostics, { ...result.diagnostics[0], rule: 'undeclared-probe-rule' }]
            : result.diagnostics;
        return { ok: diagnostics.length === 0, diagnostics };
      },
    };
    const result = verifyEvidenceReport(base, { ...options, registry });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      rule: 'report-field-missing', field: 'rulesEvaluated',
      message: expect.stringContaining(mutation === 'missing' ? 'missing: relation-endpoint-mismatch' : 'unknown: undeclared-probe-rule'),
    }));
    if (mutation === 'missing') expect(result.rulesEvaluated).not.toContain('relation-endpoint-mismatch');
    else expect(result.rulesEvaluated).toContain('undeclared-probe-rule');
  });

  const TAMPER_CASES: Array<[string, (copy: Json) => void, string, string]> = [
    ['canonical digest', (copy) => { copy.relations[0].sourceRefs[0].digest = '0'.repeat(64); }, 'source-digest-mismatch', 'digest'],
    ['raw digest', (copy) => { copy.relations[0].sourceRefs[0].rawDigest = '0'.repeat(64); }, 'source-digest-mismatch', 'rawDigest'],
    ['candidate commit', (copy) => { copy.candidate.commit = '0'.repeat(40); }, 'candidate-mismatch', 'candidate.commit'],
    ['candidate tree', (copy) => { copy.candidate.tree = '0'.repeat(40); }, 'candidate-mismatch', 'candidate.tree'],
    ['dirty candidate', (copy) => { copy.candidate.dirty = true; copy.candidate.dirtyPaths = ['probe.txt']; }, 'candidate-mismatch', 'candidate.dirty'],
    ['contract version', (copy) => { copy.contractVersion = 'ProductSemanticRelations/v2'; }, 'version-unsupported', 'contractVersion'],
    ['report schema', (copy) => { copy.schema = 'SomethingElse/v1'; }, 'version-unsupported', 'schema'],
    ['normalization policy', (copy) => { copy.normalization.policy = 'md5 over whatever'; }, 'version-unsupported', 'normalization.policy'],
    ['working-tree raw digest policy', (copy) => { copy.normalization.rawDigestPolicy = 'sha256 over the raw file bytes as stored, so the original line endings stay recoverable'; }, 'version-unsupported', 'normalization.rawDigestPolicy'],
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
    // Registry reconciliation: a stored report must still describe the live registry.
    ['relations trimmed to one', (copy) => { copy.relations = copy.relations.slice(0, 1); }, 'report-field-missing', 'relations'],
    ['relation key not in the registry', (copy) => { copy.relations[0].relationKey = 'task-ledger--projects--workboard'; }, 'report-field-missing', 'relations[0].relationKey'],
    ['duplicated relation result', (copy) => { copy.relations.push(structuredClone(copy.relations[0])); }, 'report-field-missing', 'relations[6].relationKey'],
    ['source refs emptied', (copy) => { copy.relations[0].sourceRefs = []; }, 'report-field-missing', 'relations[0].sourceRefs'],
    ['source refs re-pointed', (copy) => { copy.relations[0].sourceRefs = copy.relations[1].sourceRefs; }, 'report-field-missing', 'relations[0].sourceRefs'],
    ['rules list replaced', (copy) => { copy.rulesEvaluated = ['x']; }, 'report-field-missing', 'rulesEvaluated'],
    ['rules trimmed to the source rules (a no-op validator\'s report)', (copy) => { copy.rulesEvaluated = [...SOURCE_DIAGNOSTIC_RULES]; }, 'report-field-missing', 'rulesEvaluated'],
    ['valid status with diagnostics', (copy) => { copy.diagnostics = [{ relationKey: null, field: 'x', rule: 'source-missing', message: 'x' }]; }, 'report-field-missing', 'status'],
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
      // Re-pointing a source ref is also a registry mismatch: the report no
      // longer cites the registry's evidenceRefs for that relation.
      expect(rulesOf(result.diagnostics)).toEqual(['source-untracked', 'report-field-missing']);
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

// The umbrella contract's step four names four integration negatives that must fail
// through the gate CI actually consumes (`pnpm test` -> vitest -> this file), not only
// through the exported functions: a bad relation, a stale source, an empty report and
// a skipped check. Each case below spawns the CLI; the fixtures are the C3 ones under
// report/fixtures/ (plus C5's validator-noop) and no second fixture set exists.
describe('evidence refs check: real gate entry (node scripts/check-evidence-refs.mjs)', () => {
  const RELATION_RULE_COUNT = 12;
  const SOURCE_RULE_COUNT = 8;
  const CLOSED_RULES: string[] = [...semantics.PRODUCT_SEMANTIC_RELATION_RULES, ...SOURCE_DIAGNOSTIC_RULES];

  it('binds the closed rule set the gate must evaluate: 12 relation rules + 8 source rules, no overlap', () => {
    expect(semantics.PRODUCT_SEMANTIC_RELATION_RULES).toHaveLength(RELATION_RULE_COUNT);
    expect(SOURCE_DIAGNOSTIC_RULES).toHaveLength(SOURCE_RULE_COUNT);
    expect(new Set(CLOSED_RULES).size).toBe(RELATION_RULE_COUNT + SOURCE_RULE_COUNT);
  });

  it('a bad relation cannot pass: --fixture bad-relation-self-loop exits 1, the report is invalid and --verify refuses it as candidate evidence', async () => {
    const result = await report(['--fixture', `${FIXTURES}/bad-relation-self-loop.json`, '--actor', ACTOR]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/\[evidence-refs\] FAIL report invalid: 6 relation\(s\), 8 source ref\(s\), 1 diagnostic\(s\)/);
    expect(result.stderr).toMatch(/\[self-loop\] chat--suggests-upgrade-to--chat to: "chat" cannot relate to itself\./);
    const generated = result.report;
    expect(generated).not.toBeNull();
    if (!generated) return;
    expect(generated).toMatchObject({ status: 'invalid', exitCode: 1, fixtures: ['bad-relation-self-loop'] });
    expect(rulesOf(generated.diagnostics)).toEqual(['self-loop']);
    for (const diagnostic of generated.diagnostics) expect(CLOSED_RULES).toContain(diagnostic.rule);
    expect(generated.relations).toHaveLength(semantics.PRODUCT_SEMANTIC_RELATIONS.length);

    const verified = await run(['--verify', result.file]);
    expect(verified.code).toBe(1);
    expect(verified.stderr).toMatch(/\[candidate-mismatch\] - fixtures: Report was generated under 1 in-memory fixture mutation\(s\) \(bad-relation-self-loop\)/);
    expect(verified.stderr).toMatch(/\[report-field-missing\] - status: Report recorded status "invalid" with 1 diagnostic\(s\)/);
  });

  it('a stale source cannot pass: --verify under stale-source-rewrite exits 1 with source-digest-mismatch and leaves the report untouched', async () => {
    const fixture = readJson(path.join(ROOT, FIXTURES, 'stale-source-rewrite.json'));
    const generated = await report(['--actor', ACTOR]);
    expect(generated.code).toBe(0);
    const before = readFileSync(generated.file);
    const verified = await run(['--fixture', `${FIXTURES}/stale-source-rewrite.json`, '--verify', generated.file]);
    expect(verified.code).toBe(1);
    expect(verified.stderr).toMatch(/\[evidence-refs\] FAIL verify invalid/);
    const citing = semantics.PRODUCT_SEMANTIC_RELATIONS.filter((relation) => (relation.evidenceRefs as readonly string[]).includes(fixture.expect.path));
    const mismatches = verified.stderr.split('\n').filter((line) => line.includes('[source-digest-mismatch]'));
    expect(mismatches).toHaveLength(citing.length * 2);
    expect(mismatches.every((line) => line.includes(fixture.expect.path) && line.includes('the source changed after the report was written'))).toBe(true);
    expect(verified.stderr).not.toMatch(/\[candidate-mismatch\]/);
    expect(readFileSync(generated.file).equals(before)).toBe(true);
  });

  it('an empty or hollow report cannot pass: --verify exits 1 naming every missing field, or the missing relation results', async () => {
    const empty = tmpPath('gate-empty-report.json');
    writeFileSync(empty, '{}\n');
    const emptyResult = await run(['--verify', empty]);
    expect(emptyResult.code).toBe(1);
    expect(emptyResult.stderr).toMatch(/\[evidence-refs\] FAIL verify invalid: .*\(15 diagnostic\(s\)\)/);
    for (const field of REPORT_KEYS) expect(emptyResult.stderr).toContain(`[report-field-missing] - ${field}:`);
    expect(readFileSync(empty, 'utf8')).toBe('{}\n');

    const generated = await report(['--actor', ACTOR]);
    expect(generated.code).toBe(0);
    expect(generated.report).not.toBeNull();
    if (!generated.report) return;
    const hollow = tmpPath('gate-hollow-report.json');
    const copy: Json = structuredClone(generated.report);
    copy.relations = [];
    const text = `${JSON.stringify(copy, null, 2)}\n`;
    writeFileSync(hollow, text);
    const hollowResult = await run(['--verify', hollow]);
    expect(hollowResult.code).toBe(1);
    expect(hollowResult.stderr).toMatch(/\[evidence-refs\] FAIL verify invalid: .*\(1 diagnostic\(s\)\)/);
    expect(hollowResult.stderr).toMatch(/\[report-field-missing\] - relations: relations records no relation check result\./);
    expect(readFileSync(hollow, 'utf8')).toBe(text);
  });

  it('a skipped check cannot pass: the positive report records all 6 relations, 8 source refs and exactly the 20 closed rules', async () => {
    const result = await report(['--actor', ACTOR]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\[evidence-refs\] report valid: 6 relation\(s\), 8 source ref\(s\), 0 diagnostic\(s\) -> /);
    const generated = result.report;
    expect(generated).not.toBeNull();
    if (!generated) return;
    expect(generated).toMatchObject({ status: 'valid', exitCode: 0, diagnostics: [], unverified: [], fixtures: [] });
    expect(generated.relations).toHaveLength(semantics.PRODUCT_SEMANTIC_RELATIONS.length);
    expect(generated.relations).toHaveLength(6);
    expect(generated.relations.map((entry) => entry.relationKey)).toEqual(semantics.PRODUCT_SEMANTIC_RELATIONS.map((relation) => semantics.relationKey(relation)));
    expect(generated.relations.reduce((sum, entry) => sum + entry.sourceRefs.length, 0)).toBe(8);
    expect(generated.rulesEvaluated).toEqual(CLOSED_RULES);
    expect(generated.rulesEvaluated).toHaveLength(RELATION_RULE_COUNT + SOURCE_RULE_COUNT);
    const verified = await run(['--verify', result.file]);
    expect(verified.code).toBe(0);
    expect(verified.stdout).toMatch(/^\[evidence-refs\] verify valid: .* \(6 relation\(s\), 8 source ref\(s\), candidate [0-9a-f]{9}\)\n$/);
  });

  // TF-0639 compatibility ruling for the sealed C4 evidence: it was digested from
  // working-tree bytes under the old normalization text, so under the candidate-blob
  // policy it is version-unsupported — never silently re-read, never re-signed.
  it('the sealed final/ report is unchanged and, under the candidate-blob policy, verifies as version-unsupported rather than being silently accepted', async () => {
    const sums = readFileSync(path.join(ROOT, FINAL_DIR, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
    expect(sums.length).toBeGreaterThanOrEqual(4);
    for (const line of sums) {
      const [digest, name] = line.split(/\s+\*?/);
      expect(sha256(readFileSync(path.join(ROOT, FINAL_DIR, name))), name).toBe(digest);
    }
    const sealedPath = path.join(ROOT, FINAL_DIR, 'evidence-report.json');
    const sealed = readJson(sealedPath) as ProductSemanticEvidenceReport;
    expect(sealed.normalization.policy).not.toBe(EVIDENCE_NORMALIZATION.policy);
    expect(sealed.normalization.rawDigestPolicy).not.toBe(EVIDENCE_NORMALIZATION.rawDigestPolicy);
    const before = readFileSync(sealedPath);
    const verified = await run(['--verify', sealedPath]);
    expect(verified.code).toBe(1);
    expect(verified.stderr).toMatch(/\[version-unsupported\] - normalization\.policy: Report digests were produced under a different normalization policy/);
    expect(verified.stderr).toMatch(/\[version-unsupported\] - normalization\.rawDigestPolicy: Report raw digests were produced under a different policy/);
    expect(verified.stderr).toMatch(/\[candidate-mismatch\] - candidate\.commit/);
    expect(readFileSync(sealedPath).equals(before)).toBe(true);
  });
});
