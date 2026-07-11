import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ObservabilityTraceRecorder } from '../../../openclaw_runtime/src/observability/trace-recorder.js';
import {
  ContextBudgetPlanner,
  ResumeContractVerifier,
} from '../../../openclaw_runtime/src/agents/cross-area/cross-area-facades.js';
import { classifyAnomalyPattern } from '../../../openclaw_runtime/src/agents/anomaly-classifier.js';
import {
  validateEventNamespace,
  type ObservabilityAreaPrefix,
} from '../../../openclaw_runtime/src/observability/namespace-governance.js';
import { ShadowWriteEventRecorder } from '../../../openclaw_runtime/src/agents/sessions/extensions/shadow-write-event-recorder.js';
import type { WriteRiskProfile } from '../../../openclaw_runtime/src/shared/tool-registration.js';
import {
  getFileFingerprint,
  computeFileFingerprintsForDirectory,
  diffFileFingerprints,
} from '../../../openclaw_runtime/src/agents/long-task-control/file-fingerprint.js';
import type { OrchestrationTaskGraph } from '../../../openclaw_runtime/src/agents/orchestration-protocol.js';

/**
 * Cross-Area deep tests — composition of A1/A3/A5/A6 observability + persistence.
 *
 * Covers:
 * - observability/trace-recorder.ts (ObservabilityTraceRecorder)
 * - agents/cross-area/cross-area-facades.ts (ContextBudgetPlanner,
 *   ResumeContractVerifier)
 * - agents/anomaly-classifier.ts (classifyAnomalyPattern)
 * - observability/namespace-governance.ts (validateEventNamespace)
 * - agents/sessions/extensions/shadow-write-event-recorder.ts (ShadowWriteEventRecorder)
 * - agents/long-task-control/file-fingerprint.ts (getFileFingerprint, etc.)
 *
 * Note on import depth: tests live in tests/unit/deep/, so the relative path to
 * the runtime tree is ../../../openclaw_runtime/src/... (three levels up to root).
 */

const RESUME_SHADOW_CONFIG = { runtime: { resume: { replayShadow: true } } };
const AREAS: readonly ObservabilityAreaPrefix[] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'core'];

function makeGraph(nodeCount: number): OrchestrationTaskGraph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    taskNodeId: `task-${i + 1}`,
    roleName: 'worker',
    task: `Task ${i + 1}`,
    phase: 'worker' as const,
    dependsOn: [] as string[],
    scope: 'default',
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: 'planned' as const,
  }));
  return {
    graphRunId: 'run-1',
    mode: 'router',
    status: 'planned',
    nodes,
    edges: [],
  };
}

