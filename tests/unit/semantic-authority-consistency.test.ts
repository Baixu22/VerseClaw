// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import * as authorityModule from '../../shared/component-authority-manifest';
import * as dispositionModule from '../../shared/dcs/component-disposition-catalog';
import * as claimsModule from '../../shared/capability-claims';
import * as reliabilityModule from '../../shared/reliability-boundaries';
import * as sensitiveModule from '../../shared/sensitive-content-boundary';
import * as semanticsModule from '../../shared/product-semantics';
import * as flagsModule from '../../shared/dcs/prod-flags-catalog';
import * as runtimeLeavesModule from '../../openclaw_runtime/src/config/runtime-feature-leaves';
import * as settingsRoutesModule from '../../src/pages/Settings/route-config';
import {
  ADJUDICATION_PATH,
  ADJUDICATION_SCHEMA,
  AUTHORITY_IMPORT_ASSERTION,
  DIAGNOSTIC_FAMILY,
  INPUT_PATHS,
  REGISTRY_PATHS,
  REPORT_SCHEMA,
  RULES,
  STRUCTURAL_CLASSES,
  assembleRegistries,
  buildAdjudicationLocator,
  deferAuthorityImportAssertion,
  evaluateSemanticAuthority,
  expectedModesForMatrixValue,
  isComparableActivationPair,
  parseDefaultMatrixRows,
  parseProductSurfaceRows,
  relationKey,
  resolveDefaultMatrixRow,
} from '../../scripts/check-semantic-authority.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = 'scripts/check-semantic-authority.mjs';
const FIXTURE_DIR = 'tests/fixtures/semantic-authority';
const RECONCILIATION = 'docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md';
const execFileAsync = promisify(execFile);

// The closed rule set, written once here and once in the checker; the two
// copies are reconciled below so a rule cannot be added or dropped silently.
const EXPECTED_RULES = [
  'registry-self-validation',
  'identity-key',
  'concept-alias',
  'owner-namespace',
  'flag-binding',
  'default-activation',
  'default-retirement',
  'default-matrix-row',
  'default-flag-risk',
  'authority-boundary',
  'gap-registration',
  'exemption-registration',
  'exemption-reason-missing',
  'exemption-stale',
  'exemption-unknown-rule',
  'exemption-unknown-target',
  'adjudication-missing',
  'registry-load-failed',
];
// The five negative classes the task contract requires.
const CONTRACT_NEGATIVE_CLASSES = ['conflicting-owner', 'conflicting-default', 'conflicting-authority', 'missing-component', 'exemption-without-reason'];
// The structural exemption classes reconciled by TF-0638 (B2), keyed by ruling.
const EXPECTED_STRUCTURAL = { 'flag-granularity': 'X-01', 'internal-vocabulary': 'X-02', 'target-divergence': 'X-03', 'not-comparable': 'X-04', 'matrix-unmapped': 'X-05' };

// The checker ships an `any`-typed .d.mts surface (same convention as contract-check.d.mts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const adjudication: Json = JSON.parse(read(ADJUDICATION_PATH));

// Synthetic pending conflict for hygiene checks after the real C-02..C-06 debt was removed.
function pendingConflict(): Json {
  return {
    id: 'C-02/R-D1', rule: 'default-activation', disposition: 'registered-pending-fix',
    targetKind: 'component', target: 'working-memory-context-source',
    observed: { defaultMode: 'opt-in', dispositionId: 'component.working-memory-context', currentMode: 'baseline' },
    basis: 'explicit-adjudication', source: `${RECONCILIATION}#6.2-C-02`,
    reason: 'Test-only injection of the resolved pre-TF-0790 declaration.', reviewCondition: 'Remove once the declaration is corrected.',
  };
}


function realRegistries(): Json {
  return assembleRegistries(
    {
      authority: authorityModule,
      disposition: dispositionModule,
      claims: claimsModule,
      reliability: reliabilityModule,
      sensitive: sensitiveModule,
      semantics: semanticsModule,
      flags: flagsModule,
      runtimeLeaves: runtimeLeavesModule,
      settingsRoutes: settingsRoutesModule,
    },
    {
      settingsPanelIds: readdirSync(path.join(ROOT, INPUT_PATHS.settingsPanelsDir)).filter((name) => name.endsWith('.tsx')).map((name) => name.slice(0, -4)),
      appSource: read(INPUT_PATHS.app),
      nodeIds: JSON.parse(read(INPUT_PATHS.nodeIds)).ids,
      defaultMatrixText: read(INPUT_PATHS.defaultMatrix),
      productSurfaceText: read(INPUT_PATHS.productSurfaces),
    },
  );
}

// A mutable deep copy whose arrays can be edited; Maps survive structuredClone.
function cloneRegistries(): Json {
  return structuredClone(realRegistries());
}

function cloneAdjudication(): Json {
  return structuredClone(adjudication);
}

function evaluate(registries: Json, registry: Json | null = adjudication) {
  return evaluateSemanticAuthority(registries, registry, {});
}

function rulesOf(result: { diagnostics: Array<{ rule: string }> }): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.rule);
}

function component(registries: Json, id: string): Json {
  return registries.authority.components.find((entry: Json) => entry.id === id);
}

function disposition(registries: Json, id: string): Json {
  return registries.dispositions.find((entry: Json) => entry.id === id);
}

