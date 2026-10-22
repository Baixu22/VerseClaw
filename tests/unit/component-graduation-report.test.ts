// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COMPONENT_AUTHORITY_MANIFEST } from '../../shared/component-authority-manifest';
import {
  COMPONENT_GRADUATION_REPORT_SCHEMA,
  createAllComponentGraduationReportScaffolds,
  evaluateDefaultChangeGate,
  evaluateTaskForestDoneGate,
  validateComponentGraduationReport,
  type ComponentGraduationReport,
} from '../../shared/component-graduation-report';
import { createDiskArtifactResolver, runComponentGraduationGate } from '../../scripts/component-graduation-report.mts';

const root = process.cwd();
const fixtureDir = 'harness/specs/fixtures/component-graduation-report';
const expectedContext = JSON.parse(fs.readFileSync(path.join(root, fixtureDir, 'expected-context.json'), 'utf8'));

function readReport(name: string): ComponentGraduationReport {
  return JSON.parse(fs.readFileSync(path.join(root, fixtureDir, name), 'utf8')) as ComponentGraduationReport;
}

function validate(report: ComponentGraduationReport, overrides: { resolver?: ReturnType<typeof createDiskArtifactResolver>; expected?: Record<string, string> } = {}) {
  return validateComponentGraduationReport(report, {
    expected: { ...expectedContext, ...(overrides.expected ?? {}) },
    artifactResolver: overrides.resolver ?? createDiskArtifactResolver(root),
    now: '2026-10-21T00:00:00.000Z',
  });
}

function setAtPath(target: unknown, pathText: string, value: unknown): void {
  const segments = pathText.split('.');
  let current = target as Record<string, unknown> | unknown[];
  for (const segment of segments.slice(0, -1)) {
    current = (current as Record<string, unknown>)[segment] as Record<string, unknown> | unknown[];
  }
  (current as Record<string, unknown>)[segments.at(-1)!] = value;
}

function deleteAtPath(target: unknown, pathText: string): void {
  const segments = pathText.split('.');
  let current = target as Record<string, unknown> | unknown[];
  for (const segment of segments.slice(0, -1)) {
    current = (current as Record<string, unknown>)[segment] as Record<string, unknown> | unknown[];
  }
  delete (current as Record<string, unknown>)[segments.at(-1)!];
}

