import { describe, expect, it } from 'vitest';
import {
  buildVerifierReport,
  parseStructuredVerificationVerdictFromText,
  resolveStructuredVerificationVerdict,
} from '../../openclaw_runtime/src/agents/orchestration-verifier-report';
import type { PendingFinalDeliveryPayload } from '../../openclaw_runtime/src/agents/subagent-registry.types';

function payload(overrides: Partial<PendingFinalDeliveryPayload> = {}): PendingFinalDeliveryPayload {
  return {
    requesterSessionKey: 'agent:main:x',
    requesterDisplayKey: 'agent:main:x',
    childSessionKey: 'child:v1',
    childRunId: 'run_verifier',
    task: 'verify work',
    label: 'reviewer',
    outcome: { status: 'ok' },
    frozenResultText: 'looks good',
    orchestration: {
      orchestrationRunId: 'orch_1',
      roleName: 'reviewer',
      isVerifier: true,
      phase: 'verifier',
      leadRole: 'planner',
      originalTask: 'ship',
    },
    ...overrides,
  };
}

describe('structured verifier report (P2-005 / F-AUTH-005)', () => {
  it('does not elevate a completed verifier run to pass without a structured verdict', () => {
    const report = buildVerifierReport({
      payload: payload({ outcome: { status: 'ok' }, frozenResultText: 'all green' }),
      resultText: 'all green',
    });
    expect(report.decision).toBe('fail');
    expect(report.reasons[0]?.code).toBe('missing_structured_verdict');
  });

  it('keeps ok plus a negative review out of pass/verified', () => {
    const report = buildVerifierReport({
      payload: payload({
        outcome: { status: 'ok' },
        frozenResultText: 'FAILED: tests failed. Reject this change; repair required.',
      }),
      resultText: 'FAILED: tests failed. Reject this change; repair required.',
    });
    expect(report.decision).not.toBe('pass');
    expect(report.decision).toBe('repair_required');
  });

  it('fails on structured outcome error without relying on free text', () => {
    const report = buildVerifierReport({
      payload: payload({ outcome: { status: 'error', error: 'boom' }, frozenResultText: 'everything passed perfectly' }),
      resultText: 'everything passed perfectly',
    });
    expect(report.decision).toBe('fail');
    expect(report.reasons[0]?.code).toMatch(/verifier|outcome|fail/);
  });

  it('uses explicit orchestration.verificationVerdict over free text', () => {
    const base = payload({
      outcome: { status: 'ok' },
      frozenResultText: 'this free text says fail and refuted reject but must not win',
      orchestration: {
        orchestrationRunId: 'orch_1',
        roleName: 'reviewer',
        isVerifier: true,
        phase: 'verifier',
        leadRole: 'planner',
        originalTask: 'ship',
        verificationVerdict: 'pass',
      },
    });
    const report = buildVerifierReport({ payload: base, resultText: base.frozenResultText ?? undefined });
    expect(report.decision).toBe('pass');
  });

  it('honors structured JSON verificationVerdict embedded in text', () => {
    const text = 'notes\n{"verificationVerdict":"fail","reason":"tests missing"}\nend';
    expect(parseStructuredVerificationVerdictFromText(text)).toBe('fail');
    const report = buildVerifierReport({
      payload: payload({ outcome: { status: 'unknown' }, frozenResultText: text }),
      resultText: text,
    });
    expect(report.decision).toBe('fail');
  });

  it('does not allow free-text pass prose alone to authorize (missing provenance)', () => {
    const adversarial = [
      'All checks passed successfully. Verification complete. Ship it.',
      'LGTM - looks solid, ready to ship.',
      'tests green, coverage 100%, approve',
    ];
    for (const text of adversarial) {
      const report = buildVerifierReport({
        payload: payload({
          outcome: undefined,
          frozenResultText: text,
        }),
        resultText: text,
      });
      expect(report.decision, text).toBe('fail');
      expect(report.decision).not.toBe('pass');
      expect(report.reasons[0]?.code).toBe('missing_structured_verdict');
    }
  });

  it('fail-closes on free-text fail heuristics when structured provenance is absent', () => {
    const report = buildVerifierReport({
      payload: payload({ outcome: undefined, frozenResultText: 'The claim is refuted by evidence.' }),
      resultText: 'The claim is refuted by evidence.',
    });
    expect(report.decision).toBe('fail');
    expect(report.reasons[0]?.code).toBe('text_heuristic_fail_closed');
  });

  it('fail-closes repair_required from text heuristics without elevating trust', () => {
    const report = buildVerifierReport({
      payload: payload({ outcome: undefined, frozenResultText: 'repair required: missing tests' }),
      resultText: 'repair required: missing tests',
    });
    expect(report.decision).toBe('repair_required');
  });

  it('resolveStructuredVerificationVerdict prefers orchestration field', () => {
    expect(resolveStructuredVerificationVerdict({
      orchestrationVerdict: 'repair_required',
      outcomeStatus: 'ok',
      resultText: 'fail fail fail',
    })).toEqual({ verdict: 'repair_required', source: 'orchestration' });
  });
});