async function runGate(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('semantic authority check: closed rule set and helpers', () => {
  it('declares exactly the contracted rule set, reconciled with the checker', () => {
    expect([...RULES]).toEqual(EXPECTED_RULES);
    expect(new Set(RULES).size).toBe(RULES.length);
    expect(DIAGNOSTIC_FAMILY).toBe('semantic-authority');
    // Comparisons the reconciliation forbids are not rules (X-03, X-02, O-1, C-01, G-07).
    for (const forbidden of ['target-default-equality', 'internal-cross-table', 'id-suffix-identity', 'owner-field-authority', 'window-module']) {
      expect(RULES).not.toContain(forbidden);
    }
    expect(RULES.some((rule) => /target-default|suffix|window|internal-vocab/.test(rule))).toBe(false);
  });

  it('parses the two linked documents and resolves default-matrix anchors by slug', () => {
    const rows = parseDefaultMatrixRows(read(INPUT_PATHS.defaultMatrix));
    expect(rows.size).toBe(14);
    expect(resolveDefaultMatrixRow(rows, 'VToken-assembly')).toEqual({ label: 'VToken assembly', value: 'retired' });
    expect(resolveDefaultMatrixRow(rows, 'working-memory')).toEqual({ label: 'working-memory', value: 'true' });
    expect(resolveDefaultMatrixRow(rows, 'no-such-row')).toBeNull();
    const surfaces = parseProductSurfaceRows(read(INPUT_PATHS.productSurfaces));
    expect(surfaces.size).toBe(11);
    expect(surfaces.get('VToken turn assembly')).toBe('retired');
    expect(surfaces.get('Runtime Memory injection')).toBe('diagnostics-only');
  });

  it('maps matrix vocabulary onto the default-mode axis and leaves auto unmapped', () => {
    expect(expectedModesForMatrixValue('true')).toEqual({ kind: 'exact', modes: new Set(['baseline']) });
    expect(expectedModesForMatrixValue('retired')).toEqual({ kind: 'exact', modes: new Set(['retired']) });
    expect(expectedModesForMatrixValue('off')).toEqual({ kind: 'exclude', modes: new Set(['baseline', 'retired']) });
    expect(expectedModesForMatrixValue('auto')).toBeNull();
  });

  it('only compares activation-axis values (R-D1)', () => {
    expect(isComparableActivationPair('baseline', 'baseline')).toBe(true);
    expect(isComparableActivationPair('opt-in', 'shadow')).toBe(true);
    expect(isComparableActivationPair('internal', 'baseline')).toBe(false);
    expect(isComparableActivationPair('read-only', 'baseline')).toBe(false);
    expect(isComparableActivationPair('baseline', 'mixed')).toBe(false);
    expect(isComparableActivationPair('opt-in', 'retired')).toBe(false);
  });

  it('declares the five structural exemption classes with their rulings and target kinds (TF-0638)', () => {
    expect(Object.fromEntries(Object.entries(STRUCTURAL_CLASSES).map(([name, meta]) => [name, meta.ruling]))).toEqual(EXPECTED_STRUCTURAL);
    expect(STRUCTURAL_CLASSES['flag-granularity'].targetKind).toBe('flag');
    expect(STRUCTURAL_CLASSES['matrix-unmapped'].targetKind).toBe('doc-row');
    for (const name of ['internal-vocabulary', 'target-divergence', 'not-comparable']) expect(STRUCTURAL_CLASSES[name].targetKind).toBe('component');
  });

  it('defers only the module-level manifest assertion, on the same line, leaving the file text and line count intact', () => {
    const text = read(REGISTRY_PATHS.authority);
    expect(AUTHORITY_IMPORT_ASSERTION.test(text)).toBe(true);
    const deferred = deferAuthorityImportAssertion(text);
    expect(deferred.deferred).toBe(true);
    expect(deferred.text.split('\n')).toHaveLength(text.split('\n').length);
    expect(AUTHORITY_IMPORT_ASSERTION.test(deferred.text)).toBe(false);
    // The indented call inside buildComponentAuthorityProfile() is untouched.
    expect(deferred.text).toContain('  assertComponentAuthorityManifest();');
    expect(deferred.text).toContain('void 0; // assertComponentAuthorityManifest() is evaluated by scripts/check-semantic-authority.mjs');
    expect(deferAuthorityImportAssertion('export const x = 1;\n')).toEqual({ text: 'export const x = 1;\n', deferred: false });
    expect(deferAuthorityImportAssertion(undefined)).toEqual({ text: undefined, deferred: false });
  });

  it('locates adjudication entries by id and target, sections by key, and falls back to the schema header', () => {
    const text = read(ADJUDICATION_PATH);
    const lines = text.split(/\r?\n/);
    const locate = buildAdjudicationLocator(text);
    const x03 = locate({ id: 'X-03', target: 'dcs-context-authority', section: 'exemptions' });
    expect(lines[x03 - 1]).toContain('"id": "X-03"');
    expect(lines.slice(x03, x03 + 6).some((line) => line.includes('"target": "dcs-context-authority"'))).toBe(true);
    const otherX03 = locate({ id: 'X-03', target: 'task-ledger', section: 'exemptions' });
    expect(otherX03).not.toBe(x03);
    expect(lines[otherX03 - 1]).toContain('"id": "X-03"');
    expect(lines[locate({ id: 'removed-entry', section: 'adjudicatedConflicts' }) - 1]).toContain('"adjudicatedConflicts": []');
    expect(lines[locate({ id: 'I-4', target: 'routing-memo', section: 'conceptAliases' }) - 1]).toContain('"id": "I-4"');
    expect(lines[locate({ section: 'gaps' }) - 1]).toMatch(/^ {2}"gaps":/);
    expect(lines[locate({ section: 'exemptions' }) - 1]).toMatch(/^ {2}"exemptions":/);
    expect(lines[locate({ id: 'no-such-id', section: 'no-such-section' }) - 1]).toContain('"schema"');
    expect(buildAdjudicationLocator(undefined)({ id: 'X-03' })).toBeNull();
  });
});

describe('semantic authority check: current registries with the TF-0631 rulings registered', () => {
  const registries = realRegistries();
  const result = evaluate(registries);

  it('passes with the expected counts and every rule evaluated', () => {
    expect(result.issues).toEqual([]);
    expect(result.report.counts).toEqual({ components: 35, authorities: 44, dispositions: 54, claims: 45, reliability: 7, sensitive: 7, concepts: 7, relations: 6, flags: 22 });
    expect(result.report.rulesEvaluated).toEqual(EXPECTED_RULES);
    expect(result.report.adjudicated).toEqual([]);
    expect(result.report.notComparable).toHaveLength(21);
    expect(result.report.matrixUnmapped).toHaveLength(5);
    expect(result.report.flagGranularity).toEqual(['isolation-request', 'patch-flow', 'stale-write-guard', 'symbol-lease', 'symbol-lease-mode', 'worktree-backend', 'write-journal']);
    const gapTotals = Object.values(result.report.gaps as Record<string, { observed: string[]; registered: string[] }>);
    expect(gapTotals.reduce((sum, gap) => sum + gap.observed.length, 0)).toBe(35);
    expect(gapTotals.every((gap) => gap.observed.join() === gap.registered.join())).toBe(true);
    expect(result.report.exemptions).toEqual({ structural: 55, registeredPendingFix: 0, gaps: 35, conceptAliases: 1, authorityBindings: 3, invalid: 0 });
    expect(result.report.exemptionsApplied).toEqual({ 'X-01': 7, 'X-02': 4, 'X-03': 18, 'X-04': 21, 'X-05': 5 });
    expect(result.report.adjudicatedConflicts).toEqual({ rulings: 0, entries: 0, byRuling: {} });
    expect(result.report.gapsRegistered).toEqual({ total: 35, byRuling: { 'G-01': 1, 'G-02': 1, 'G-03': 5, 'G-04': 16, 'G-05': 5, 'G-06': 7 } });
    expect(result.report.conceptAliases).toEqual(['routing-memo -> routing-memo-observation']);
    expect(result.report.authorityBindings).toEqual(['task-loop--roots-in--task-ledger', 'workboard--references-one-way--task-ledger', 'routing-memo--quality-gated-by--task-loop']);
  });

  it('reconciles every structural class observed == registered (55/55), with the report-only lists as the observed sets (TF-0638)', () => {
    const structural = result.report.structural as Record<string, { ruling: string; observed: string[]; registered: string[] }>;
    expect(Object.keys(structural).sort()).toEqual(Object.keys(EXPECTED_STRUCTURAL).sort());
    for (const [name, ruling] of Object.entries(EXPECTED_STRUCTURAL)) {
      expect(structural[name].ruling, name).toBe(ruling);
      expect(structural[name].observed, name).toEqual(structural[name].registered);
      expect(structural[name].observed.length, name).toBeGreaterThan(0);
    }
    expect(structural['flag-granularity'].observed).toEqual(result.report.flagGranularity);
    expect(structural['not-comparable'].observed).toEqual([...result.report.notComparable].sort());
    expect(structural['matrix-unmapped'].observed).toEqual(result.report.matrixUnmapped.map((row: Json) => row.label).sort());
    expect(Object.fromEntries(Object.entries(structural).map(([name, entry]) => [name, entry.observed.length]))).toEqual({ 'flag-granularity': 7, 'internal-vocabulary': 4, 'target-divergence': 18, 'not-comparable': 21, 'matrix-unmapped': 5 });
    expect(Object.values(structural).reduce((sum, entry) => sum + entry.observed.length, 0)).toBe(55);
    // Resolved declarations now agree with their targets without default-conflict exemptions.
    expect(structural['target-divergence'].observed).not.toContain('working-memory-context-source');
    expect(structural['target-divergence'].observed).not.toContain('vtoken-bridge');
  });

  it('registers every TF-0631 ruling with reason, review condition, basis and section source', () => {
    expect(adjudication.schema).toBe(ADJUDICATION_SCHEMA);
    expect(adjudication.adjudicatedConflicts).toEqual([]);
    expect([...new Set(adjudication.exemptions.map((entry: Json) => entry.id))]).toEqual(['X-01', 'X-02', 'X-03', 'X-04', 'X-05']);
    expect([...new Set(adjudication.gaps.map((entry: Json) => entry.id))]).toEqual(['G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06']);
    expect(adjudication.conceptAliases.map((entry: Json) => entry.id)).toEqual(['I-4']);
    expect(adjudication.authorityBindings.map((entry: Json) => entry.id)).toEqual(['A-01', 'A-02', 'A-03']);
    expect(adjudication.exemptions.filter((entry: Json) => entry.id === 'X-03')).toHaveLength(18);
    expect(adjudication.exemptions.filter((entry: Json) => entry.id === 'X-04')).toHaveLength(21);
    for (const section of ['exemptions', 'adjudicatedConflicts', 'gaps', 'conceptAliases', 'authorityBindings']) {
      for (const entry of adjudication[section]) {
        expect(entry.basis, `${section} ${entry.id}`).toBe('explicit-adjudication');
        expect(entry.reason.trim().length, `${section} ${entry.id} reason`).toBeGreaterThan(0);
        expect(entry.reviewCondition.trim().length, `${section} ${entry.id} reviewCondition`).toBeGreaterThan(0);
        expect(entry.source, `${section} ${entry.id} source`).toMatch(new RegExp(`^${RECONCILIATION.replace(/[.]/g, '\\.')}#`));
        expect(RULES, `${section} ${entry.id} rule`).toContain(entry.rule);
      }
    }
    expect(adjudication.adjudicatedConflicts.every((entry: Json) => entry.disposition === 'registered-pending-fix')).toBe(true);
    expect(adjudication.exemptions.every((entry: Json) => entry.disposition === 'structural')).toBe(true);
    expect(adjudication.gaps.every((entry: Json) => entry.disposition === 'registered')).toBe(true);
    for (const entry of adjudication.exemptions) {
      expect(EXPECTED_STRUCTURAL[entry.class as keyof typeof EXPECTED_STRUCTURAL], `${entry.id} ${entry.target} class`).toBe(entry.id);
      expect(entry.targetKind, `${entry.id} ${entry.target} targetKind`).toBe(STRUCTURAL_CLASSES[entry.class].targetKind);
    }
    expect(JSON.stringify(adjudication)).not.toContain('C-01"');
  });

  it('does not compare targetDefaultMode with defaultMode, nor internal across tables, nor identity by id suffix (X-03, X-02, O-1)', () => {
    const linked = new Map<string, Json>();
    for (const entry of registries.dispositions) for (const id of entry.coverage?.authorityComponentIds ?? []) linked.set(id, entry);
    const divergent = registries.authority.components.filter((entry: Json) => linked.get(entry.id)!.targetDefaultMode !== entry.defaultMode).map((entry: Json) => entry.id);
    expect(divergent).toHaveLength(18);
    const internalCollisions = registries.authority.components.filter((entry: Json) => entry.defaultMode === 'internal' && linked.get(entry.id)!.disposition === 'default');
    expect(internalCollisions).toHaveLength(4);
    const suffixDrift = registries.authority.components.filter((entry: Json) => linked.get(entry.id)!.id.slice('component.'.length) !== entry.id);
    expect(suffixDrift).toHaveLength(9);
    expect(result.diagnostics).toEqual([]);
    expect(result.report.adjudicated.map((entry: Json) => entry.target)).not.toContain('dcs-context-authority');
  });
});

describe('semantic authority check: rules on mutated registries', () => {
  it('fails closed without an adjudication registry or with a wrong schema', () => {
    expect(rulesOf(evaluate(realRegistries(), null))).toEqual(['adjudication-missing']);
    expect(rulesOf(evaluate(realRegistries(), { schema: 'Other/v9' }))).toEqual(['adjudication-missing']);
  });

  it('passes both built-in validators through verbatim (registry-self-validation)', () => {
    const registries = cloneRegistries();
    registries.authority.validation = { ok: false, issues: [{ code: 'duplicate_authority', message: 'dup', path: 'k' }] };
    registries.dispositionValidation = { ok: false, issues: [{ code: 'unknown_coverage', message: 'component.x references unknown authorityComponentIds: ghost', path: 'ghost' }] };
    const result = evaluate(registries);
    expect(result.issues).toEqual(expect.arrayContaining([
      'shared/component-authority-manifest.ts: [semantic-authority/registry-self-validation] duplicate_authority: dup',
      'shared/dcs/component-disposition-catalog.ts: [semantic-authority/registry-self-validation] unknown_coverage: component.x references unknown authorityComponentIds: ghost',
    ]));
    registries.dispositionValidation = null;
    expect(evaluate(registries).issues).toContain('shared/dcs/component-disposition-catalog.ts: [semantic-authority/registry-self-validation] validateComponentDispositionManifest() produced no result; its coverage inputs could not be assembled');
  });

  it('derives owner through coverage and rejects a conflicting owner field or accountable node (owner-namespace, C-01)', () => {
    const registries = cloneRegistries();
    disposition(registries, 'component.task-ledger').owner = 'permission-approval-authority';
    expect(rulesOf(evaluate(registries))).toEqual(['owner-namespace']);
    const nodes = cloneRegistries();
    disposition(nodes, 'component.vtoken-context').owner = 'TF-0001';
    expect(rulesOf(evaluate(nodes))).toEqual(['owner-namespace']);
    const unknown = cloneRegistries();
    disposition(unknown, 'surface.inbox').owner = 'nobody';
    expect(rulesOf(evaluate(unknown))).toEqual(['owner-namespace', 'gap-registration']);
  });

  it('requires every component to be covered exactly once by a component.* entry (identity-key)', () => {
    const registries = cloneRegistries();
    disposition(registries, 'component.task-ledger').coverage.authorityComponentIds = ['ghost-component'];
    const result = evaluate(registries);
    expect(rulesOf(result)).toEqual(expect.arrayContaining(['identity-key', 'owner-namespace']));
    expect(result.issues.find((issue: string) => issue.includes('identity-key'))).toContain("component 'task-ledger' must be covered by exactly one disposition entry");
  });

  it('compares activation axis-wise (default-activation) and against flag risk (default-flag-risk)', () => {
    const registries = cloneRegistries();
    disposition(registries, 'component.dcs-context-tools').currentMode = 'shadow';
    expect(rulesOf(evaluate(registries))).toEqual(['default-activation']);
    const flags = cloneRegistries();
    flags.flags.find((flag: Json) => flag.id === 'context-view-tools').risk = 'baseline-on';
    component(flags, 'dcs-fact-view-and-tools').runtimeAvailabilitySource = 'DCS_PROD_FLAGS:context-view-tools';
    expect(rulesOf(evaluate(flags))).toEqual(['default-flag-risk']);
  });

  it('detects retired asymmetry (default-retirement) and pins the X-03 observation of the changed component', () => {
    const registries = cloneRegistries();
    component(registries, 'dcs-context-authority').defaultMode = 'retired';
    expect(rulesOf(evaluate(registries)).sort()).toEqual(['default-retirement', 'exemption-stale']);
  });

  it('judges default-matrix rows cited by runtimeAvailabilitySource (default-matrix-row) and fails closed on a missing row', () => {
    const registries = cloneRegistries();
    registries.docs.defaultMatrixRows.set('VToken assembly', 'true');
    const result = evaluate(registries);
    expect(rulesOf(result)).toEqual(['default-matrix-row']);
    expect(result.report.adjudicated.map((entry: Json) => entry.id)).not.toContain('C-04/R-D3');
    const missing = cloneRegistries();
    missing.docs.defaultMatrixRows.delete('VToken bridge');
    const missingResult = evaluate(missing);
    expect(rulesOf(missingResult)).toEqual(['default-matrix-row']);
    expect(missingResult.issues.some((issue: string) => issue.includes('[semantic-authority/default-matrix-row]') && issue.includes('has no bold-labelled row'))).toBe(true);
    expect(missingResult.report.adjudicated.map((entry: Json) => entry.id)).not.toContain('C-05/R-D3');
  });

  it('rejects a data type with two authority owners, a flipped binding and a second authority-class claim (authority-boundary)', () => {
    const registries = cloneRegistries();
    const projection = component(registries, 'browser-task-projection-owner');
    projection.ownedDataTypes = [...projection.ownedDataTypes, 'task.fact'];
    projection.allowedWrites = [...projection.allowedWrites, 'task.fact'];
    registries.authority.manifest.authorities.push({ dataType: 'task.fact', scope: 'task', operation: 'update', authorityComponentId: 'browser-task-projection-owner', notes: 'test' });
    expect(rulesOf(evaluate(registries))).toEqual(['authority-boundary', 'authority-boundary']);

    const flipped = cloneRegistries();
    flipped.relations.find((relation: Json) => relation.from === 'workboard').authorityBoundary = 'task-ledger-authority';
    const result = evaluate(flipped);
    expect(rulesOf(result)).toEqual(['authority-boundary', 'authority-boundary', 'authority-boundary', 'authority-boundary']);
    expect(result.issues[0]).toContain("binding A-02 requires 'one-way-reference'");

    const weakened = cloneRegistries();
    component(weakened, 'task-ledger').forbiddenActions = component(weakened, 'task-ledger').forbiddenActions.filter((action: string) => action !== 'own-runtime-scheduler');
    expect(evaluate(weakened).issues).toEqual(["shared/component-authority-manifest.ts: [semantic-authority/authority-boundary] component 'task-ledger' no longer satisfies binding A-02: forbiddenActions lacks own-runtime-scheduler"]);
  });

  it('reconciles observed gaps with registered gaps in both directions (gap-registration)', () => {
    const registry = cloneAdjudication();
    registry.gaps = registry.gaps.filter((entry: Json) => !(entry.class === 'concept-without-component' && entry.target === 'chat'));
    expect(evaluate(realRegistries(), registry).issues).toEqual([`${ADJUDICATION_PATH}: [semantic-authority/gap-registration] gap-unregistered: concept-without-component 'chat' is observed in the registries but not registered as a gap`]);
    const stale = cloneAdjudication();
    stale.gaps.push({ ...stale.gaps[0], target: 'task-ledger', class: 'concept-without-component' });
    expect(evaluate(realRegistries(), stale).issues).toEqual([`${ADJUDICATION_PATH}: [semantic-authority/gap-registration] gap-stale: G-01 registers concept-without-component 'task-ledger' but the gap is no longer observed; remove or re-adjudicate it`]);
  });

  it('makes structural exemptions load-bearing: an empty or missing exemptions list fails per observed pair (exemption-registration, TF-0638)', () => {
    const empty = cloneAdjudication();
    empty.exemptions = [];
    const emptyResult = evaluate(realRegistries(), empty);
    expect(rulesOf(emptyResult)).toEqual(new Array(55).fill('exemption-registration'));
    expect(emptyResult.issues.every((issue: string) => issue.includes('structural-unregistered:'))).toBe(true);
    expect(emptyResult.report.structural['not-comparable'].registered).toEqual([]);
    expect(emptyResult.report.structural['not-comparable'].observed).toHaveLength(21);
    const absent = cloneAdjudication();
    delete absent.exemptions;
    expect(rulesOf(evaluate(realRegistries(), absent))).toHaveLength(55);
    const missingOne = cloneAdjudication();
    missingOne.exemptions = missingOne.exemptions.filter((entry: Json) => !(entry.class === 'not-comparable' && entry.target === 'context-runtime-kit'));
    expect(evaluate(realRegistries(), missingOne).issues).toEqual([`${ADJUDICATION_PATH}: [semantic-authority/exemption-registration] structural-unregistered: not-comparable component 'context-runtime-kit' is observed in the registries but no structural exemption (X-04) registers it; register it with a reason or resolve it`]);
  });

  it('reports a structural entry whose pair is no longer observed as stale, once (exemption-registration / exemption-stale, TF-0638)', () => {
    // dcs-context-authority is comparable (baseline / baseline): an X-04 entry for it is registered but never observed.
    const phantom = cloneAdjudication();
    const template = phantom.exemptions.find((entry: Json) => entry.class === 'not-comparable');
    phantom.exemptions.push({ ...template, target: 'dcs-context-authority', observed: { defaultMode: 'baseline', dispositionId: 'component.dcs-context-authority', currentMode: 'baseline' } });
    expect(evaluate(realRegistries(), phantom).issues).toEqual([`${ADJUDICATION_PATH}: [semantic-authority/exemption-registration] structural-stale: X-04 registers not-comparable component 'dcs-context-authority' but it is no longer observed; remove or re-adjudicate the entry`]);
    // A recorded-value change is exemption-stale alone: the entry is not re-reported as structural-stale
    // even though the pair leaves the X-04 observed set (target kept equal so X-03 is not entered).
    const changed = cloneRegistries();
    component(changed, 'context-runtime-kit').defaultMode = 'baseline';
    disposition(changed, 'component.context-runtime-kit').targetDefaultMode = 'baseline';
    const changedResult = evaluate(changed);
    expect(rulesOf(changedResult)).toEqual(['exemption-stale']);
    expect(changedResult.issues[0]).toContain('X-04 (default-activation, context-runtime-kit) recorded defaultMode="internal"');
    expect(changedResult.report.structural['not-comparable'].observed).not.toContain('context-runtime-kit');
    expect(changedResult.report.structural['target-divergence'].observed).not.toContain('context-runtime-kit');
    // An invalid entry is diagnosed by its own rule and still counts as registered: no second diagnostic.
    const invalid = cloneAdjudication();
    invalid.exemptions.find((entry: Json) => entry.class === 'not-comparable').reason = ' ';
    expect(rulesOf(evaluate(realRegistries(), invalid))).toEqual(['exemption-reason-missing']);
  });

  it('requires every structural entry to carry a known class matching its target kind (exemption-unknown-rule, TF-0638)', () => {
    const noClass = cloneAdjudication();
    delete noClass.exemptions[0].class;
    const noClassResult = evaluate(realRegistries(), noClass);
    expect(rulesOf(noClassResult)).toEqual(['exemption-unknown-rule', 'exemption-registration']);
    expect(noClassResult.issues[0]).toContain('names class undefined, which is not a structural exemption class');
    expect(noClassResult.issues[1]).toContain(`structural-unregistered: flag-granularity flag '${noClass.exemptions[0].target}'`);
    const wrongKind = cloneAdjudication();
    wrongKind.exemptions[0].class = 'not-comparable';
    const wrongKindResult = evaluate(realRegistries(), wrongKind);
    expect(rulesOf(wrongKindResult)).toEqual(['exemption-unknown-rule', 'exemption-registration']);
    expect(wrongKindResult.issues[0]).toContain("of class 'not-comparable' must target a component (got targetKind \"flag\")");
  });

  it('turns new not-comparable, flag-granularity and matrix-unmapped observations into failures instead of report entries (TF-0638)', () => {
    const mixed = cloneRegistries();
    disposition(mixed, 'component.dcs-context-authority').currentMode = 'mixed';
    const mixedResult = evaluate(mixed);
    expect(mixedResult.issues).toEqual([`${ADJUDICATION_PATH}: [semantic-authority/exemption-registration] structural-unregistered: not-comparable component 'dcs-context-authority' is observed in the registries but no structural exemption (X-04) registers it; register it with a reason or resolve it`]);
    expect(mixedResult.report.notComparable).toContain('dcs-context-authority');
    const granular = cloneRegistries();
    disposition(granular, 'component.working-memory-context').coverage.dcsFlagIds = [];
    disposition(granular, 'feature.patch-flow').coverage.dcsFlagIds = ['patch-flow', 'working-memory'];
    const granularResult = evaluate(granular);
    expect(rulesOf(granularResult)).toEqual(['exemption-registration']);
    expect(granularResult.report.flagGranularity).toContain('working-memory');
    const unmapped = cloneRegistries();
    unmapped.docs.defaultMatrixRows.set('working-memory', 'auto');
    const unmappedResult = evaluate(unmapped);
    expect(rulesOf(unmappedResult)).toEqual(['exemption-registration']);
    expect(unmappedResult.issues[0]).toContain("structural-unregistered: matrix-unmapped doc-row 'working-memory'");
  });

  it('carries line numbers on every registry-path diagnostic when the registry text is supplied (TF-0638)', () => {
    const text = read(ADJUDICATION_PATH);
    const lines = text.split(/\r?\n/);
    const registry = cloneAdjudication();
    registry.gaps = registry.gaps.filter((entry: Json) => !(entry.class === 'concept-without-component' && entry.target === 'chat'));
    registry.exemptions.find((entry: Json) => entry.class === 'target-divergence' && entry.target === 'task-ledger').reason = ' ';
    const result = evaluateSemanticAuthority(realRegistries(), registry, { adjudicationText: text });
    expect(rulesOf(result).sort()).toEqual(['exemption-reason-missing', 'gap-registration']);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.file).toBe(ADJUDICATION_PATH);
      expect(diagnostic.line, diagnostic.message).toBeGreaterThan(0);
    }
    const reason = result.diagnostics.find((diagnostic: Json) => diagnostic.rule === 'exemption-reason-missing');
    expect(lines[reason.line - 1]).toContain('"id": "X-03"');
    expect(lines.slice(reason.line, reason.line + 6).some((line) => line.includes('"target": "task-ledger"'))).toBe(true);
    const gap = result.diagnostics.find((diagnostic: Json) => diagnostic.rule === 'gap-registration');
    expect(lines[gap.line - 1]).toMatch(/^ {2}"gaps":/);
    expect(result.issues[0]).toMatch(new RegExp(`^${ADJUDICATION_PATH.replace(/[.]/g, '\\.')}:\\d+: \\[semantic-authority/`));
  });

  it('locates data-type authority conflicts on a manifest row, falling back across owners when the second owner has no row in the text (authority-boundary, TF-0638)', () => {
    const text = read(REGISTRY_PATHS.authority);
    const lines = text.split(/\r?\n/);
    const registries = cloneRegistries();
    const projection = component(registries, 'browser-task-projection-owner');
    projection.ownedDataTypes = [...projection.ownedDataTypes, 'task.fact'];
    projection.allowedWrites = [...projection.allowedWrites, 'task.fact'];
    registries.authority.manifest.authorities.push({ dataType: 'task.fact', scope: 'task', operation: 'update', authorityComponentId: 'browser-task-projection-owner', notes: 'test' });
    const result = evaluateSemanticAuthority(registries, adjudication, { sourceTexts: { authority: text } });
    expect(rulesOf(result)).toEqual(['authority-boundary', 'authority-boundary']);
    const [owners, declared] = result.diagnostics;
    // The in-memory row is absent from the text, so the diagnostic falls back to task-ledger's task.fact row.
    expect(owners.message).toContain("data type 'task.fact' has 2 authority owners: task-ledger, browser-task-projection-owner");
    expect(lines[owners.line - 1]).toContain("dataType: 'task.fact'");
    expect(lines[owners.line - 1]).toContain("authorityComponentId: 'task-ledger'");
    expect(declared.message).toContain('is listed in ownedDataTypes of 2 components: task-ledger, browser-task-projection-owner');
    expect(lines[declared.line - 1]).toContain('ownedDataTypes');
    expect(lines[declared.line - 1]).toContain("'task.fact'");
  });

  it('resolves concepts through registered aliases only (concept-alias)', () => {
    const registry = cloneAdjudication();
    registry.conceptAliases = [];
    expect(evaluate(realRegistries(), registry).issues).toEqual([`${ADJUDICATION_PATH}: [semantic-authority/gap-registration] gap-unregistered: concept-without-component 'routing-memo' is observed in the registries but not registered as a gap`]);
    const unknownComponent = cloneAdjudication();
    unknownComponent.conceptAliases[0].componentId = 'ghost';
    expect(rulesOf(evaluate(realRegistries(), unknownComponent))).toEqual(['exemption-unknown-target', 'gap-registration']);
    const redundant = cloneAdjudication();
    redundant.conceptAliases.push({ ...redundant.conceptAliases[0], id: 'I-X', conceptId: 'task-ledger', componentId: 'task-ledger' });
    expect(rulesOf(evaluate(realRegistries(), redundant))).toEqual(['concept-alias']);
  });

  it('treats an entry without reason, review condition, source or basis as a failure and does not apply it (exemption-reason-missing)', () => {
    for (const field of ['reason', 'reviewCondition', 'source', 'basis']) {
      const registry = cloneAdjudication();
      const entry = pendingConflict();
      registry.adjudicatedConflicts = [entry];
      entry[field] = ' ';
      const baseline = cloneRegistries();
      component(baseline, 'working-memory-context-source').defaultMode = 'opt-in';
      const result = evaluate(baseline, registry);
      expect(rulesOf(result), field).toEqual(['exemption-reason-missing', 'default-activation', 'default-flag-risk', 'exemption-registration']);
      expect(result.issues[0]).toContain(`has no ${field}`);
    }
    const wrongSource = cloneAdjudication();
    wrongSource.exemptions[0].source = 'docs/elsewhere.md#x';
    expect(rulesOf(evaluate(realRegistries(), wrongSource))).toEqual(['exemption-reason-missing']);
  });

  it('rejects unknown rules and targets and duplicate entries (exemption-unknown-rule / exemption-unknown-target)', () => {
    const rule = cloneAdjudication();
    rule.exemptions[0].rule = 'not-a-rule';
    expect(rulesOf(evaluate(realRegistries(), rule))).toEqual(['exemption-unknown-rule']);
    const meta = cloneAdjudication();
    meta.exemptions[0].rule = 'exemption-stale';
    expect(rulesOf(evaluate(realRegistries(), meta))).toEqual(['exemption-unknown-rule']);
    const target = cloneAdjudication();
    target.adjudicatedConflicts = [{ ...pendingConflict(), target: 'ghost' }];
    const result = evaluate(realRegistries(), target);
    expect(rulesOf(result)).toEqual(['exemption-unknown-target']);
    const duplicate = cloneAdjudication();
    duplicate.gaps.push({ ...duplicate.gaps[0] });
    expect(rulesOf(evaluate(realRegistries(), duplicate))).toEqual(['exemption-unknown-target']);
    const badClass = cloneAdjudication();
    badClass.gaps[0].class = 'no-such-class';
    expect(rulesOf(evaluate(realRegistries(), badClass))).toEqual(['exemption-unknown-rule', 'gap-registration']);
  });

  it('marks entries stale when a recorded value changes or the covered conflict disappears (exemption-stale)', () => {
    const fixed = cloneRegistries();
    component(fixed, 'working-memory-context-source').defaultMode = 'baseline';
    const obsolete = cloneAdjudication();
    obsolete.adjudicatedConflicts = [pendingConflict()];
    const result = evaluate(fixed, obsolete);
    expect(rulesOf(result)).toEqual(['exemption-stale']);
    expect(result.issues[0]).toContain('C-02/R-D1 (default-activation, working-memory-context-source) recorded defaultMode="opt-in" but the registries now say "baseline"');
    const noObserved = cloneAdjudication();
    delete noObserved.exemptions[0].observed;
    expect(rulesOf(evaluate(realRegistries(), noObserved))).toEqual(['exemption-stale']);
    const phantom = cloneAdjudication();
    phantom.adjudicatedConflicts.push({ ...pendingConflict(), id: 'C-X', target: 'context-runtime-kit', observed: { defaultMode: 'internal' } });
    const phantomResult = evaluate(realRegistries(), phantom);
    expect(rulesOf(phantomResult)).toEqual(['exemption-stale']);
    expect(phantomResult.issues[0]).toContain('no such diagnostic fires');
  });

  it('checks flag three-way binding and owner agreement at flag granularity (flag-binding)', () => {
    const registries = cloneRegistries();
    disposition(registries, 'feature.coding-recovery').owner = 'renderer-ui-surface';
    const result = evaluate(registries);
    expect(rulesOf(result)).toEqual(['flag-binding']);
    expect(result.issues[0]).toContain("DCS flag 'write-journal' is bound to component 'coding-execution-backend'");
    const activation = cloneRegistries();
    disposition(activation, 'feature.coding-recovery').currentMode = 'opt-in';
    expect(rulesOf(evaluate(activation))).toEqual(['flag-binding']);
    const unbound = cloneRegistries();
    disposition(unbound, 'feature.coding-recovery').coverage.dcsFlagIds = [];
    expect(rulesOf(evaluate(unbound))).toEqual(expect.arrayContaining(['flag-binding']));
  });
});

