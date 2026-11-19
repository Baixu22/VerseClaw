import assert from 'node:assert/strict';
import test from 'node:test';
import { selectSteps } from './profiles.mjs';

test('fresh-checkout validation builds workspace types before typecheck and unit imports', () => {
  const steps = selectSteps(['fast']);
  const indexOf = (script) => steps.findIndex((step) => step.args.includes(script));
  const build = indexOf('versebrowser:build');
  assert.ok(build >= 0);
  assert.ok(build < indexOf('typecheck'));
  assert.ok(build < indexOf('test'));
});

test('repeated profiles run the workspace preparation once', () => {
  const steps = selectSteps(['fast', 'comms', 'fast']);
  assert.equal(steps.filter((step) => step.args.includes('versebrowser:build')).length, 1);
});
