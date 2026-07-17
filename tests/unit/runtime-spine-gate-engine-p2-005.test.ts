import { afterEach, describe, expect, it, vi } from 'vitest';

import { gateEngine } from '../../openclaw_runtime/src/runtime-spine/gate-engine.js';
import type { GateCheckRequest } from '../../openclaw_runtime/src/runtime-spine/types.js';

const destructiveRequest: GateCheckRequest = {
  gateType: 'destructive_op',
  entityId: 'entity-destructive',
  entityType: 'tool_invocation',
  source: {
    sourceId: 'runtime-spine-p2-005',
    sourceType: 'runtime_spine',
  },
};

const preMutationRequest: GateCheckRequest = {
  gateType: 'pre_mutation',
  entityId: 'entity-pre-mutation',
  entityType: 'tool_invocation',
  source: {
    sourceId: 'runtime-spine-p2-005',
    sourceType: 'runtime_spine',
  },
};

describe('GateEngine blocking defaults (P2-005 / F-AUTH-004)', () => {
  afterEach(() => {
    gateEngine.resetConfig();
    gateEngine.unregisterChecker('blocker');
    gateEngine.unregisterChecker('throwing-checker');
  });

  it('defaults destructive_op and pre_mutation authority to blocking', () => {
    const config = gateEngine.getConfig();
    expect(config.authorityOverrides.destructive_op).toBe('blocking');
    expect(config.authorityOverrides.pre_mutation).toBe('blocking');
    expect(config.mandatoryGateTypes).toEqual(expect.arrayContaining(['destructive_op', 'pre_mutation']));
  });

  it('blocks destructive_op when a checker fails under default blocking authority', async () => {
    gateEngine.configure({ samplingRate: 1 });
    gateEngine.registerChecker({
      checkerId: 'blocker',
      gateTypes: ['destructive_op'],
      check: () => ({ checkerId: 'blocker', passed: false, message: 'deny high-risk' }),
    });

    const decision = await gateEngine.check(destructiveRequest);

    expect(decision).toMatchObject({
      gateType: 'destructive_op',
      authority: 'blocking',
      status: 'blocked',
      mandatory: true,
      sampled: true,
    });
  });

  it('blocks pre_mutation when a checker fails under default blocking authority', async () => {
    gateEngine.configure({ samplingRate: 1 });
    gateEngine.registerChecker({
      checkerId: 'blocker',
      gateTypes: ['pre_mutation'],
      check: () => ({ checkerId: 'blocker', passed: false, message: 'deny mutation' }),
    });

    const decision = await gateEngine.check(preMutationRequest);
    expect(decision.status).toBe('blocked');
    expect(decision.authority).toBe('blocking');
  });

  it('fail-closes blocking gates when a checker throws', async () => {
    gateEngine.configure({ samplingRate: 1 });
    gateEngine.registerChecker({
      checkerId: 'throwing-checker',
      gateTypes: ['destructive_op'],
      check: () => {
        throw new Error('checker boom');
      },
    });

    const decision = await gateEngine.check(destructiveRequest);
    expect(decision.authority).toBe('blocking');
    expect(decision.status).toBe('blocked');
    expect(decision.errors.length).toBeGreaterThan(0);
  });

  it('still approves non-mandatory verification gates under diagnostic_only', async () => {
    gateEngine.configure({ samplingRate: 1 });
    gateEngine.registerChecker({
      checkerId: 'blocker',
      check: () => ({ checkerId: 'blocker', passed: false, message: 'would block' }),
    });

    const decision = await gateEngine.check({
      gateType: 'verification',
      entityId: 'entity-v',
      entityType: 'verification_task',
      source: { sourceId: 't', sourceType: 'runtime_spine' },
    });

    expect(decision.authority).toBe('diagnostic_only');
    expect(decision.status).toBe('approved');
  });
});
