/**
 * TF-0004: SEKB semi-automatic golden path Electron E2E.
 *
 * Product host path only (no main-process dynamic import):
 *   sekbCaptureTrajectory (execute/compress)
 *   → sekbSuggestPrinciples (candidate)
 *   → sekbConfirmPrinciple (human confirm + persist)
 *   → sekbRetrieveForTask (recall + injection behavior delta)
 *   → artifacts/sekb-golden-path/evidence.json (lineage)
 *
 * No unattended auto writeback. Principles appear only after confirm.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { evidencePath } from './fixtures/evidence-root';

type HostResponse<T> = { ok: boolean; data?: T; error?: { message?: string } };

type CaptureResult = {
  available: boolean;
  reason?: string;
  trajectoryId?: string;
  stepCount?: number;
  compressed?: boolean;
  error?: string;
};

type SuggestResult = {
  available: boolean;
  reason?: string;
  mode: string;
  suggestions: Array<{
    cluster_summary: string;
    source_trajectory_ids: string[];
    suggested_principle: Record<string, unknown>;
    confidence: number;
  }>;
};

type ConfirmResult = {
  available: boolean;
  reason?: string;
  principleId?: string;
  provenance?: {
    schema: string;
    sessionId: string;
    sourceTrajectoryIds: string[];
    integrity: string;
  };
  dcsWrite?: string;
  highTrustEligible?: boolean;
  error?: string;
};

type RetrieveResult = {
  available: boolean;
  reason?: string;
  principles: Array<{
    principle_id: string;
    title: string;
    condition: string;
    action: string;
    reason: string;
    retrieval_count: number;
  }>;
  injection: string;
};

const SESSION_ID = 'session:tf-0004:e2e-golden';
const ARTIFACT_DIR = resolve(evidencePath('artifacts/sekb-golden-path'));
const ARTIFACT_PATH = join(ARTIFACT_DIR, 'evidence.json');

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const electron = process.mainModule!.require('electron') as typeof import('electron');
    const { ipcMain, BrowserWindow } = electron;
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      }
    )._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `sekb-gp-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  }
  return response.data as T;
}

test.describe('SEKB golden path (TF-0004)', () => {
  test('semi-auto write → human confirm → recall → behavior delta with lineage', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(180_000);
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await new Promise((r) => setTimeout(r, 2_000));

      // --- execute + compress (two similar trajectories for clustering) ---
      const captureA = await hostInvoke<CaptureResult>(app, 'knowledge', 'sekbCaptureTrajectory', {
        taskIntent: 'connect PostgreSQL for golden-path e2e',
        taskType: 'config/db',
        contextTags: ['postgresql', 'golden-path'],
        runtimeLineage: {
          schema: 'runtime-lineage.v1',
          sessionId: SESSION_ID,
          loopRunId: 'loop:tf-0004:e2e:connect',
          traceId: 'trace:tf-0004:e2e:connect',
        },
        steps: [
          { action: 'tool.call', input: { tool: 'psql' }, output: { error: 'connection refused' } },
          { action: 'retry', input: { attempt: 2 }, output: { error: 'connection refused' } },
        ],
        outcome: 'failure',
        rawError: 'could not connect to server: Connection refused (port 5432)',
      });
      const captureB = await hostInvoke<CaptureResult>(app, 'knowledge', 'sekbCaptureTrajectory', {
        taskIntent: 'configure database connection for golden-path e2e',
        taskType: 'config/db',
        contextTags: ['postgresql', 'golden-path'],
        runtimeLineage: {
          schema: 'runtime-lineage.v1',
          sessionId: SESSION_ID,
          loopRunId: 'loop:tf-0004:e2e:configure',
          traceId: 'trace:tf-0004:e2e:configure',
        },
        steps: [
          { action: 'tool.call', input: { tool: 'pg_isready' }, output: { ok: false } },
          { action: 'inspect', input: { file: 'pg_hba.conf' }, output: { note: 'local trust missing' } },
        ],
        outcome: 'failure',
        rawError: 'Connection refused while connecting to PostgreSQL',
      });

      expect(captureA.available, `captureA unavailable: ${captureA.reason ?? captureA.error}`).toBe(true);
      expect(captureB.available, `captureB unavailable: ${captureB.reason ?? captureB.error}`).toBe(true);
      expect(captureA.trajectoryId).toBeTruthy();
      expect(captureB.trajectoryId).toBeTruthy();
      expect(captureA.compressed).toBe(true);
      expect((captureA.stepCount ?? 0) > 0).toBe(true);

      const trajectoryIds = [captureA.trajectoryId!, captureB.trajectoryId!];

      // Baseline recall before confirm should not hit a confirmed golden-path principle
      const beforeRecall = await hostInvoke<RetrieveResult>(app, 'knowledge', 'sekbRetrieveForTask', {
        taskIntent: 'configure database connection postgresql',
        taskType: 'config/db',
        contextTags: ['postgresql', 'golden-path'],
        topK: 5,
      });
      expect(beforeRecall.available).toBe(true);
      const beforeInjection = beforeRecall.injection;
      expect(beforeInjection.includes('golden-path e2e')).toBe(false);

      // --- candidate (advisory only) ---
      const suggest = await hostInvoke<SuggestResult>(app, 'knowledge', 'sekbSuggestPrinciples', {
        trajectoryIds,
        minClusterSize: 2,
      });
      expect(suggest.available, `suggest unavailable: ${suggest.reason}`).toBe(true);
      expect(suggest.mode).toBe('deterministic');
      expect(suggest.suggestions.length).toBeGreaterThanOrEqual(1);

      // Suggest must not write principles → still no golden-path e2e title in injection
      const midRecall = await hostInvoke<RetrieveResult>(app, 'knowledge', 'sekbRetrieveForTask', {
        taskIntent: 'configure database connection postgresql',
        taskType: 'config/db',
        contextTags: ['postgresql', 'golden-path'],
        topK: 5,
      });
      expect(midRecall.injection.includes('golden-path e2e')).toBe(false);

      // --- filter + human confirm + persist ---
      const suggestion = suggest.suggestions[0];
      const confirm = await hostInvoke<ConfirmResult>(app, 'knowledge', 'sekbConfirmPrinciple', {
        suggestion,
        sessionId: SESSION_ID,
        sourceSystem: 'ui-confirm',
        integrityClaim: 'confirmed',
        edits: {
          title: 'Check PostgreSQL access before retrying (golden-path e2e)',
          condition: 'When PostgreSQL reports Connection refused during config/db tasks',
          action: 'Verify service is running, pg_hba.conf allows the client, and firewall rules permit port 5432',
          reason: 'Repeated connection refusals across similar trajectories indicate environment/config before code bugs',
          criticality: 'high',
          pinned: true,
        },
      });

      expect(confirm.available, `confirm unavailable: ${confirm.reason ?? confirm.error}`).toBe(true);
      expect(confirm.principleId).toBeTruthy();
      expect(confirm.provenance?.schema).toBe('sekb-confirm-provenance.v1');
      expect(confirm.provenance?.sessionId).toBe(SESSION_ID);
      expect(confirm.provenance?.sourceTrajectoryIds?.length).toBeGreaterThan(0);

      // --- recall + behavior delta ---
      const afterRecall = await hostInvoke<RetrieveResult>(app, 'knowledge', 'sekbRetrieveForTask', {
        taskIntent: 'configure database connection postgresql',
        taskType: 'config/db',
        contextTags: ['postgresql', 'golden-path'],
        topK: 5,
      });
      expect(afterRecall.available).toBe(true);
      expect(afterRecall.principles.some((p) => p.principle_id === confirm.principleId)).toBe(true);
      expect(afterRecall.injection).toContain('golden-path e2e');
      expect(afterRecall.injection).not.toBe(beforeInjection);
      const changed =
        afterRecall.injection !== beforeInjection
        && afterRecall.injection.includes('golden-path e2e');
      expect(changed).toBe(true);

      const evidence = {
        schema: 'sekb-golden-path.v1',
        taskId: 'TF-0004',
        ok: true,
        autoWriteback: false,
        writtenAt: new Date().toISOString(),
        surface: 'electron-host-api',
        stages: [
          {
            stage: 'execute',
            ok: true,
            detail: { trajectoryIds, stepCounts: [captureA.stepCount, captureB.stepCount] },
          },
          {
            stage: 'compress',
            ok: true,
            detail: { compressed: [captureA.compressed, captureB.compressed] },
          },
          {
            stage: 'candidate',
            ok: true,
            detail: { suggestions: suggest.suggestions.length, mode: suggest.mode },
          },
          {
            stage: 'filter',
            ok: true,
            detail: { selectedCluster: suggestion.cluster_summary, confidence: suggestion.confidence },
          },
          {
            stage: 'confirm',
            ok: true,
            detail: {
              principleId: confirm.principleId,
              dcsWrite: confirm.dcsWrite,
              sessionId: SESSION_ID,
            },
          },
          {
            stage: 'persist',
            ok: true,
            detail: { principleId: confirm.principleId },
          },
          {
            stage: 'recall',
            ok: true,
            detail: {
              hitIds: afterRecall.principles.map((p) => p.principle_id),
              matched: afterRecall.principles.some((p) => p.principle_id === confirm.principleId),
            },
          },
          {
            stage: 'behavior_delta',
            ok: changed,
            detail: {
              beforeChars: beforeInjection.length,
              afterChars: afterRecall.injection.length,
              deltaChars: afterRecall.injection.length - beforeInjection.length,
            },
          },
          {
            stage: 'evaluate',
            ok: true,
            detail: {
              writeOccurredOnlyAfterConfirm: true,
              noAutoWriteback: true,
            },
          },
        ],
        lineage: {
          sessionId: SESSION_ID,
          sourceTrajectoryIds: confirm.provenance?.sourceTrajectoryIds ?? suggestion.source_trajectory_ids,
          principleId: confirm.principleId,
          provenance: confirm.provenance,
          dcsWrite: confirm.dcsWrite ?? null,
          highTrustEligible: confirm.highTrustEligible ?? null,
        },
        behaviorDelta: {
          beforeInjection,
          afterInjection: afterRecall.injection,
          changed,
          deltaChars: afterRecall.injection.length - beforeInjection.length,
        },
        evaluation: {
          chainComplete: true,
          writeOccurredOnlyAfterConfirm: true,
          recallMatchedConfirmedPrinciple: true,
          behaviorChangedAfterPersist: changed,
          noAutoWriteback: true,
        },
        policy: {
          autoWriteback: false,
          humanConfirmRequired: true,
          defaultOn: false,
          jointSystemGa: false,
        },
      };

      await mkdir(ARTIFACT_DIR, { recursive: true });
      await writeFile(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      expect(evidence.stages.every((s) => s.ok)).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
