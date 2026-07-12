// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { describe, expect, it } from 'vitest';

import { classifyFailure, failureContract, routeFailure } from '../failure-contract.js';
import type { FailureEnvelope } from '../types.js';

function envelope(overrides: Partial<FailureEnvelope>): FailureEnvelope {
  return {
    failureId: 'failure-1',
    entityId: 'entity-1',
    kind: 'unknown',
    stage: 'diagnostic',
    severity: 'error',
    action: 'requires_review',
    message: 'failure',
    retryCount: 0,
    maxRetries: 3,
    escalated: false,
    createdAt: 1,
    ...overrides,
  };
}

describe('FailureContract', () => {
  it('classifies timeout failures as auto retry', () => {
    expect(classifyFailure(new Error('operation timeout'), 'run')).toMatchObject({
      kind: 'timeout',
      action: 'auto_retry',
    });
  });

  it('classifies permission failures as requiring review', () => {
    expect(classifyFailure(new Error('permission denied'), 'run')).toMatchObject({
      kind: 'permission_denied',
      action: 'requires_review',
    });
  });

  it('classifies apply stage failures as AST apply errors', () => {
    expect(classifyFailure(new Error('patch failed'), 'apply')).toMatchObject({
      kind: 'ast_apply_error',
    });
  });

  it('routes failures with default rules', () => {
    expect(routeFailure(envelope({ kind: 'timeout' }))).toMatchObject({
      action: 'retry',
      ruleId: 'timeout-retry-under-limit',
    });
    expect(routeFailure(envelope({ kind: 'permission_denied' }))).toMatchObject({
      action: 'escalate_review',
      ruleId: 'permission-review',
    });
  });

  it('escalates for review when no rule matches', () => {
    expect(routeFailure(envelope({ kind: 'unknown', severity: 'error' }))).toEqual({
      action: 'escalate_review',
      reason: 'Fallback route requires review.',
      ruleId: 'fallback-review',
    });
  });

  it('creates failure envelopes from classified errors', () => {
    const created = failureContract.create('entity-create', new Error('timeout'), 'run');

    expect(created).toMatchObject({
      entityId: 'entity-create',
      kind: 'timeout',
      stage: 'run',
      action: 'auto_retry',
      retryCount: 0,
      maxRetries: 3,
      escalated: false,
    });
    expect(failureContract.get(created.failureId)).toBe(created);
  });
});
