// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { afterEach, describe, expect, it, vi } from 'vitest';

import { gateEngine } from '../gate-engine.js';
import type { GateCheckRequest } from '../types.js';

const request: GateCheckRequest = {
  gateType: 'verification',
  entityId: 'entity-gate',
  entityType: 'verification_task',
  source: {
    sourceId: 'runtime-spine-test',
    sourceType: 'runtime_spine',
  },
};

describe('GateEngine', () => {
  afterEach(() => {
    gateEngine.resetConfig();
    gateEngine.unregisterChecker('checker');
    gateEngine.unregisterChecker('throwing-checker');
  });

  it('returns approved decisions under diagnostic_only authority', async () => {
    gateEngine.configure({ samplingRate: 1 });
    gateEngine.registerChecker({
      checkerId: 'checker',
      check: () => ({ checkerId: 'checker', passed: false, message: 'would block' }),
    });

    const decision = await gateEngine.check(request);

    expect(decision).toMatchObject({
      authority: 'diagnostic_only',
      status: 'approved',
      sampled: true,
    });
    expect(decision.checkerResults).toEqual([
      expect.objectContaining({ checkerId: 'checker', passed: false }),
    ]);
  });

  it('calls registered checkers', async () => {
    gateEngine.configure({ samplingRate: 1 });
    const check = vi.fn(() => ({ checkerId: 'checker', passed: true }));
    gateEngine.registerChecker({ checkerId: 'checker', check });

    await gateEngine.check(request);

    expect(check).toHaveBeenCalledWith(request);
  });

  it('does not call unregistered checkers', async () => {
    gateEngine.configure({ samplingRate: 1 });
    const check = vi.fn(() => ({ checkerId: 'checker', passed: true }));
    gateEngine.registerChecker({ checkerId: 'checker', check });
    gateEngine.unregisterChecker('checker');

    await gateEngine.check(request);

    expect(check).not.toHaveBeenCalled();
  });

  it('keeps checker errors from changing the diagnostic gate result', async () => {
    gateEngine.configure({ samplingRate: 1 });
    gateEngine.registerChecker({
      checkerId: 'throwing-checker',
      check: () => {
        throw new Error('checker failed');
      },
    });

    const decision = await gateEngine.check(request);

    expect(decision.status).toBe('approved');
    expect(decision.errors).toEqual(['Checker failed or was swallowed: throwing-checker']);
  });

  it('does not skip mandatory gate types when sampling would otherwise skip them', async () => {
    gateEngine.configure({ samplingRate: 0, mandatoryGateTypes: ['verification'] });
    const check = vi.fn(() => ({ checkerId: 'checker', passed: true }));
    gateEngine.registerChecker({ checkerId: 'checker', check });

    const decision = await gateEngine.check(request);

    expect(decision.sampled).toBe(true);
    expect(decision.mandatory).toBe(true);
    expect(check).toHaveBeenCalledOnce();
  });

  it('defers non-mandatory gates when samplingRate is 0', async () => {
    gateEngine.configure({ samplingRate: 0, mandatoryGateTypes: [] });
    const check = vi.fn(() => ({ checkerId: 'checker', passed: true }));
    gateEngine.registerChecker({ checkerId: 'checker', check });

    const decision = await gateEngine.check(request);

    expect(decision).toMatchObject({
      status: 'deferred',
      sampled: false,
      mandatory: false,
    });
    expect(check).not.toHaveBeenCalled();
  });
});
