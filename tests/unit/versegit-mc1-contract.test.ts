import { describe, expect, it } from 'vitest';
import {
  loadConsumerContract,
  validateConsumerContract,
  validateReceiptEnvelope,
  validateReportEnvelope,
} from '../../scripts/versegit-mc1-contract.mjs';

describe('MC1 consumer contract', () => {
  it('accepts the checked-in contract', () => {
    expect(validateConsumerContract(loadConsumerContract())).toEqual({ ok: true, issues: [] });
  });

  it('keeps M0 and M1 free of writes/execution', () => {
    const contract = loadConsumerContract();
    expect(contract.permissions.M0).toEqual({ start_process: false, write_workspace: false, write_domain_state: false, execute: false });
    expect(contract.permissions.M1.write_workspace).toBe(false);
    expect(contract.permissions.M1.write_domain_state).toBe(false);
    expect(contract.permissions.M1.execute).toBe(false);
  });

  it('rejects reason labels as top-level statuses', () => {
    const report = {
      schema: 'clawx.versegit.module-report/v1',
      authority: { harnessVerdict: 'host', execution: 'verseshell', land: 'host-git' },
      result: { status: 'stale' },
      verification: { executor: 'verseshell' },
    };
    const result = validateReportEnvelope(report);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('report result.status is not an allowed top-level status');
  });

  it('requires host-authoritative execution and host Git landing', () => {
    const report = {
      schema: 'clawx.versegit.module-report/v1',
      authority: { harnessVerdict: 'vg', execution: 'vg', land: 'vg' },
      result: { status: 'observed' },
      verification: { executor: 'vg' },
    };
    const result = validateReportEnvelope(report);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'report must keep harness verdict with host',
      'report must keep execution with VerseShell',
      'report must keep land with host Git',
      'verification executor must be VerseShell',
    ]));
  });

  it('rejects selected receipts as full and caller self-report', () => {
    const receipt = {
      planId: 'plan', planDigest: 'digest', candidateId: 'candidate', checkId: 'check', ownerId: 'owner', epoch: 1,
      authorizationId: 'auth', argvDigest: 'argv', cwdDigest: 'cwd', envDigest: 'env', executionInputDigest: 'input',
      requiredScope: 'selected', artifactDigests: ['sha256:artifact'], cleanupStatus: 'clean', callerSelfReport: true,
    };
    const result = validateReceiptEnvelope(receipt);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['selected receipt cannot claim full admission', 'caller self-report is not a receipt']));
  });
});