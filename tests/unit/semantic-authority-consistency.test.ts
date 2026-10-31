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
  DIAGNOSTIC_FAMILY,
  INPUT_PATHS,
  REPORT_SCHEMA,
  RULES,
  assembleRegistries,
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
  'exemption-reason-missing',
  'exemption-stale',
  'exemption-unknown-rule',
  'exemption-unknown-target',
  'adjudication-missing',
  'registry-load-failed',
];
// The five negative classes the task contract requires.
const CONTRACT_NEGATIVE_CLASSES = ['conflicting-owner', 'conflicting-default', 'conflicting-authority', 'missing-component', 'exemption-without-reason'];

// The checker ships an `any`-typed .d.mts surface (same convention as contract-check.d.mts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const adjudication: Json = JSON.parse(read(ADJUDICATION_PATH));

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
});

describe('semantic authority check: current registries with the TF-0631 rulings registered', () => {
  const registries = realRegistries();
  const result = evaluate(registries);

  it('passes with the expected counts and every rule evaluated', () => {
    expect(result.issues).toEqual([]);
    expect(result.report.counts).toEqual({ components: 35, authorities: 44, dispositions: 54, claims: 45, reliability: 7, sensitive: 7, concepts: 7, relations: 6, flags: 22 });
    expect(result.report.rulesEvaluated).toEqual(EXPECTED_RULES);
    expect(result.report.adjudicated.map((entry: Json) => `${entry.id} ${entry.target}`).sort()).toEqual([
      'C-02/R-D1 working-memory-context-source',
      'C-02/R-D4 working-memory-context-source',
      'C-03/R-D1 tool-registry-context-source',
      'C-03/R-D4 tool-registry-context-source',
      'C-04/R-D2 vtoken-context-source',
      'C-04/R-D3 vtoken-context-source',
      'C-05/R-D3 vtoken-bridge',
      'C-06/R-D2 retired-surface-registry',
    ]);
    expect(result.report.notComparable).toHaveLength(20);
    expect(result.report.matrixUnmapped).toHaveLength(5);
    expect(result.report.flagGranularity).toEqual(['isolation-request', 'patch-flow', 'stale-write-guard', 'symbol-lease', 'symbol-lease-mode', 'worktree-backend', 'write-journal']);
    const gapTotals = Object.values(result.report.gaps as Record<string, { observed: string[]; registered: string[] }>);
    expect(gapTotals.reduce((sum, gap) => sum + gap.observed.length, 0)).toBe(35);
    expect(gapTotals.every((gap) => gap.observed.join() === gap.registered.join())).toBe(true);
    expect(result.report.exemptions).toEqual({ structural: 54, registeredPendingFix: 8, gaps: 35, conceptAliases: 1, authorityBindings: 3, invalid: 0 });
    expect(result.report.exemptionsApplied).toEqual({ 'X-01': 7, 'X-02': 4, 'X-03': 18, 'X-04': 20, 'X-05': 5 });
    expect(result.report.adjudicatedConflicts).toEqual({ rulings: 5, entries: 8, byRuling: { 'C-02': 2, 'C-03': 2, 'C-04': 2, 'C-05': 1, 'C-06': 1 } });
    expect(result.report.gapsRegistered).toEqual({ total: 35, byRuling: { 'G-01': 1, 'G-02': 1, 'G-03': 5, 'G-04': 16, 'G-05': 5, 'G-06': 7 } });
    expect(result.report.conceptAliases).toEqual(['routing-memo -> routing-memo-observation']);
    expect(result.report.authorityBindings).toEqual(['task-loop--roots-in--task-ledger', 'workboard--references-one-way--task-ledger', 'routing-memo--quality-gated-by--task-loop']);
  });

  it('registers every TF-0631 ruling with reason, review condition, basis and section source', () => {
    expect(adjudication.schema).toBe(ADJUDICATION_SCHEMA);
    expect([...new Set(adjudication.adjudicatedConflicts.map((entry: Json) => entry.id.split('/')[0]))]).toEqual(['C-02', 'C-03', 'C-04', 'C-05', 'C-06']);
    expect([...new Set(adjudication.exemptions.map((entry: Json) => entry.id))]).toEqual(['X-01', 'X-02', 'X-03', 'X-04', 'X-05']);
    expect([...new Set(adjudication.gaps.map((entry: Json) => entry.id))]).toEqual(['G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06']);
    expect(adjudication.conceptAliases.map((entry: Json) => entry.id)).toEqual(['I-4']);
    expect(adjudication.authorityBindings.map((entry: Json) => entry.id)).toEqual(['A-01', 'A-02', 'A-03']);
    expect(adjudication.exemptions.filter((entry: Json) => entry.id === 'X-03')).toHaveLength(18);
    expect(adjudication.exemptions.filter((entry: Json) => entry.id === 'X-04')).toHaveLength(20);
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
    expect(JSON.stringify(adjudication)).not.toContain('C-01"');
  });

  it('does not compare targetDefaultMode with defaultMode, nor internal across tables, nor identity by id suffix (X-03, X-02, O-1)', () => {
    const linked = new Map<string, Json>();
    for (const entry of registries.dispositions) for (const id of entry.coverage?.authorityComponentIds ?? []) linked.set(id, entry);
    const divergent = registries.authority.components.filter((entry: Json) => linked.get(entry.id)!.targetDefaultMode !== entry.defaultMode).map((entry: Json) => entry.id);
    expect(divergent).toHaveLength(22);
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
    expect(rulesOf(result).sort()).toEqual(['default-matrix-row', 'exemption-stale']);
    expect(result.report.adjudicated.map((entry: Json) => entry.id)).not.toContain('C-04/R-D3');
    const missing = cloneRegistries();
    missing.docs.defaultMatrixRows.delete('VToken bridge');
    const missingResult = evaluate(missing);
    expect(rulesOf(missingResult).sort()).toEqual(['default-matrix-row', 'exemption-stale', 'exemption-stale']);
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
      const entry = registry.adjudicatedConflicts.find((candidate: Json) => candidate.id === 'C-06/R-D2');
      entry[field] = ' ';
      const result = evaluate(realRegistries(), registry);
      expect(rulesOf(result), field).toEqual(['exemption-reason-missing', 'default-retirement']);
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
    target.adjudicatedConflicts[0].target = 'ghost';
    const result = evaluate(realRegistries(), target);
    expect(rulesOf(result)).toEqual(['exemption-unknown-target', 'default-activation']);
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
    const result = evaluate(fixed);
    expect(rulesOf(result)).toEqual(['exemption-stale', 'exemption-stale']);
    expect(result.issues[0]).toContain('C-02/R-D1 (default-activation, working-memory-context-source) recorded defaultMode="opt-in" but the registries now say "baseline"');
    const noObserved = cloneAdjudication();
    delete noObserved.exemptions[0].observed;
    expect(rulesOf(evaluate(realRegistries(), noObserved))).toEqual(['exemption-stale']);
    const phantom = cloneAdjudication();
    phantom.adjudicatedConflicts.push({ ...phantom.adjudicatedConflicts[0], id: 'C-X', target: 'context-runtime-kit', observed: { defaultMode: 'internal' } });
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
    expect(summary).toContain(`rules=${RULES.length} diagnostics=0 adjudicated=8 structural=54 gaps=35/35 aliases=1 bindings=3 not-comparable=20 matrix-unmapped=5`);
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
    expect(report.adjudicated).toHaveLength(8);
    expect(report.fixtures).toEqual([]);
  }, 60_000);

  it('ships every contract negative class as a checked-in fixture whose rule exists', () => {
    const parsed = fixtures.map((name) => JSON.parse(read(`${FIXTURE_DIR}/${name}`)));
    const classes = new Set(parsed.map((fixture) => fixture.class));
    for (const negativeClass of CONTRACT_NEGATIVE_CLASSES) expect(classes.has(negativeClass), negativeClass).toBe(true);
    for (const fixture of parsed) {
      expect(fixture.schema).toBe('ContractCheckFixture/v1');
      expect(RULES, fixture.id).toContain(fixture.rule);
      expect(fixture.expect).toContain(`[${DIAGNOSTIC_FAMILY}/${fixture.rule}]`);
      expect(fixture.expectIssueCount).toBeGreaterThan(0);
      for (const mutation of fixture.mutations) expect(typeof mutation.find === 'string' || typeof mutation.append === 'string', fixture.id).toBe(true);
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
