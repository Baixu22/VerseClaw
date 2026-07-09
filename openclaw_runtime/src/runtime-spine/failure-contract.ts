// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { randomUUID } from 'node:crypto';

import { shadowSafetyBoundary } from './shadow-safety-boundary-adapter.js';
import type {
  EvidenceRef,
  FailureAction,
  FailureEnvelope,
  FailureKind,
  FailureRef,
  FailureRoute,
  FailureRoutingRule,
  FailureSeverity,
  RuntimeSpineMetadata,
  RuntimeSpineResult,
} from './types.js';

type ClassifiedFailure = {
  kind: FailureKind;
  severity: FailureSeverity;
  action: FailureAction;
  message: string;
};

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim();
  }
  return String(error);
}

export function classifyFailure(error: unknown, stage: string): ClassifiedFailure {
  const text = errorText(error).toLowerCase();
  const message = error instanceof Error ? error.message : String(error);

  if (text.includes('timeout') || text.includes('etimedout')) {
    return { kind: 'timeout', severity: 'warning', action: 'auto_retry', message };
  }
  if (text.includes('permission') || text.includes('eacces')) {
    return {
      kind: 'permission_denied',
      severity: 'error',
      action: 'requires_review',
      message,
    };
  }
  if (text.includes('drift')) {
    return { kind: 'drift_detected', severity: 'error', action: 'requires_review', message };
  }
  if (text.includes('gate block') || text.includes('gate_block')) {
    return { kind: 'gate_blocked', severity: 'error', action: 'requires_review', message };
  }
  if (stage === 'apply') {
    return { kind: 'ast_apply_error', severity: 'error', action: 'rollback_planned', message };
  }
  if (stage === 'verification') {
    return { kind: 'verification_failed', severity: 'error', action: 'requires_review', message };
  }
  return { kind: 'unknown', severity: 'error', action: 'requires_review', message };
}

const defaultRoutingRules: readonly FailureRoutingRule[] = [
  {
    ruleId: 'timeout-retry-under-limit',
    when: (envelope) => envelope.kind === 'timeout' && envelope.retryCount < 3,
    action: 'retry',
    reason: 'Timeout failures retry while below the diagnostic retry limit.',
  },
  {
    ruleId: 'permission-review',
    when: (envelope) => envelope.kind === 'permission_denied',
    action: 'escalate_review',
    reason: 'Permission failures require review.',
  },
  {
    ruleId: 'ast-apply-rollback',
    when: (envelope) => envelope.kind === 'ast_apply_error',
    action: 'rollback_planned',
    reason: 'AST apply failures plan rollback.',
  },
  {
    ruleId: 'verification-review',
    when: (envelope) => envelope.kind === 'verification_failed',
    action: 'escalate_review',
    reason: 'Verification failures require review.',
  },
  {
    ruleId: 'critical-block',
    when: (envelope) => envelope.severity === 'critical',
    action: 'block',
    reason: 'Critical failures block diagnostic progression.',
  },
];

export function routeFailure(
  envelope: FailureEnvelope,
  customRules: readonly FailureRoutingRule[] = [],
): FailureRoute {
  const rules = [...customRules, ...defaultRoutingRules];
  const matched = rules.find((rule) => rule.when(envelope));
  if (matched) {
    return { action: matched.action, reason: matched.reason, ruleId: matched.ruleId };
  }
  return {
    action: 'escalate_review',
    reason: 'Fallback route requires review.',
    ruleId: 'fallback-review',
  };
}

class FailureContract {
  private readonly failures = new Map<string, FailureEnvelope>();

  create(
    entityId: string,
    error: unknown,
    stage: string,
    evidenceRef?: EvidenceRef,
    context?: RuntimeSpineMetadata,
    retryCount = 0,
    maxRetries = 3,
  ): FailureEnvelope {
    const classified = classifyFailure(error, stage);
    const envelope: FailureEnvelope = {
      failureId: randomUUID(),
      entityId,
      ...classified,
      stage,
      evidenceRef,
      context,
      retryCount,
      maxRetries,
      escalated: false,
      createdAt: Date.now(),
    };

    shadowSafetyBoundary.execute('failure-contract.create', () => {
      this.failures.set(envelope.failureId, envelope);
    });

    return envelope;
  }

  escalate(failureId: string): RuntimeSpineResult<FailureEnvelope> {
    const envelope = this.failures.get(failureId);
    if (!envelope) {
      return { success: false, error: `Failure envelope not found: ${failureId}` };
    }

    shadowSafetyBoundary.execute('failure-contract.escalate', () => {
      envelope.escalated = true;
    });

    return { success: true, value: envelope };
  }

  get(failureId: string): FailureEnvelope | undefined {
    return this.failures.get(failureId);
  }

  toRef(envelope: FailureEnvelope): FailureRef {
    return {
      refType: 'failure',
      failureId: envelope.failureId,
      entityId: envelope.entityId,
      kind: envelope.kind,
      severity: envelope.severity,
    };
  }
}

export const failureContract = new FailureContract();
