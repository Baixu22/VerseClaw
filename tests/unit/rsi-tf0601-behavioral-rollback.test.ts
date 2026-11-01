// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildBehavioralRollbackReceipt,
  observeRollbackDrill,
  validateBehavioralRollbackReceipt,
} from '../../scripts/rsi-tf0601-behavioral-rollback.mjs';

const candidateDigest = 'sha256:' + 'a'.repeat(64);
const baselineDigest = 'sha256:' + 'b'.repeat(64);

describe('TF-0601 behavioral rollback drill', () => {
  it('observes off/on/off through the production flag and hook modules', () => {
    const observed = observeRollbackDrill();
    expect(observed.phases).toEqual({ baselineOff: true, candidateOn: true, rollbackOff: true });
    expect(observed.observations.enabledHook.subscribed).toBe(true);
    expect(observed.observations.disabledHook.subscribed).toBe(false);
    expect(observed.observations.enabledHook.afterUninstall).toBe(0);
    expect(observed.observations.disabledHook.afterUninstall).toBe(0);
  });

  it('produces a bound receipt whose source artifacts match disk', () => {
    const receipt = buildBehavioralRollbackReceipt({ candidateDigest, baselineDigest });
    expect(validateBehavioralRollbackReceipt(receipt)).toEqual({ valid: true, errors: [] });
    expect(receipt.candidateDigest).toBe(candidateDigest);
    expect(receipt.baselineDigest).toBe(baselineDigest);
    expect(receipt.actor).not.toBe(receipt.adjudicatorActor);
    expect(receipt.commands).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'feature-flag-resolution', exitCode: 0 }), expect.objectContaining({ id: 'harness-hook-lifecycle', exitCode: 0 })]));
    expect(receipt.claims).toEqual({ realHuman: false, liveProvider: false, productLocksChanged: false });
    for (const artifact of receipt.artifacts) {
      expect(artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(readFileSync(artifact.path).length).toBeGreaterThan(0);
    }
  });

  it('rejects forged phase, actor and side-effect evidence', () => {
    const receipt = buildBehavioralRollbackReceipt({ candidateDigest, baselineDigest });
    expect(validateBehavioralRollbackReceipt({ ...receipt, phases: { ...receipt.phases, rollbackOff: false } }).errors).toContain('phase-order');
    expect(validateBehavioralRollbackReceipt({ ...receipt, adjudicatorActor: receipt.actor }).errors).toContain('independent-actors');
    expect(validateBehavioralRollbackReceipt({ ...receipt, checks: { ...receipt.checks, reverseMigrationApplied: true } }).errors).toContain('rollback-side-effects');
  });
});
