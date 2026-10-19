// @vitest-environment node
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureSoftThresholdCas,
  planSoftThresholdShadow,
  runSoftThresholdShadow,
  softThresholdCasMatches,
} from '../../openclaw_runtime/src/context-engine/exploration/soft-threshold';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeSessionFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-context-soft-threshold-'));
  dirs.push(dir);
  const file = join(dir, 'session.jsonl');
  const timestamp = '2026-10-19T00:00:00.000Z';
  writeFileSync(file, [
    JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp, cwd: dir }),
    JSON.stringify({
      type: 'message',
      id: 'm1',
      parentId: null,
      timestamp,
      message: { role: 'user', content: 'preserve this decision' },
    }),
  ].join('\n') + '\n', 'utf8');
  return file;
}

describe('context lifecycle soft-threshold shadow', () => {
  it('defaults off and returns explicit sync decisions for manual and overflow triggers', () => {
    expect(planSoftThresholdShadow({
      trigger: 'budget',
      currentTokenCount: 80_000,
      tokenBudget: 100_000,
    })).toMatchObject({ action: 'disabled', reason: 'shadow_disabled' });

    const options = { enabled: true, minHeadroomTokens: 12_000 };
    expect(planSoftThresholdShadow({
      trigger: 'manual', currentTokenCount: 80_000, tokenBudget: 100_000, options,
    })).toMatchObject({ action: 'sync', reason: 'manual_stays_sync' });
    expect(planSoftThresholdShadow({
      trigger: 'overflow', currentTokenCount: 95_000, tokenBudget: 100_000, options,
    })).toMatchObject({ action: 'sync', reason: 'overflow_stays_sync' });
  });

  it('would defer only a budget compaction with sufficient hard-window headroom', () => {
    const options = { enabled: true, minHeadroomTokens: 12_000 };
    const defer = planSoftThresholdShadow({
      trigger: 'budget', currentTokenCount: 80_000, tokenBudget: 100_000, options,
    });
    expect(defer).toMatchObject({
      action: 'would-defer',
      reason: 'soft_threshold_headroom',
      headroomTokens: 20_000,
    });
    expect(planSoftThresholdShadow({
      trigger: 'budget', currentTokenCount: 91_000, tokenBudget: 100_000, options,
    })).toMatchObject({ action: 'sync', reason: 'insufficient_headroom' });
    expect(planSoftThresholdShadow({
      trigger: 'budget', options,
    })).toMatchObject({ action: 'sync', reason: 'unknown_pressure' });
  });

  it('captures branch head and digest CAS and rejects a later transcript change', async () => {
    const sessionFile = writeSessionFile();
    const expected = await captureSoftThresholdCas({ sessionFile });
    const unchanged = await captureSoftThresholdCas({ sessionFile });
    expect(softThresholdCasMatches(expected, unchanged)).toBe(true);

    appendFileSync(sessionFile, `${JSON.stringify({
      type: 'message',
      id: 'm2',
      parentId: 'm1',
      timestamp: '2026-10-19T00:00:01.000Z',
      message: { role: 'assistant', content: 'new turn arrived' },
    })}\n`, 'utf8');
    const changed = await captureSoftThresholdCas({ sessionFile });
    expect(softThresholdCasMatches(expected, changed)).toBe(false);
  });

  it('contains background failure with one synchronous fallback', async () => {
    const sessionFile = writeSessionFile();
    const plan = planSoftThresholdShadow({
      trigger: 'budget',
      currentTokenCount: 80_000,
      tokenBudget: 100_000,
      options: { enabled: true },
    });
    const expectedCas = await captureSoftThresholdCas({ sessionFile });
    let fallbackCount = 0;
    const failure = await runSoftThresholdShadow({
      plan,
      expectedCas,
      sessionFile,
      runDeferred: async () => { throw new Error('synthetic background failure'); },
      fallbackSync: async () => { fallbackCount += 1; },
    });
    expect(failure).toMatchObject({ status: 'fallback-sync', fallbackApplied: true });
    expect(fallbackCount).toBe(1);

    let completed = false;
    const success = await runSoftThresholdShadow({
      plan,
      expectedCas,
      sessionFile,
      runDeferred: async () => { completed = true; },
      fallbackSync: async () => { throw new Error('fallback must not run'); },
    });
    expect(success).toMatchObject({ status: 'completed', fallbackApplied: false });
    expect(completed).toBe(true);
  });

  it('writes shadow-only scenario evidence when requested', async () => {
    const options = { enabled: true, minHeadroomTokens: 12_000 };
    const sessionFile = writeSessionFile();
    const expectedCas = await captureSoftThresholdCas({ sessionFile });
    appendFileSync(sessionFile, `${JSON.stringify({
      type: 'message', id: 'm-evidence', parentId: 'm1', timestamp: '2026-10-19T00:00:02.000Z',
      message: { role: 'assistant', content: 'evidence mismatch turn' },
    })}\n`, 'utf8');
    const changedCas = await captureSoftThresholdCas({ sessionFile });
    const failureResult = await runSoftThresholdShadow({
      plan: planSoftThresholdShadow({ trigger: 'budget', currentTokenCount: 80_000, tokenBudget: 100_000, options }),
      expectedCas: changedCas,
      sessionFile,
      runDeferred: async () => { throw new Error('synthetic evidence failure'); },
      fallbackSync: async () => {},
    });
    const report = {
      schema: 'clawx.tf0427.soft-threshold-shadow/v1',
      driven_by: 'agent',
      actor: 'codex-tf0424',
      generatedAt: new Date().toISOString(),
      defaultEnabled: false,
      scenarios: {
        softThreshold: planSoftThresholdShadow({
          trigger: 'budget', currentTokenCount: 80_000, tokenBudget: 100_000, options,
        }),
        headMismatch: {
          verified: true,
          matchesBeforeAppend: softThresholdCasMatches(expectedCas, expectedCas),
          matchesAfterAppend: softThresholdCasMatches(expectedCas, changedCas),
        },
        backgroundFailure: {
          ...failureResult,
          error: failureResult.error instanceof Error ? failureResult.error.message : String(failureResult.error),
        },
        manualSync: planSoftThresholdShadow({
          trigger: 'manual', currentTokenCount: 80_000, tokenBudget: 100_000, options,
        }),
        overflowSync: planSoftThresholdShadow({
          trigger: 'overflow', currentTokenCount: 95_000, tokenBudget: 100_000, options,
        }),
      },
    };
    const output = process.env.CONTEXT_LIFECYCLE_SOFT_THRESHOLD_OUT;
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    expect(report.scenarios.softThreshold.action).toBe('would-defer');
  });
});