describe('Cross-Area deep — composition and real-world workloads', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cross-area-deep-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. 真实工作负载 (2 tests)
  // -------------------------------------------------------------------------
  describe('真实工作负载', () => {
    it('100-turn session (100 spans + 100 plans + 100 classify) completes in < 5s without crashing', () => {
      const start = Date.now();

      // A1: 100 trace spans.
      const recorder = new ObservabilityTraceRecorder({ name: 'session-100' });
      recorder.start();
      for (let i = 0; i < 100; i++) {
        recorder.startSpan({ name: `turn-${i}`, kind: 'tool' });
      }

      // A5: one accepted resume replan followed by 99 identical no-ops.
      const planner = new ContextBudgetPlanner(makeGraph(5), 4);
      planner.plan();
      for (let i = 0; i < 100; i++) {
        planner.replanOnResume(2);
      }

      // A3: 100 anomaly classifications.
      for (let i = 0; i < 100; i++) {
        classifyAnomalyPattern({
          tick: i,
          repairTicksUsed: 0,
          maxRepairTicks: 0,
          maxTicks: 100,
        });
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000);
      // Verify no crash — all operations produced results.
      expect(recorder.snapshot().spans.length).toBe(100);
      expect(planner.resumeReexecutions).toBe(1);
    });

    it('memory increment after 100-turn session is < 50 MB', () => {
      // S7 fix (P2): use heapUsed (more precise than rss) + multiple samples.
      // rss includes shared memory and is affected by OS-level allocation that
      // doesn't reflect JS heap growth. heapUsed tracks V8's JS heap directly.
      // We sample 3 times and take the median to reduce GC-timing variance.
      const gc = (): void => {
        if (typeof (global as { gc?: () => void }).gc === 'function') {
          (global as { gc: () => void }).gc();
        }
      };

      const samples: number[] = [];
      for (let run = 0; run < 3; run++) {
        gc();
        const before = process.memoryUsage().heapUsed;

        const recorder = new ObservabilityTraceRecorder({ name: `mem-test-${run}` });
        recorder.start();
        for (let i = 0; i < 100; i++) {
          recorder.startSpan({ name: `turn-${i}`, kind: 'tool' });
        }

        const planner = new ContextBudgetPlanner(makeGraph(5), 4);
        planner.plan();
        for (let i = 0; i < 100; i++) {
          planner.replanOnResume(2);
        }

        for (let i = 0; i < 100; i++) {
          classifyAnomalyPattern({
            tick: i,
            repairTicksUsed: 0,
            maxRepairTicks: 0,
            maxTicks: 100,
          });
        }

        gc();
        const after = process.memoryUsage().heapUsed;
        samples.push(after - before);
      }

      // Median of 3 samples reduces GC-timing variance.
      samples.sort((a, b) => a - b);
      const medianDelta = samples[1];
      const deltaMB = medianDelta / (1024 * 1024);
      expect(deltaMB).toBeLessThan(50);
    });
  });

  // -------------------------------------------------------------------------
  // 2. 集成测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('集成测试', () => {
    it('A1+A6 real fs-diff: file modification detected + ShadowWriteEventRecorder detects undeclared writes', async () => {
      const filePath = join(tmpDir, 'target.txt');
      await writeFile(filePath, 'original content');

      // A6: fingerprint before modification.
      const fpBefore = await getFileFingerprint(filePath);
      expect(fpBefore).not.toBeNull();
      const dirBefore = await computeFileFingerprintsForDirectory(tmpDir);

      // Modify the file.
      await writeFile(filePath, 'modified content');

      // A6: fingerprint after modification + diff.
      const fpAfter = await getFileFingerprint(filePath);
      expect(fpAfter).not.toBeNull();
      expect(fpAfter!.sha256).not.toBe(fpBefore!.sha256);

      const dirAfter = await computeFileFingerprintsForDirectory(tmpDir);
      const diff = diffFileFingerprints(dirBefore, dirAfter);
      expect(diff.summary.modifiedCount).toBe(1);

      // A1: ShadowWriteEventRecorder detects undeclared writes.
      const declaredProfile: WriteRiskProfile = {
        kind: 'declared_paths',
        writePaths: ['declared.txt'],
      };
      const shadowRecorder = new ShadowWriteEventRecorder([
        { name: 'writer', profile: declaredProfile },
      ]);
      // The tool wrote to 'target.txt' which is NOT in declared paths.
      shadowRecorder.recordActualWrites('writer', ['target.txt']);
      expect(shadowRecorder.hasEvents()).toBe(true);
      expect(shadowRecorder.getEventCount()).toBe(1);
      expect(shadowRecorder.getEvents()[0].path).toBe('target.txt');
    });

    it('A3+A6 rollback flow: classifyAnomalyPattern → repair_storm → ResumeContractVerifier requires reverification', () => {
      // A3: classify anomaly — repair_storm (7/10 = 0.7 >= 0.6).
      const anomaly = classifyAnomalyPattern({
        tick: 5,
        repairTicksUsed: 7,
        maxRepairTicks: 10,
        maxTicks: 20,
      });
      expect(anomaly).not.toBeNull();
      expect(anomaly!.kind).toBe('repair_storm');

      // A6: ResumeContractVerifier with rollbackOccurred=true → requires reverification.
      const verifier = new ResumeContractVerifier();
      const result = verifier.verify(
        { config: RESUME_SHADOW_CONFIG, taskId: 'task-rollback' },
        true,
      );
      expect(result.enabled).toBe(true);
      expect(result.rollbackOccurred).toBe(true);
      expect(result.requiresReverification).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. 属性测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('属性测试', () => {
    it('trace truncation keeps spans.length ≤ threshold for any span count (threshold=10)', () => {
      for (const spanCount of [5, 15, 50, 100]) {
        const recorder = new ObservabilityTraceRecorder(
          { name: `trunc-${spanCount}` },
          { truncationThreshold: 10 },
        );
        recorder.start();
        for (let i = 0; i < spanCount; i++) {
          recorder.startSpan({ name: `span-${i}`, kind: 'tool' });
        }
        const trace = recorder.snapshot();
        expect(trace.spans.length).toBeLessThanOrEqual(10);
      }
    });

    it('namespace rejection is consistent across all 7×7 area combinations', () => {
      for (const callerArea of AREAS) {
        for (const eventArea of AREAS) {
          const eventName = `claw.${eventArea}.something`;
          const result = validateEventNamespace(eventName, callerArea);
          if (callerArea === eventArea) {
            // Same area → valid (null = no error).
            expect(result).toBeNull();
          } else {
            // Different area → rejected (non-null error string).
            expect(result).not.toBeNull();
            expect(typeof result).toBe('string');
            expect(result).toContain(callerArea);
          }
        }
      }
    });
  });
});
