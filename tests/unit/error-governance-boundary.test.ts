import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_ERROR_CODES, mapBackendErrorCode } from '../../src/lib/error-model';
import { parseFrontmatter } from '../../harness/src/specs.mjs';
import {
  GAP_PROBES,
  GOVERNANCE_PATHS,
  GOVERNANCE_RULE_ID,
  HUMAN_PREREQUISITE_PATTERNS,
  RECORD_DISAMBIGUATION_ANCHORS,
  REUSED_ENVELOPE,
  REUSED_ERROR_TYPES,
  WAITING_DECISION_FALLBACK,
  extractSurfaceBlock,
  findHumanPrerequisites,
  parseHostErrorCodes,
  parseWaitingTypes,
  resolveWaitingDecision,
  validateErrorGovernance,
} from '../../scripts/check-error-governance.mjs';

const REPO_ROOT = process.cwd();
const FIXTURE_ROOT = 'tests/unit/fixtures/error-governance';
const CLI_PATH = join(REPO_ROOT, 'scripts', 'check-error-governance.mjs');

type SurfaceLike = {
  envelope: { symbol: string };
  allowedErrorTypes: string[];
  hostErrorCodeMappings: Array<{ code: string; rendererClass: string }>;
  declaredUnknownMappings: Array<{ code: string }>;
  errorSurfaces: Array<{ id: string; codes: string[]; errorTypeSymbol: string }>;
  declaredGaps: Array<{ id: string; probe: string; evidence: string; state: string }>;
  waitingTypes: {
    approvalType: Record<string, { decision: string; autoApprove: boolean; executedAction: string | null }>;
    waitingStatus: Record<string, { waiting: boolean; effectsAllowed: boolean }>;
  };
};

function loadDeclaredSurface(): SurfaceLike {
  const ruleText = readFileSync(join(REPO_ROOT, GOVERNANCE_PATHS.rule), 'utf8');
  const surface = extractSurfaceBlock(ruleText);
  expect(surface, 'the governed rule must carry a machine-readable surface block').toBeTruthy();
  return surface as SurfaceLike;
}

function surfaceWith(mutate: (surface: SurfaceLike) => void): SurfaceLike {
  const copy = JSON.parse(JSON.stringify(loadDeclaredSurface())) as SurfaceLike;
  mutate(copy);
  return copy;
}

function reportFor(options: Record<string, unknown> = {}) {
  return validateErrorGovernance({ root: REPO_ROOT, ...options });
}

function findingCodes(report: { findings: Array<{ code: string }> }): string[] {
  return report.findings.map((finding) => finding.code);
}

