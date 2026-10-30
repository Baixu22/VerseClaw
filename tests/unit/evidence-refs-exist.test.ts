// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import validInput from '../../harness/specs/fixtures/ontology-lite-existing-contracts/relations.valid.json';
import { checkEvidenceRefs, collectEvidenceRefs, createProductSemanticEvidence, validateProductSemanticEvidence } from '../../scripts/check-evidence-refs.mjs';

describe('evidence reference path validation (#92)', () => {
  it('resolves every declared shared evidence path from a clean checkout', () => {
    const result = checkEvidenceRefs(process.cwd());
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

function nativeSetup() {
  const fixture = setup();
  for (const path of ['shared/capability-claims.ts', 'shared/sensitive-content-boundary.ts', 'shared/reliability-boundaries.ts', 'shared/dcs/prod-flags-catalog.ts']) {
    write(fixture.root, path, '// Bounded native evidence fixture\n');
  }
  for (const refs of collectEvidenceRefs(fixture.root).values()) {
    for (const ref of refs) {
      try { readFileSync(join(fixture.root, ref)); }
      catch { write(fixture.root, ref, '// Bounded native path reference\n'); }
    }
  }
  commit(fixture.root);
  const output = mkdtempSync(join(tempRoot, 'semantic-gate-output-'));
  temporaryRoots.push(output);
  return { ...fixture, output };
}

function nativeGate(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/check-evidence-refs.mjs'), '--root', root, ...args], {
    cwd: process.cwd(), windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
}

describe('native repo evidence gate integration', () => {
  it('runs the existing path gate and derives all semantic checks through the actual CLI', () => {
    const scripts = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).scripts;
    expect(scripts['repo:evidence:check']).toBe('node scripts/check-evidence-refs.mjs');
    const spec = readFileSync(resolve(process.cwd(), 'harness/specs/tasks/ontology-lite-existing-contracts-hardening.md'), 'utf8');
    expect(spec).toContain('  - pnpm repo:evidence:check');
    expect(spec).toContain('tests/unit/evidence-refs-exist.test.ts');
    const { root, output } = nativeSetup();
    const path = join(output, 'semantic-report.json');
    const result = nativeGate(root, '--write-semantic-report', path);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('[evidence-refs] PASS');
    expect(result.stdout).toContain('[semantic-evidence] PASS');
    const report = JSON.parse(readFileSync(path, 'utf8'));
    expect(report.candidate.dirty).toBe(false);
    expect(report.checks.map((row: {id: string}) => row.id)).toEqual(['relations', 'sources', 'candidate']);
    expect(report.driven_by).toBe('agent');
    expect(nativeGate(root, '--semantic-report', path).status).toBe(0);
  });

  it('still rejects a missing original capability evidence path before semantic acceptance', () => {
    const { root } = nativeSetup();
    write(root, 'shared/capability-claims.ts', '// docs/missing-capability.md\n');
    commit(root);
    const result = nativeGate(root);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('shared/capability-claims.ts: docs/missing-capability.md');
    expect(result.stdout).not.toContain('[semantic-evidence] PASS');
  });

  it.each(['wrong-relation', 'stale-source', 'empty-report', 'omitted-check'])('rejects %s through the actual CLI', action => {
    const { root, output } = nativeSetup();
    const report = createProductSemanticEvidence(root);
    expect(report.status).toBe('valid');
    let expectedRule;
    if (action === 'wrong-relation') {
      const input = JSON.parse(readFileSync(join(root, fixtures, 'relations.valid.json'), 'utf8'));
      input.relations[0].authorityBoundary = 'read-only-projection';
      write(root, fixtures + '/relations.valid.json', JSON.stringify(input));
      commit(root);
      expectedRule = 'authority-combination';
    }
    if (action === 'stale-source') {
      write(root, 'docs/source.md', 'Static owner-source fixture changed after audit\n');
      commit(root);
      expectedRule = 'source-digest';
    }
    if (action === 'omitted-check') {
      report.checks.splice(0, 1);
      expectedRule = 'checks-required';
    }
    if (action === 'empty-report') expectedRule = 'report-version';
    const path = join(output, 'input-report.json');
    writeFileSync(path, JSON.stringify(action === 'empty-report' ? {} : report));
    const result = nativeGate(root, '--semantic-report', path);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain('[evidence-refs] PASS');
    expect(result.stdout).not.toContain('[semantic-evidence] PASS');
    expect(result.stderr).toContain(expectedRule);
  });
});

const temporaryRoots: string[] = [];
const fixtures = 'harness/specs/fixtures/ontology-lite-existing-contracts';
const tempRoot = resolve(tmpdir());
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const bounded = relative(tempRoot, resolve(root));
    expect(!isAbsolute(bounded) && bounded !== '..' && !bounded.startsWith('..' + sep)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
});

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
}
function write(root: string, path: string, value: string) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), value);
}
function commit(root: string) {
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'agent-driven source fixture');
}
function setup() {
  const root = mkdtempSync(join(tempRoot, 'semantic-evidence-'));
  temporaryRoots.push(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'semantic-fixture-agent');
  git(root, 'config', 'user.email', 'agent@fixture.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  for (const path of ['shared/product-semantics.ts', 'shared/types/identity-scope.ts', 'shared/types/task-ledger-reference.ts',
    'shared/types/coding-run.ts', 'shared/product-semantic-unsafe-claims.ts',
    'scripts/check-evidence-refs.mjs', 'scripts/lib/canonical-evidence-hash.mjs']) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    copyFileSync(resolve(process.cwd(), path), join(root, path));
  }
  const input = structuredClone(validInput);
  input.relations.forEach(row => { row.evidenceRefs = ['docs/source.md']; });
  write(root, fixtures + '/relations.valid.json', JSON.stringify(input));
  write(root, fixtures + '/relations.invalid.json', JSON.stringify({ driven_by: 'agent', actor: 'fixture-agent', cases: [] }));
  write(root, 'docs/source.md', 'Static owner-source fixture\n');
  write(root, 'tests/owner.test.ts', '// bounded source reference\n');
  const catalog = { schema: 'ProductSemanticSources/v1', driven_by: 'agent', actor: 'fixture-agent', boundaries: [],
    relations: input.relations.map(row => ({ relationKey: [row.from, row.kind, row.to].join(':'), evidenceGrade: 'documented-only',
      documentation: [{ path: 'docs/source.md', locator: 'Static owner-source fixture' }],
      owners: [{ path: 'docs/source.md', locator: 'Static owner-source fixture' }], regressions: ['tests/owner.test.ts'], unverified: ['Synthetic owner source; no runtime receipt.'] })) };
  write(root, fixtures + '/sources.json', JSON.stringify(catalog));
  commit(root);
  return { root, catalog };
}

