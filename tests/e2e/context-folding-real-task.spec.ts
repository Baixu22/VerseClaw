import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke } from './fixtures/fp-p1-harness';

/**
 * Electron verification for the context-folding host surface.
 *
 * This proves the real Main service accepts the feature-off status, validates a
 * bounded parent projection, and refuses transcript-shaped output. The real
 * code-modification task and oracle run are the separate TF-0695 eval; this spec
 * never substitutes this host check for that eval.
 *
 * driven_by: agent; actor: codex/context-folding-rlm
 */
test.describe('context folding Electron host surface', () => {
  test('reports default-off feature state and validates the bounded fold projection', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const status = await hostInvoke<{
        success: boolean;
        status: {
          enabled: boolean;
          source: string;
          rollback: string;
          flagPath: string;
          limits: { rawChildTranscriptMaxChars: number; maxRecursiveDepth: number };
        };
      }>(app, 'sessions', 'contextFoldingStatus', {});
      expect(status.success).toBe(true);
      expect(status.status.enabled).toBe(false);
      expect(status.status.source).toBe('default');
      expect(status.status.rollback).toBe('disable-only');
      expect(status.status.flagPath).toBe('runtime.contextBlock.contextFolding.enabled');
      expect(status.status.limits.rawChildTranscriptMaxChars).toBe(8000);
      expect(status.status.limits.maxRecursiveDepth).toBe(1);

      const foldResult = {
        schemaVersion: 'ContextFoldResult/v1',
        foldId: `cff_${'a'.repeat(32)}`,
        childSessionKey: 'agent:main:subagent:e2e-child',
        childRunId: 'run-e2e-child',
        status: 'completed',
        summary: 'The repeated completion path bumps revision unless it returns early.',
        structuredOutput: { defectLocation: 'src/taskboard.py:L22' },
        evidenceRefs: [{
          handleId: `cfh_${'b'.repeat(32)}`,
          resourceId: 'src/taskboard.py',
          selector: 'L20-L30',
          checksum: `sha256:${'c'.repeat(64)}`,
          kind: 'excerpt',
        }],
        unresolvedClaims: [],
        blockers: [],
        failedAttempts: [],
        inputRefs: [`cfh_${'b'.repeat(32)}`],
        usage: { totalTokens: 1200, latencyMs: 25 },
        diagnostics: [],
        rawChildTranscriptChars: 0,
        recursionDepth: 1,
        deliveryId: 'cfd-e2e-delivery',
        drivenBy: 'agent',
        actor: 'e2e-child',
      };
      const accepted = await hostInvoke<{
        success: boolean;
        ok: boolean;
        projection?: { childRunId: string; rawChildTranscriptChars: number; outputChars: number };
        chars?: number;
      }>(app, 'sessions', 'contextFoldProjection', { result: foldResult, maxChars: 500 });
      expect(accepted.success).toBe(true);
      expect(accepted.ok).toBe(true);
      expect(accepted.projection?.childRunId).toBe('run-e2e-child');
      expect(accepted.projection?.rawChildTranscriptChars).toBe(0);
      expect(accepted.chars).toBeLessThanOrEqual(500);

      const rejected = await hostInvoke<{
        success: boolean;
        ok: boolean;
        diagnostics: Array<{ code: string }>;
      }>(app, 'sessions', 'contextFoldProjection', {
        result: { transcript: 'raw child transcript', messages: [{ role: 'assistant', content: 'secret tool payload' }] },
      });
      expect(rejected.success).toBe(true);
      expect(rejected.ok).toBe(false);
      expect(rejected.diagnostics.some((item) => item.code === 'raw_transcript_rejected')).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});