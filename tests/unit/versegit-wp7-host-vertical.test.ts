import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WP7_EVIDENCE_PATH,
  WP7_SCHEMA,
  validateWp7Report,
} from '../../scripts/versegit-wp7-host-vertical.mts';

function stored(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), WP7_EVIDENCE_PATH), 'utf8')) as Record<string, unknown>;
}

describe('WP7 real host vertical slice', () => {
  it('accepts the real host chain and preserves authority/cleanup boundaries', () => {
    const report = stored();
    expect(report.schema).toBe(WP7_SCHEMA);
    expect(report.passed).toBe(true);
    expect(validateWp7Report(report).issues).toEqual([]);
    const facts = report.vgFacts as Record<string, unknown>;
    expect((facts.producerConsumer as { advisoryKinds: string[] }).advisoryKinds).toContain('ssi/stale-read');
    expect((facts.ownWriteNegativeControl as { advisoryKinds: string[] }).advisoryKinds).toEqual([]);
    expect(report.hostVerdict).toMatchObject({ before: 'pass', afterContinuation: 'pass', unchanged: true });
    expect(report.cleanup).toMatchObject({ status: 'clean', processSurvivors: 0, worktreeSurvivors: 0, tempRootRemoved: true });
  });

  it('rejects host verdict, cross-worktree and cleanup promotion', () => {
    const tampered = structuredClone(stored());
    (tampered.hostVerdict as Record<string, unknown>).unchanged = false;
    (tampered.identity as Record<string, unknown>).crossWorktreeViolations = 1;
    (tampered.cleanup as Record<string, unknown>).processSurvivors = 1;
    (tampered.boundaries as Record<string, unknown>).landOrAdmitInvoked = true;
    const issues = validateWp7Report(tampered).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'cross-worktree identity violations must be zero',
      'host verdict changed or was not independently produced',
      'cleanup boundary failed',
      'repository or landing boundary failed',
    ]));
  });

  it('requires a real accepted continuation receipt and no native verification fallback', () => {
    const tampered = structuredClone(stored());
    const receiptFlow = tampered.receiptFlow as Record<string, Record<string, unknown>>;
    receiptFlow.continuationReceipt.status = 'rejected_by_policy';
    receiptFlow.continuationVerdict.realVerseshellExecution = false;
    (tampered.provider as Record<string, unknown>).nativeVerificationFallbacks = 1;
    const issues = validateWp7Report(tampered).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'provider/verification execution route is not separated correctly',
      'continuation receipt was not accepted',
      'continuation verdict is not observed',
    ]));
  });
});
