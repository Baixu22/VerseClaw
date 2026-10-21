import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WP7_EVIDENCE_PATH,
  WP7_SCHEMA,
  stableJson,
  validateWp7Report,
} from '../../scripts/versegit-wp7-host-vertical.mts';

function stored(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), WP7_EVIDENCE_PATH), 'utf8')) as Record<string, unknown>;
}

function reseal(report: Record<string, unknown>): Record<string, unknown> {
  report.digest = createHash('sha256').update(stableJson({ ...report, generated_at: undefined, digest: undefined })).digest('hex');
  return report;
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
    expect(report.hostVerdict).toMatchObject({ before: 'pass', afterFailure: 'pass', afterContinuation: 'pass', unchanged: true });
    expect(report.cleanup).toMatchObject({ status: 'clean', processSurvivors: 0, worktreeSurvivors: 0, tempRootRemoved: true });
    expect((report.provider as { factRoute: string }).factRoute).toBe('host-owned-sidecar-fixed-argv');
    expect((report.provider as { verificationRoute: string }).verificationRoute).toBe('verseshell-governed-aci');
    expect((report.executionEvidence as { continuation: { receipt: { realVerseshell: boolean } } }).continuation.receipt.realVerseshell).toBe(true);
    const behaviorEvents = (report.behavior as { events: Array<Record<string, unknown>> }).events;
    const links = report.factProjectionLinks as Array<Record<string, unknown>>;
    const nullDigest = createHash('sha256').update(JSON.stringify(null)).digest('hex');
    for (const link of links) {
      const started = behaviorEvents.find((event) => event.eventId === link.sourceStartedEventId);
      expect(started).toBeTruthy();
      expect(link.inputDigest).toBe(started?.inputDigest);
      expect(link.inputDigest).not.toBe(nullDigest);
    }
  });

  it('rejects host verdict, cross-worktree, cleanup and execution promotion even after re-sealing', () => {
    const tampered = stored();
    (tampered.hostVerdict as Record<string, unknown>).unchanged = false;
    (tampered.identity as Record<string, unknown>).crossWorktreeViolations = 1;
    (tampered.cleanup as Record<string, unknown>).processSurvivors = 1;
    (tampered.boundaries as Record<string, unknown>).landOrAdmitInvoked = true;
    (tampered.provider as Record<string, unknown>).nativeVerificationFallbacks = 1;
    (tampered.continuation as Record<string, unknown>).failureRejectedBeforeContinuation = false;
    reseal(tampered);
    const issues = validateWp7Report(tampered).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'cross-worktree identity violations must be zero',
      'host verdict changed or was not independently produced',
      'cleanup boundary failed',
      'repository or landing boundary failed',
      'provider fact and verification execution-authority boundary is inconsistent',
      'failure rejection did not precede continuation',
    ]));
  });

  it('rejects merged identities, template replay and failed provider calls after re-sealing', () => {
    const tampered = stored();
    const identity = tampered.identity as { worktrees: Array<Record<string, unknown>> };
    identity.worktrees[1].agentSessionId = identity.worktrees[0].agentSessionId;
    identity.worktrees[1].vgSessionId = identity.worktrees[0].vgSessionId;
    const links = tampered.factProjectionLinks as Array<Record<string, unknown>>;
    links[1].behaviorEventId = links[0].behaviorEventId;
    (tampered.provider as { providerCalls: Array<Record<string, unknown>> }).providerCalls[0].success = false;
    const alteredProvider = (tampered.provider as { providerCalls: Array<Record<string, unknown>> }).providerCalls[1];
    (alteredProvider.argvShape as string[]).push('wrong-input.py');
    reseal(tampered);
    const issues = validateWp7Report(tampered).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'identity field agentSessionId must be unique',
      'identity field vgSessionId must be unique',
      `provider command argv evidence mismatch: ${String(alteredProvider.id)}`,
      `provider call is not bound to behavior event ${String(links[0].behaviorEventId)}`,
      'provider fact adapter failed or did not retain host command evidence',
    ]));
  });

  it('requires a live receipt backed by host-retained observation and artifact evidence', () => {
    const tampered = stored();
    const continuation = (tampered.executionEvidence as { continuation: Record<string, unknown> }).continuation;
    const receipt = continuation.receipt as Record<string, unknown>;
    receipt.artifactDigests = (receipt.artifactDigests as string[]).filter((digest) => digest !== receipt.observationDigest);
    reseal(tampered);
    const issues = validateWp7Report(tampered).issues;
    expect(issues).toContain('continuation receipt does not satisfy the structural binding contract');
    expect(issues.some((issue) => issue.startsWith('host evidence authority rejected continuation receipt:'))).toBe(true);
  });


  it('rejects nonzero OS survivors hidden behind zero summary counts', () => {
    const tampered = stored();
    const cleanup = tampered.cleanup as Record<string, unknown>;
    const inventory = cleanup.processInventory as Record<string, unknown>;
    const extraPid = 99999;
    inventory.managedPids = [...(inventory.managedPids as number[]), extraPid];
    (inventory.managedBeforeShutdown as Array<Record<string, unknown>>).push({ keyDigest: 'f'.repeat(64), pid: extraPid, state: 'ready' });
    (inventory.duringPids as number[]).push(extraPid);
    (inventory.ownedPidChecks as Array<Record<string, unknown>>).push({ ok: true, pid: extraPid, exists: true });
    inventory.survivorPids = [extraPid];
    cleanup.processSurvivors = 0;
    cleanup.processesDeleted = true;
    reseal(tampered);
    const issues = validateWp7Report(tampered).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'nonzero OS process survivor evidence was retained',
      'cleanup survivor count differs from owned PID exit checks',
      'report cleanup differs from host-recorded cleanup evidence',
    ]));
  });

});