function findingsFor(report: { findings: Array<{ check: string; code: string }> }, checkId: string): string[] {
  return report.findings.filter((finding) => finding.check === checkId).map((finding) => finding.code);
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

describe('error governance surface on the current tree', () => {
  it('passes with no findings', () => {
    const report = reportFor();

    expect(report.findings).toEqual([]);
    expect(report.result).toBe('pass');
    expect(report.drivenBy).toBe('agent');
    expect(report.checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining([
        'error-envelope-reused',
        'host-error-code-mapping-complete',
        'error-mapping-matches-classifier',
        'declared-gaps-match-tree',
        'error-surfaces-in-range',
        'waiting-type-coverage',
        'no-auto-approval',
        'no-human-prerequisite',
        'decision-record-anchors',
        'record-disambiguation-anchors',
        'scenario-wiring',
      ]),
    );
  });

  it('keeps the flagged semantics separate in the decision record', () => {
    const record = readFileSync(join(REPO_ROOT, GOVERNANCE_PATHS.record), 'utf8').toLowerCase();

    for (const anchor of RECORD_DISAMBIGUATION_ANCHORS) {
      expect(record, `the record must keep "${anchor}" separate`).toContain(anchor.toLowerCase());
    }
  });

  it('reuses one envelope and the existing error types only', () => {
    const surface = loadDeclaredSurface();

    expect(surface.envelope.symbol).toBe(REUSED_ENVELOPE);
    expect(surface.envelope.symbol).toBe('HostResponse');
    expect(surface.allowedErrorTypes).toEqual(REUSED_ERROR_TYPES);
    expect(REUSED_ERROR_TYPES).toEqual(['AppError', 'HostErrorCode']);
    for (const entry of surface.errorSurfaces) {
      expect(entry.id, JSON.stringify(entry)).toBeTruthy();
      expect(REUSED_ERROR_TYPES).toContain(entry.errorTypeSymbol);
    }
  });

  it('maps every real Main-process error code, or declares the missing mapping', () => {
    const hostContract = readFileSync(join(REPO_ROOT, GOVERNANCE_PATHS.hostContract), 'utf8');
    const hostCodes = parseHostErrorCodes(hostContract);

    expect(hostCodes).toEqual(['VALIDATION', 'UNSUPPORTED', 'INTERNAL', 'TIMEOUT']);

    const surface = loadDeclaredSurface();
    const declared = new Map(surface.hostErrorCodeMappings.map((entry) => [entry.code, entry.rendererClass]));
    const declaredUnknown = surface.declaredUnknownMappings.map((entry) => entry.code);

    for (const code of hostCodes) {
      expect(declared.has(code), `${code} must be mapped or declared as a gap`).toBe(true);
      const realClass = mapBackendErrorCode(code);
      if (realClass === 'UNKNOWN') {
        expect(declared.get(code)).toBe('UNKNOWN');
        expect(declaredUnknown).toContain(code);
      } else {
        expect(APP_ERROR_CODES).toContain(realClass);
        expect(declared.get(code)).toBe(realClass);
      }
    }
  });

  it('declares the same waiting taxonomy as the real host-api contract unions', () => {
    const contract = readFileSync(join(REPO_ROOT, GOVERNANCE_PATHS.hostApiContract), 'utf8');
    const real = parseWaitingTypes(contract);
    const surface = loadDeclaredSurface();

    expect(real.approvalType.sort()).toEqual(['approved', 'consumed', 'pending', 'rejected']);
    expect(Object.keys(surface.waitingTypes.approvalType).sort()).toEqual(real.approvalType.sort());
    expect(Object.keys(surface.waitingTypes.waitingStatus).sort()).toEqual(real.waitingStatus.sort());
  });

  it('declares every gap with an executable probe and existing evidence', () => {
    const surface = loadDeclaredSurface();

    expect(surface.declaredGaps.map((gap) => gap.id).sort()).toEqual([
      'duplicate-app-error-code-unions',
      'duplicate-host-response-copies',
    ]);
    for (const gap of surface.declaredGaps) {
      expect(gap.state, gap.id).toBe('gap');
      expect(Object.keys(GAP_PROBES), gap.id).toContain(gap.probe);
      expect(GAP_PROBES[gap.probe].isOpen(REPO_ROOT), `${gap.id} must still reproduce`).toBe(true);
    }
  });

  it('wires the rule into the gateway-backend-communication scenario', () => {
    const scenario = readFileSync(join(REPO_ROOT, GOVERNANCE_PATHS.scenario), 'utf8');
    const data = parseFrontmatter(scenario).data as { requiredRules?: string[] };
    const rule = parseFrontmatter(readFileSync(join(REPO_ROOT, GOVERNANCE_PATHS.rule), 'utf8')).data as {
      id: string;
      appliesTo: string[];
    };

    expect(data.requiredRules).toContain(GOVERNANCE_RULE_ID);
    expect(rule.id).toBe(GOVERNANCE_RULE_ID);
    expect(rule.appliesTo).toContain('gateway-backend-communication');
  });
});

describe('resolveWaitingDecision stays fail-closed', () => {
  const waitingTypes = loadDeclaredSurface().waitingTypes;

  it('holds an unrecognized approval type without approving or executing', () => {
    const decision = resolveWaitingDecision(
      { approvalType: 'escalate-to-someone', waitingStatus: 'waiting-approval' },
      waitingTypes,
    );

    expect(decision).toMatchObject(WAITING_DECISION_FALLBACK);
    expect(decision.reason).toBe('unrecognized-approval-type');
    expect(decision.autoApprove).toBe(false);
    expect(decision.executedAction).toBeNull();
    expect(decision.effectsAllowed).toBe(false);
  });

  it('holds an unrecognized waiting status without approving or executing', () => {
    const decision = resolveWaitingDecision(
      { approvalType: 'approved', waitingStatus: 'teleported' },
      waitingTypes,
    );

    expect(decision).toMatchObject(WAITING_DECISION_FALLBACK);
    expect(decision.reason).toBe('unrecognized-waiting-status');
    expect(decision.executedAction).toBeNull();
  });

  it.each([
    ['an empty descriptor', {}],
    ['a numeric approval type', { approvalType: 7, waitingStatus: 'queued' }],
    ['a null waiting status', { approvalType: 'approved', waitingStatus: null }],
    ['an undefined descriptor', undefined],
    ['a prototype key', { approvalType: '__proto__', waitingStatus: 'queued' }],
    ['an inherited member name', { approvalType: 'toString', waitingStatus: 'queued' }],
    ['a constructor key', { approvalType: 'approved', waitingStatus: 'constructor' }],
  ])('holds %s', (_label, descriptor) => {
    const decision = resolveWaitingDecision(descriptor as never, waitingTypes);

    expect(decision.recognized).toBe(false);
    expect(decision.decision).toBe('hold');
    expect(decision.autoApprove).toBe(false);
    expect(decision.executedAction).toBeNull();
    expect(decision.effectsAllowed).toBe(false);
  });

  it('processes a known approval type per its declared schema', () => {
    expect(resolveWaitingDecision({ approvalType: 'pending', waitingStatus: 'waiting-approval' }, waitingTypes))
      .toMatchObject({ recognized: true, decision: 'hold', autoApprove: false, executedAction: null, effectsAllowed: false });
    expect(resolveWaitingDecision({ approvalType: 'approved', waitingStatus: 'queued' }, waitingTypes))
      .toMatchObject({
        recognized: true,
        decision: 'execute-once',
        autoApprove: false,
        executedAction: 'agent-browser-task-run',
        effectsAllowed: true,
      });
    expect(resolveWaitingDecision({ approvalType: 'consumed', waitingStatus: 'queued' }, waitingTypes))
      .toMatchObject({ recognized: true, decision: 'hold', executedAction: null, effectsAllowed: false });
    expect(resolveWaitingDecision({ approvalType: 'rejected', waitingStatus: 'waiting-approval' }, waitingTypes))
      .toMatchObject({ recognized: true, decision: 'deny', executedAction: null, effectsAllowed: false });
  });

  it('never allows effects while the task is still waiting for approval', () => {
    const decision = resolveWaitingDecision({ approvalType: 'approved', waitingStatus: 'waiting-approval' }, waitingTypes);

    expect(decision.recognized).toBe(true);
    expect(decision.effectsAllowed).toBe(false);
  });

  it('declares autoApprove: false for every approval type', () => {
    for (const [type, entry] of Object.entries(waitingTypes.approvalType)) {
      expect(entry.autoApprove, type).toBe(false);
    }
  });
});

describe('deliberately broken governance axes are rejected', () => {
  it('rejects a missing Main-process error mapping', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.hostErrorCodeMappings = surface.hostErrorCodeMappings.filter((entry) => entry.code !== 'INTERNAL');
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.missing-error-mapping');
  });

  it('rejects a renderer class outside the closed class set', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.hostErrorCodeMappings = surface.hostErrorCodeMappings.map((entry) => (
          entry.code === 'INTERNAL' ? { ...entry, rendererClass: 'TELEPORT_FAILED' } : entry
        ));
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.out-of-range-error-surface');
  });

  it('rejects a surface code outside the layer closed set', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.errorSurfaces[0].codes = [...surface.errorSurfaces[0].codes, 'NOT_A_REAL_CLASS'];
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.out-of-range-error-surface');
  });

  it('rejects a third envelope', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.envelope.symbol = 'HostEnvelopeV2';
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.parallel-envelope');
  });

  it('rejects a second error taxonomy', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.allowedErrorTypes = [...surface.allowedErrorTypes, 'MiniError'];
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.parallel-error-type');
  });

  it('rejects an auto-approved waiting type', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.waitingTypes.approvalType.pending.autoApprove = true;
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.auto-approval-declared');
  });

  it('rejects effects during a waiting status', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.waitingTypes.waitingStatus['waiting-approval'].effectsAllowed = true;
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.effects-during-wait');
  });

  it('rejects a real waiting type without a declared decision', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        // A null override value removes the key, so the mutation is a real
        // deletion rather than a value the declared taxonomy still carries.
        surface.waitingTypes.waitingStatus.interrupted = null as never;
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.missing-waiting-type');
  });

  it('rejects an invented waiting type', () => {
    const report = reportFor({
      surface: surfaceWith((surface) => {
        surface.waitingTypes.approvalType.escalated = {
          decision: 'hold',
          autoApprove: false,
          executedAction: null,
        };
      }),
    });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.unknown-waiting-type');
  });

  it('rejects a decision record that makes a human verdict a requirement', () => {
    const report = reportFor({ recordPath: `${FIXTURE_ROOT}/record-human-prerequisite.md` });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.human-prerequisite');
  });

  it('rejects a decision record that claims a path which does not resolve', () => {
    const report = reportFor({ recordPath: `${FIXTURE_ROOT}/record-missing-reference.md` });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.missing-reference');
  });

  it('rejects a decision record that collapses the flagged semantics', () => {
    const report = reportFor({ recordPath: `${FIXTURE_ROOT}/record-missing-disambiguation.md` });

    expect(report.result).toBe('fail');
    expect(findingsFor(report, 'record-disambiguation-anchors').length).toBeGreaterThan(0);
  });

  it('fails closed when the rule carries no surface block', () => {
    const report = reportFor({ rulePath: `${FIXTURE_ROOT}/rule-missing-surface-block.md` });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.surface-block-missing');
  });

  it('fails closed when the surface block is not valid JSON', () => {
    const report = reportFor({ rulePath: `${FIXTURE_ROOT}/rule-unparsable-surface.md` });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.surface-block-unparsable');
  });

  it('fails closed when the rule is missing entirely', () => {
    const report = reportFor({ rulePath: `${FIXTURE_ROOT}/rule-does-not-exist.md` });

    expect(report.result).toBe('fail');
    expect(findingCodes(report)).toContain('error-governance.governance-input-missing');
  });
});