describe('ComponentGraduationReport/v1', () => {
  it('defines a schema that all registered components can instantiate', () => {
    const scaffolds = createAllComponentGraduationReportScaffolds({ actor: 'codex' });
    expect(scaffolds).toHaveLength(COMPONENT_AUTHORITY_MANIFEST.components.length);
    for (const scaffold of scaffolds) {
      expect(scaffold.schemaVersion).toBe(COMPONENT_GRADUATION_REPORT_SCHEMA);
      expect(scaffold.componentId).toBeTruthy();
      expect(scaffold.driven_by).toBe('agent');
      expect(scaffold.actor).toBe('codex');
    }
  });

  it('accepts the internal/default/advanced/retired/contract evidence matrices', () => {
    for (const name of [
      'positive-internal.json',
      'positive-default.json',
      'positive-advanced.json',
      'positive-retired.json',
      'positive-contract.json',
    ]) {
      const report = readReport(name);
      const result = validate(report);
      expect(result.ok, `${name}: ${JSON.stringify(result.issues)}`).toBe(true);
      expect(result.graduationPass, name).toBe(true);
      expect(result.recomputedVerdict, name).toBe('pass');
    }
  });

  it('keeps experiment/shadow valid but non-graduating', () => {
    const report = readReport('positive-shadow.json');
    const result = validate(report);
    expect(result.ok).toBe(true);
    expect(result.graduationPass).toBe(false);
    expect(result.countsAsGraduated).toBe(false);
  });

  it('loads all positive fixtures from disk with their actual artifact hashes', () => {
    for (const name of fs.readdirSync(path.join(root, fixtureDir)).filter((entry) => /^positive-.*\.json$/u.test(entry))) {
      const report = readReport(name);
      const result = validate(report);
      expect(result.ok, `${name}: ${JSON.stringify(result.issues)}`).toBe(true);
    }
  });

  it('rejects every negative fixture with the expected issue code', () => {
    const cases = JSON.parse(fs.readFileSync(path.join(root, fixtureDir, 'negative-cases.json'), 'utf8')) as {
      cases: Array<{ id: string; base: string; set?: Record<string, unknown>; delete?: string[]; resolver?: 'match' | 'missing' | 'hash-mismatch' | 'raw-mismatch'; expectedContext?: Record<string, string>; expected: string[] }>;
    };
    const diskResolver = createDiskArtifactResolver(root);
    for (const testCase of cases.cases) {
      const report = readReport(testCase.base);
      for (const [pathText, value] of Object.entries(testCase.set ?? {})) setAtPath(report, pathText, value);
      for (const pathText of testCase.delete ?? []) deleteAtPath(report, pathText);
      const resolver = testCase.resolver
        ? () => testCase.resolver === 'raw-mismatch'
          ? { status: 'match' as const, content: JSON.stringify({ results: Object.fromEntries(report.evidence.map((item) => [item.kind, { status: 'fail' }])) }) }
          : { status: testCase.resolver as 'match' | 'missing' | 'hash-mismatch' }
        : diskResolver;
      const result = validate(report, { resolver, expected: testCase.expectedContext });
      expect(result.ok, testCase.id).toBe(false);
      for (const code of testCase.expected) {
        expect(result.issues.map((entry) => entry.code), testCase.id).toContain(code);
      }
    }
  });

  it('recomputes a deterministic input digest from raw artifact bindings', () => {
    const report = readReport('positive-internal.json');
    const artifact = report.binding.artifacts[0];
    const digest = crypto.createHash('sha256').update(`${artifact.path}\0${artifact.sha256}\0${artifact.bytes}`).digest('hex');
    expect(report.recompute.inputDigest).toBe(digest);
  });

  it('does not let experiment/shadow close a Task Forest done node', () => {
    const report = readReport('positive-shadow.json');
    const validation = validate(report);
    const result = evaluateTaskForestDoneGate({ node: { id: report.taskForestNodeId, status: 'done' }, report, validation });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('cannot close');
  });

  it('requires a passing report for a Task Forest done node', () => {
    const report = readReport('positive-internal.json');
    const validation = validate(report);
    expect(evaluateTaskForestDoneGate({ node: { id: report.taskForestNodeId, status: 'ready' }, report, validation }).ok).toBe(true);
    expect(evaluateTaskForestDoneGate({ node: { id: report.taskForestNodeId, status: 'done' }, report, validation }).ok).toBe(true);
    expect(evaluateTaskForestDoneGate({ node: { id: report.taskForestNodeId, status: 'done' } }).ok).toBe(false);
  });

  it('fails the default-change gate when the report is not default/advanced and valid', () => {
    const report = readReport('positive-internal.json');
    report.defaultMode = 'baseline';
    const validation = validate(report);
    const result = evaluateDefaultChangeGate({ currentDefaultMode: 'internal', report, validation });
    expect(result.defaultChanged).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('default/advanced');
  });

  it('fails the default-change gate for an invalid default/advanced report', () => {
    const report = readReport('positive-default.json');
    report.defaultMode = 'opt-in';
    report.rollback = '';
    const validation = validate(report);
    const result = evaluateDefaultChangeGate({ currentDefaultMode: 'baseline', report, validation });
    expect(result.defaultChanged).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('fails the disk-backed gate when an internal report requests a default change', () => {
    const result = runComponentGraduationGate({
      reportPath: `${fixtureDir}/negative-default-change.json`,
      root,
      expected: expectedContext,
    });
    expect(result.validation.ok).toBe(true);
    expect(result.defaultChange?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });
  it('runs the disk-backed CLI gate logic against the positive fixture', () => {
    const result = runComponentGraduationGate({
      reportPath: `${fixtureDir}/positive-internal.json`,
      root,
      expected: expectedContext,
    });
    expect(result.ok).toBe(true);
    expect(result.validation.graduationPass).toBe(true);
    expect(result.validation.recomputedVerdict).toBe('pass');
  });
});