describe('semantic authority check: real gate entry (node scripts/check-semantic-authority.mjs)', () => {
  const fixtures = readdirSync(path.join(ROOT, FIXTURE_DIR)).filter((name) => name.endsWith('.json')).sort();
  const brokenFixtures = readdirSync(path.join(ROOT, FIXTURE_DIR, 'broken')).filter((name) => name.endsWith('.json')).sort();
  const reportDir = mkdtempSync(path.join(tmpdir(), 'semantic-authority-'));
  afterAll(() => rmSync(reportDir, { recursive: true, force: true }));

  it('passes on the current repository and writes a complete report', async () => {
    const reportPath = path.join(reportDir, 'positive.json');
    const result = await runGate(['--report', reportPath, '--actor', 'vitest']);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const [verdict, summary] = result.stdout.trim().split(/\r?\n/);
    expect(verdict).toBe('Semantic authority check passed.');
    expect(summary).toContain('components=35 authorities=44 dispositions=54 claims=45 reliability=7 sensitive=7 concepts=7 relations=6 flags=22');
    expect(summary).toContain(`rules=${RULES.length} diagnostics=0 adjudicated=0 structural=55/55 gaps=35/35 aliases=1 bindings=3 not-comparable=21 matrix-unmapped=5`);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.schema).toBe(REPORT_SCHEMA);
    expect(report.actor).toBe('vitest');
    expect(report.drivenBy).toBe('agent');
    expect(report.exitCode).toBe(0);
    expect(report.command[0]).toBe('node');
    expect(report.candidate.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.candidate.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof report.candidate.dirty).toBe('boolean');
    expect(report.counts.components).toBe(35);
    expect(report.rulesEvaluated).toEqual(EXPECTED_RULES);
    expect(report.diagnostics).toEqual([]);
    expect(report.adjudicated).toHaveLength(0);
    expect(report.fixtures).toEqual([]);
    for (const [name, ruling] of Object.entries(EXPECTED_STRUCTURAL)) {
      expect(report.structural[name].ruling, name).toBe(ruling);
      expect(report.structural[name].observed, name).toEqual(report.structural[name].registered);
    }
  }, 60_000);

  it('ships every contract negative class as a checked-in fixture whose rule exists, with id-anchored mutations', () => {
    const parsed = fixtures.map((name) => JSON.parse(read(`${FIXTURE_DIR}/${name}`)));
    const classes = new Set(parsed.map((fixture) => fixture.class));
    for (const negativeClass of CONTRACT_NEGATIVE_CLASSES) expect(classes.has(negativeClass), negativeClass).toBe(true);
    expect(classes.has('structural-reconciliation')).toBe(true);
    expect(parsed.filter((fixture) => fixture.rule === 'exemption-registration').length).toBeGreaterThanOrEqual(5);
    expect(parsed.some((fixture) => fixture.id === 'authority-duplicate-row' && fixture.rule === 'registry-self-validation')).toBe(true);
    for (const fixture of parsed) {
      expect(fixture.schema).toBe('ContractCheckFixture/v1');
      expect(RULES, fixture.id).toContain(fixture.rule);
      expect(fixture.expect).toContain(`[${DIAGNOSTIC_FAMILY}/${fixture.rule}]`);
      expect(fixture.expectIssueCount).toBeGreaterThan(0);
      for (const mutation of fixture.mutations) {
        expect(typeof mutation.find === 'string' || typeof mutation.append === 'string', fixture.id).toBe(true);
        if (typeof mutation.find === 'string') {
          // Anchor discipline (TF-0638): the find names the mutated entry's id literal and hits once.
          expect(typeof mutation.anchor, `${fixture.id} anchor`).toBe('string');
          expect(mutation.find, `${fixture.id} find contains anchor`).toContain(mutation.anchor);
          const text = read(mutation.file).replace(/\r\n/g, '\n');
          expect(text.split(mutation.find.replace(/\r\n/g, '\n')).length, `${fixture.id} find is unique in ${mutation.file}`).toBe(2);
        }
      }
    }
  });

  it.each(fixtures)('rejects fixture %s through the real entry with the exact locatable diagnostic set', async (name) => {
    const fixture = JSON.parse(read(`${FIXTURE_DIR}/${name}`));
    const reportPath = path.join(reportDir, `${fixture.id}.json`);
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/${name}`, '--report', reportPath]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Semantic authority fixtures applied: ${fixture.id}`);
    expect(result.stderr).toContain('Semantic authority check failed:');
    const issues = result.stderr.split(/\r?\n/).filter((line) => line.startsWith('- '));
    expect(issues, issues.join('\n')).toHaveLength(fixture.expectIssueCount);
    expect(issues.some((issue) => issue.includes(fixture.expect)), issues.join('\n')).toBe(true);
    for (const issue of issues) {
      const match = /^- ([^:\s]+(?::\d+)?): \[semantic-authority\/([a-z-]+)\] /.exec(issue);
      expect(match, issue).not.toBeNull();
      expect(RULES).toContain(match![2]);
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.exitCode).toBe(1);
    expect(report.fixtures).toEqual([fixture.id]);
    expect(report.diagnostics).toHaveLength(fixture.expectIssueCount);
    expect(report.diagnostics.map((diagnostic: Json) => diagnostic.rule)).toContain(fixture.rule);
  }, 60_000);

  it('fails closed when the adjudication registry is missing (exit 1, adjudication-missing)', async () => {
    const result = await runGate(['--adjudication', `${FIXTURE_DIR}/does-not-exist.json`]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`${FIXTURE_DIR}/does-not-exist.json: [semantic-authority/adjudication-missing]`);
  }, 60_000);

  it('locates every registry-path diagnostic on the entry id line through the real entry (TF-0638)', async () => {
    // Locate diagnostics against the explicit injected obsolete entries, not the current empty list.
    const staleFixture = JSON.parse(read(`${FIXTURE_DIR}/exemption-stale.json`));
    const registryLines = read(ADJUDICATION_PATH).replace(/\r?\n/g, '\n')
      .replace(staleFixture.mutations[0].find, staleFixture.mutations[0].replace).split('\n');
    const reportPath = path.join(reportDir, 'located-stale.json');
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/exemption-stale.json`, '--report', reportPath]);
    expect(result.code).toBe(1);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.diagnostics).toHaveLength(2);
    for (const diagnostic of report.diagnostics) {
      expect(diagnostic.file).toBe(ADJUDICATION_PATH);
      expect(diagnostic.line).toBeGreaterThan(0);
      expect(registryLines[diagnostic.line - 1]).toContain(`"id": "${diagnostic.target}"`);
      expect(result.stderr).toContain(`- ${ADJUDICATION_PATH}:${diagnostic.line}: [semantic-authority/exemption-stale]`);
    }
    // A mutated registry is located against the mutated text: the removed X-04 entry is reported at the exemptions section key.
    const missingPath = path.join(reportDir, 'located-missing.json');
    const missingFixture = JSON.parse(read(`${FIXTURE_DIR}/structural-exemption-missing.json`));
    const mutatedLines = read(ADJUDICATION_PATH).replace(/\r\n/g, '\n').replace(missingFixture.mutations[0].find, '').split('\n');
    const missing = await runGate(['--fixture', `${FIXTURE_DIR}/structural-exemption-missing.json`, '--report', missingPath]);
    expect(missing.code).toBe(1);
    const [unregistered] = JSON.parse(readFileSync(missingPath, 'utf8')).diagnostics;
    expect(unregistered.rule).toBe('exemption-registration');
    expect(mutatedLines[unregistered.line - 1]).toMatch(/^ {2}"exemptions":/);
  }, 120_000);

  it('ends a duplicate authority row as a located registry-self-validation diagnostic, not a load failure (TF-0638)', async () => {
    const reportPath = path.join(reportDir, 'duplicate-row.json');
    const fixture = JSON.parse(read(`${FIXTURE_DIR}/authority-duplicate-row.json`));
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/authority-duplicate-row.json`, '--report', reportPath]);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain('Semantic authority load error');
    expect(result.stderr).not.toContain('registry-load-failed');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.diagnostics).toHaveLength(1);
    const [diagnostic] = report.diagnostics;
    expect(diagnostic.rule).toBe('registry-self-validation');
    expect(diagnostic.file).toBe(REGISTRY_PATHS.authority);
    expect(diagnostic.message).toBe('duplicate_authority: Duplicate authority for vtoken.bridge-runtime::global::update: vtoken-bridge / vtoken-bridge');
    // The line points at the duplicated row in the mutated manifest text (the second occurrence of the triple).
    const mutated = read(REGISTRY_PATHS.authority).replace(/\r\n/g, '\n').replace(fixture.mutations[0].find, fixture.mutations[0].replace).split('\n');
    expect(mutated[diagnostic.line - 1]).toContain("dataType: 'vtoken.bridge-runtime', scope: 'global', operation: 'update'");
    expect(mutated.slice(0, diagnostic.line - 1).filter((line) => line.includes("dataType: 'vtoken.bridge-runtime'"))).toHaveLength(1);
    // The manifest on disk still asserts itself at import time; the gate never edits it.
    expect(AUTHORITY_IMPORT_ASSERTION.test(read(REGISTRY_PATHS.authority))).toBe(true);
  }, 60_000);

  it('rejects fixtures that break the anchor discipline with a specific reason (exit 2, TF-0638)', async () => {
    const missing = await runGate(['--fixture', `${FIXTURE_DIR}/broken/anchor-missing.json`]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('declares no anchor');
    const notInFind = await runGate(['--fixture', `${FIXTURE_DIR}/broken/anchor-not-in-find.json`]);
    expect(notInFind.code).toBe(2);
    expect(notInFind.stderr).toContain('does not contain its anchor');
    const ambiguous = await runGate(['--fixture', `${FIXTURE_DIR}/broken/anchor-ambiguous.json`]);
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.stderr).toContain('is ambiguous in scripts/check-semantic-authority-adjudication.json (18 occurrences');
  }, 60_000);

  it('locates data-type authority conflicts on the second declaration of the mutated manifest through the real entry (TF-0638)', async () => {
    const reportPath = path.join(reportDir, 'multi-owner-lines.json');
    const fixture = JSON.parse(read(`${FIXTURE_DIR}/authority-data-type-multi-owner.json`));
    let mutated = read(REGISTRY_PATHS.authority).replace(/\r\n/g, '\n');
    for (const mutation of fixture.mutations) mutated = mutated.replace(mutation.find, mutation.replace);
    const lines = mutated.split('\n');
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/authority-data-type-multi-owner.json`, '--report', reportPath]);
    expect(result.code).toBe(1);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.diagnostics.map((diagnostic: Json) => diagnostic.rule)).toEqual(['authority-boundary', 'authority-boundary']);
    const [owners, declared] = report.diagnostics;
    expect(owners.message).toBe("data type 'task.fact' has 2 authority owners: browser-task-projection-owner, task-ledger");
    expect(lines[owners.line - 1]).toContain("dataType: 'task.fact'");
    expect(lines[owners.line - 1]).toContain("authorityComponentId: 'task-ledger'");
    expect(declared.message).toBe("data type 'task.fact' is listed in ownedDataTypes of 2 components: task-ledger, browser-task-projection-owner");
    expect(lines[declared.line - 1]).toBe("    ownedDataTypes: ['browser.task-projection', 'task.fact'],");
    for (const issue of result.stderr.split(/\r?\n/).filter((line) => line.startsWith('- '))) {
      expect(issue).toMatch(/^- shared\/component-authority-manifest\.ts:\d+: \[semantic-authority\/authority-boundary\] /);
    }
  }, 60_000);

  it.each(brokenFixtures)('distinguishes broken fixture %s (exit 2) from a gate failure (exit 1)', async (name) => {
    const result = await runGate(['--fixture', `${FIXTURE_DIR}/broken/${name}`]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Semantic authority fixture error:');
    expect(result.stderr).not.toContain('Semantic authority check failed:');
  }, 60_000);

  it('reports a missing fixture file and an unknown argument as exit 2', async () => {
    const missing = await runGate(['--fixture', `${FIXTURE_DIR}/does-not-exist.json`]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Semantic authority fixture error:');
    const unknown = await runGate(['--nope']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown argument: --nope');
  }, 60_000);

  it('does not touch the working tree when fixtures run', async () => {
    const before = (await execFileAsync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })).stdout;
    await runGate(['--fixture', `${FIXTURE_DIR}/${fixtures[0]}`]);
    const after = (await execFileAsync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })).stdout;
    expect(after).toBe(before);
    expect(relationKey({ from: 'a', kind: 'b', to: 'c' })).toBe('a--b--c');
  }, 60_000);
});