describe('semantic evidence version, candidate and source binding', () => {
  it('derives a versioned source report from a clean candidate and recomputes its bindings', () => {
    const { root } = setup();
    const report = createProductSemanticEvidence(root, { actor: 'semantic-test-agent', command: 'Vitest semantic evidence fixture' });
    expect(report.status, JSON.stringify(report.diagnostics)).toBe('valid');
    expect(report.contractVersion).toBe('ProductSemanticRelations/v1');
    expect(report.relationKeys).toHaveLength(6);
    expect(report.candidate).toEqual({ commit: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}'), dirty: false });
    expect(report.sourceRefs.every(row => row.tracked && row.canonicalSha256.length === 64 && row.rawSha256.length === 64)).toBe(true);
    expect(report.checks.map(row => [row.id, row.exitCode])).toEqual([['relations', 0], ['sources', 0], ['candidate', 0]]);
    expect(report.unverified.length).toBeGreaterThan(0);
    expect(validateProductSemanticEvidence(root, report)).toEqual({ valid: true, diagnostics: [] });
    expect(report).not.toHaveProperty('grant');
  });

  it.each([
    ['old-contract', 'report-version', (row: Record<string, unknown>) => { row.contractVersion = 'ProductSemanticRelations/v0'; }],
    ['old-report', 'report-version', (row: Record<string, unknown>) => { row.schema = 'ProductSemanticEvidence/v0'; }],
    ['missing-actor', 'actor-required', (row: Record<string, unknown>) => { delete row.actor; }],
    ['human-claim', 'actor-required', (row: Record<string, unknown>) => { row.driven_by = 'real-human'; }],
    ['missing-command', 'command-required', (row: Record<string, unknown>) => { delete row.command; }],
    ['missing-time', 'report-time', (row: Record<string, unknown>) => { delete row.checkedAt; }],
    ['missing-checks', 'checks-required', (row: Record<string, unknown>) => { delete row.checks; }],
    ['empty-checks', 'checks-required', (row: Record<string, unknown>) => { row.checks = []; }],
    ['failed-check', 'checks-required', (row: Record<string, unknown>) => { (row.checks as Array<{ exitCode: number }>)[0].exitCode = 1; }],
    ['missing-digests', 'source-digest', (row: Record<string, unknown>) => { row.sourceRefs = []; }],
    ['wrong-digest', 'source-digest', (row: Record<string, unknown>) => { (row.sourceRefs as Array<{ canonicalSha256: string }>)[0].canonicalSha256 = '0'.repeat(64); }],
    ['wrong-candidate', 'candidate-mismatch', (row: Record<string, unknown>) => { (row.candidate as { commit: string }).commit = '0'.repeat(40); }],
    ['wrong-tree', 'candidate-mismatch', (row: Record<string, unknown>) => { (row.candidate as { tree: string }).tree = '0'.repeat(40); }],
    ['wrong-policy', 'hash-policy', (row: Record<string, unknown>) => { (row.hashPolicy as { algorithm: string }).algorithm = 'md5'; }],
    ['missing-relations', 'relation-coverage', (row: Record<string, unknown>) => { row.relationKeys = []; }],
    ['missing-owner-map', 'relation-coverage', (row: Record<string, unknown>) => { row.relationSources = []; }],
    ['missing-limitations', 'limitations-required', (row: Record<string, unknown>) => { row.unverified = []; }],
    ['replaced-limitations', 'limitations-required', (row: Record<string, unknown>) => { row.unverified = ['Runtime verified']; }],
    ['forged-grant', 'undeclared-report-field', (row: Record<string, unknown>) => { row.grant = true; }],
  ] as const)('rejects %s at %s', (_name, rule, mutate) => {
    const { root } = setup();
    const report = structuredClone(createProductSemanticEvidence(root)) as unknown as Record<string, unknown>;
    mutate(report);
    const result = validateProductSemanticEvidence(root, report);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(row => row.rule === rule), JSON.stringify(result)).toBe(true);
  });

  it.each([null, {}, [], { status: 'valid' }])('rejects empty or incomplete reports: %j', report => {
    const { root } = setup();
    expect(validateProductSemanticEvidence(root, report).valid).toBe(false);
  });

  it('loads and rejects an unsupported version from the supplied candidate contract', () => {
    const { root } = setup();
    expect(createProductSemanticEvidence(root).status).toBe('valid');
    const path = 'shared/product-semantics.ts';
    write(root, path, readFileSync(join(root, path), 'utf8').replace('ProductSemanticRelations/v1', 'ProductSemanticRelations/v0'));
    commit(root);
    const report = createProductSemanticEvidence(root);
    expect(report.contractVersion).toBe('ProductSemanticRelations/v0');
    expect(report.status).toBe('invalid');
    expect(report.diagnostics.some(row => row.rule === 'input-version')).toBe(true);
  });

  it.each(['../outside.md', '/outside.md', 'C:/outside.md'])('rejects a repository escape %s before reading its bytes', path => {
    const { root, catalog } = setup();
    catalog.relations[0].owners[0].path = path;
    write(root, fixtures + '/sources.json', JSON.stringify(catalog));
    commit(root);
    const report = createProductSemanticEvidence(root);
    expect(report.status).toBe('invalid');
    expect(report.diagnostics.some(row => row.rule === 'source-scope')).toBe(true);
  });

  it('rejects symlink/junction escape for an otherwise tracked source path', () => {
    const { root } = setup();
    const outside = mkdtempSync(join(tempRoot, 'semantic-outside-'));
    temporaryRoots.push(outside);
    write(outside, 'source.md', 'Static owner-source fixture\n');
    renameSync(join(root, 'docs'), join(outside, 'original-docs'));
    symlinkSync(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(createProductSemanticEvidence(root).diagnostics.some(row => row.rule === 'source-symlink-escape')).toBe(true);
  });

  it.each(['delete', 'move', 'change', 'untracked'])('rejects %s source input without accepting an old pass', action => {
    const { root, catalog } = setup();
    const report = createProductSemanticEvidence(root);
    if (action === 'delete') rmSync(join(root, 'docs/source.md'));
    if (action === 'move') renameSync(join(root, 'docs/source.md'), join(root, 'docs/moved.md'));
    if (action === 'change') write(root, 'docs/source.md', 'Changed source\n');
    if (action === 'untracked') {
      write(root, 'docs/untracked.md', 'Static owner-source fixture\n');
      catalog.relations[0].owners[0].path = 'docs/untracked.md';
      write(root, fixtures + '/sources.json', JSON.stringify(catalog));
      git(root, 'add', fixtures + '/sources.json');
      git(root, 'commit', '--quiet', '-m', 'agent-driven untracked-source negative');
    }
    const result = validateProductSemanticEvidence(root, report);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(row => row.rule === (action === 'change' ? 'source-candidate' : action === 'untracked' ? 'source-untracked' : 'source-missing'))).toBe(true);
  });

  it('distinguishes original CRLF bytes from the LF canonical candidate digest', () => {
    const { root } = setup();
    git(root, 'config', 'core.autocrlf', 'true');
    write(root, 'docs/source.md', 'Static owner-source fixture\r\n');
    // Refresh Git's normalization metadata without changing the candidate's LF blob.
    git(root, 'add', 'docs/source.md');
    const report = createProductSemanticEvidence(root);
    const source = report.sourceRefs.find(row => row.path === 'docs/source.md')!;
    expect(report.status, JSON.stringify(report.diagnostics)).toBe('valid');
    expect(source.rawSha256).not.toBe(source.canonicalSha256);
    write(root, 'docs/source.md', 'Static owner-source fixture\n');
    git(root, 'add', 'docs/source.md');
    expect(validateProductSemanticEvidence(root, report).valid).toBe(true);
    expect(readFileSync(join(root, 'docs/source.md'), 'utf8')).not.toContain('\r');
  });
});
