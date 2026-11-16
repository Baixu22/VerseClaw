import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FROZEN_WEIGHTS, weightedBounds } from './semantic-convergence-benefit.mjs';

test('unmeasured impact and cost stay bounded rather than becoming invented point gains', () => {
  assert.deepEqual(weightedBounds(FROZEN_WEIGHTS, { correctness: 1, userImpact: null, coverage: 1,
    costEfficiency: null, evidenceQuality: 1 }), { lower: 0.65, upper: 1 });
});
test('a report cannot silently change frozen weights or accept an invalid dimension', () => {
  assert.throws(() => weightedBounds({ ...FROZEN_WEIGHTS, correctness: 0.5 }, {}), /weights changed/);
  assert.throws(() => weightedBounds(FROZEN_WEIGHTS, { correctness: 2 }), /invalid dimension/);
});