describe('human prerequisite scan', () => {
  it('flags a requirement and ignores a negated prohibition', () => {
    const findings = findHumanPrerequisites('Approving this requires a human verdict before the run.');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((finding) => finding.id)).toContain('human-verdict');
    expect(findHumanPrerequisites('No artifact may require a human verdict.')).toEqual([]);
    expect(findHumanPrerequisites('Any step that would otherwise need a person is automated.')).toEqual([]);
    for (const pattern of HUMAN_PREREQUISITE_PATTERNS) {
      expect(findHumanPrerequisites('No artifact may require a human step.').some(
        (found) => found.id === pattern.id,
      )).toBe(false);
    }
  });
});

describe('error governance CLI', () => {
  it('exits zero on the current tree', () => {
    const result = runCli([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[error-governance] PASS');
  });

  it('exits non-zero on a deliberately broken surface fixture', () => {
    const result = runCli(['--json', '--surface', `${FIXTURE_ROOT}/surface-auto-approval.json`]);

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as { result: string; findings: Array<{ code: string }> };
    expect(report.result).toBe('fail');
    expect(report.findings.map((finding) => finding.code)).toContain('error-governance.auto-approval-declared');
  });

  it('exits non-zero on the missing-mapping, out-of-range and third-envelope fixtures', () => {
    const cases = [
      ['surface-missing-mapping.json', 'error-governance.missing-error-mapping'],
      ['surface-out-of-range-class.json', 'error-governance.out-of-range-error-surface'],
      ['surface-parallel-envelope.json', 'error-governance.parallel-envelope'],
    ] as const;

    for (const [fixture, code] of cases) {
      const result = runCli(['--json', '--surface', `${FIXTURE_ROOT}/${fixture}`]);
      expect(result.status, fixture).toBe(1);
      const report = JSON.parse(result.stdout) as { result: string; findings: Array<{ code: string }> };
      expect(report.findings.map((finding) => finding.code), fixture).toContain(code);
    }
  });

  it('exits non-zero when the record makes a human verdict a requirement', () => {
    const result = runCli(['--json', '--record', `${FIXTURE_ROOT}/record-human-prerequisite.md`]);

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as { findings: Array<{ code: string }> };
    expect(report.findings.map((finding) => finding.code)).toContain('error-governance.human-prerequisite');
  });
});
