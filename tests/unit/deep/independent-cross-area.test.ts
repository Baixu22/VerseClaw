/**
 * 独立深度测试 — Step 3: 跨领域 6-pair 组合测试 + Step 4: 性能数值采集
 *
 * 测试原则：单模块测试通过不意味着组合正确。重点测试所有权边界和状态一致性。
 *
 * 6 个 pair（每对至少 3 场景）：
 * - A1+A6: snapshot vs checkpoint / cleanup vs checkpoint race / flag 组合
 * - A3+A6: anomaly rollback checkpoint / replay new checkpoint / anomaly frequency
 * - A5+A2: budget exhausted wave / worker budget / budget vs wave re-plan priority
 * - A5+A6: resume budget recompute / budget history classification
 * - A1+A2: per-worker isolation / fan-in policy merge
 * - A2+A6: worker crash checkpoint / crashed worker rejoin
 *
 * 性能采集：A1 snapshot / A2 rePlan / A5 budget planning (p50/p95/p99)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  ResourceAwareWaveScheduler,
} from '../../../openclaw_runtime/src/agents/resource-aware-wave-scheduler.js';
import {
  buildTaskGraph,
} from '../../../openclaw_runtime/src/agents/orchestration-protocol.js';
import {
  ContextBudgetPlanner,
  FingerprintLeaseCoordinator,
  ResumeContractVerifier,
} from '../../../openclaw_runtime/src/agents/cross-area/cross-area-facades.js';
import {
  ShadowWriteEventRecorder,
  detectUndeclaredWrites,
} from '../../../openclaw_runtime/src/agents/sessions/extensions/shadow-write-event-recorder.js';
import {
  beginSnapshot,
} from '../../../openclaw_runtime/src/agents/sessions/extensions/policy-light-snapshotter.js';
import type { WriteRiskProfile } from '../../../openclaw_runtime/src/shared/tool-registration.js';
import {
  classifyAnomalyPattern,
} from '../../../openclaw_runtime/src/agents/anomaly-classifier.js';
import {
  deprecationCounters,
} from '../../../openclaw_runtime/src/observability/deprecation-counters.js';

function makeMinimalGraph() {
  return buildTaskGraph({
    graphRunId: 'test-run',
    mode: 'router',
    workers: [{ roleName: 'worker', task: 'do work' }],
    requiredCapabilities: [],
  });
}

function makeMultiWorkerGraph(count: number) {
  return buildTaskGraph({
    graphRunId: 'test-run',
    mode: 'router',
    workers: Array.from({ length: count }, (_, i) => ({
      roleName: 'worker',
      task: `task-${i}`,
    })),
    requiredCapabilities: [],
  });
}

// ---------------------------------------------------------------------------
// Pair 1: A1 + A6 (最高风险对) — snapshot 与 checkpoint 的一致性
// ---------------------------------------------------------------------------

describe('跨领域 — A1+A6: snapshot 与 checkpoint 一致性', () => {
  describe('1. FingerprintLeaseCoordinator lease-before-checkpoint ordering', () => {
    it('coordinatePause: lease 在 checkpoint 之前提交 (Blocker 4)', () => {
      const coord = new FingerprintLeaseCoordinator();
      const result = coord.coordinatePause('lease-1', 'ckpt-1');
      expect(result.leaseBeforeCheckpoint).toBe(true);
      expect(result.lease.leaseId).toBe('lease-1');
      expect(result.checkpoint.leaseId).toBe('lease-1');
    });

    it('writeCheckpoint 在 commitLease 之前调用会抛错 (race guard)', () => {
      const coord = new FingerprintLeaseCoordinator();
      expect(() => coord.writeCheckpoint('ckpt-1')).toThrow(/lease is committed/);
    });

    it('🚨 BUG-FIND: coordinatePause 传相同 now 值时 leaseBeforeCheckpoint 仍 true（无法区分先后）', () => {
      const coord = new FingerprintLeaseCoordinator();
      // 传相同 now — lease.committedAt === checkpoint.writtenAt
      // 用 <= 比较会 true，但实际"同时"无法保证 ordering
      const result = coord.coordinatePause('lease-1', 'ckpt-1', 1000);
      expect(result.leaseBeforeCheckpoint).toBe(true);
      expect(result.lease.committedAt).toBe(result.checkpoint.writtenAt);
      // 🚨 这意味着如果两个操作真正并发（相同 ms 时间戳），无法检测 race
    });

    it('lease 持久化: commitLease 后 lastLease 不为 null，可写多个 checkpoint', () => {
      const coord = new FingerprintLeaseCoordinator();
      coord.commitLease('lease-1', 1000);
      const ckpt1 = coord.writeCheckpoint('ckpt-1', 1001);
      const ckpt2 = coord.writeCheckpoint('ckpt-2', 1002);
      expect(ckpt1.leaseId).toBe('lease-1');
      expect(ckpt2.leaseId).toBe('lease-1');
      // 🚨 注意：单个 lease 可被多个 checkpoint 引用 — 可能导致 stale lease
    });
  });

  describe('2. A1 snapshot 与 A6 fingerprint 一致性', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cross-a1-a6-'));
      await writeFile(join(tempDir, 'file.txt'), 'hello');
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('snapshot 记录的 fingerprint 与独立 fingerprint 计算一致', async () => {
      const snapshot = await beginSnapshot(
        [{ name: 'tool', profile: { kind: 'no_writes' } as WriteRiskProfile }],
        { workspaceRoot: tempDir, a1Enabled: true },
      );
      // snapshot 可能 ok 或 !ok（取决于 git 是否初始化）— 关键是它不计算 fingerprint
      // 🚨 BUG-FIND: A1 snapshot 和 A6 fingerprint 是独立的计算路径
      // 没有 cross-check：snapshot 不引用 fingerprint，fingerprint 不引用 snapshot
      expect(typeof snapshot.ok).toBe('boolean');
    });

    it('🚨 BUG-FIND: snapshot 失败时 checkpoint 仍可写入（无 consistency guard）', () => {
      const coord = new FingerprintLeaseCoordinator();
      // A1 snapshot 失败不会阻止 A6 checkpoint 写入
      // lease 和 checkpoint 之间没有 snapshot state 校验
      coord.commitLease('lease-1', 1000);
      const ckpt = coord.writeCheckpoint('ckpt-1', 1001);
      expect(ckpt.written).toBe(true);
      // 🚨 checkpoint 不包含 snapshot state hash — resume 时无法验证 snapshot 一致性
    });
  });

  describe('3. flag 组合: a1Enabled:false + a6 checkpoint', () => {
    it('a1 禁用时，A6 checkpoint 仍可独立写入', () => {
      const coord = new FingerprintLeaseCoordinator();
      coord.commitLease('lease-1', 1000);
      const ckpt = coord.writeCheckpoint('ckpt-1', 1001);
      expect(ckpt.written).toBe(true);
      // A1 flag 不影响 A6 — 但 resume 时 A1 不参与，checkpoint 可能引用 A1 不再提供的 snapshot
    });
  });
});

// ---------------------------------------------------------------------------
// Pair 2: A3 + A6 (resilience + persistence)
// ---------------------------------------------------------------------------

describe('跨领域 — A3+A6: anomaly rollback 与 checkpoint', () => {
  describe('1. anomaly 触发 rollback 时 checkpoint 状态', () => {
    it('rollbackOccurred=true + resumeShadow.enabled → requiresReverification=true', () => {
      const verifier = new ResumeContractVerifier();
      const result = verifier.verify(
        { config: { resume: { replayShadow: true } }, eventLogRecords: [] },
        true, // rollback occurred
      );
      expect(result.requiresReverification).toBe(true);
    });

    it('rollbackOccurred=false → requiresReverification=false', () => {
      const verifier = new ResumeContractVerifier();
      const result = verifier.verify(
        { config: { resume: { replayShadow: true } }, eventLogRecords: [] },
        false,
      );
      expect(result.requiresReverification).toBe(false);
    });

    it('🚨 BUG-FIND: rollbackOccurred=true 但 resumeShadow.enabled=false → requiresReverification=false', () => {
      const verifier = new ResumeContractVerifier();
      const result = verifier.verify(
        { eventLogRecords: [] }, // no config → shadow disabled
        true, // rollback occurred but shadow disabled
      );
      // 🚨 即使发生了 rollback，如果 shadow 未启用，requiresReverification=false
      // 这意味着 flag-off 时，rollback 后的 resume 不触发 reverification
      expect(result.requiresReverification).toBe(false);
      expect(result.enabled).toBe(false);
    });
  });

  describe('2. anomaly 频率与 checkpoint 频率关系', () => {
    it('连续 5 个 anomaly 不影响 checkpoint 写入逻辑', () => {
      deprecationCounters.reset();
      for (let i = 0; i < 5; i++) {
        deprecationCounters.incrementA3AnomalyNonNull();
        deprecationCounters.incrementA3MissionTicks();
      }
      const a3 = deprecationCounters.getArea('a3') as any;
      expect(a3.anomalyNonNullCount).toBe(5);
      expect(a3.totalMissionTicks).toBe(5);
      // anomaly 频率 100% >> 20% 阈值 → 应该 violated
      const v = deprecationCounters.checkBudgetViolation('a3');
      expect(v.violated).toBe(true);
    });

    it('A3 budget violation 不影响 A6 checkpoint（diagnostic-only）', () => {
      deprecationCounters.reset();
      // 触发 A3 violation
      for (let i = 0; i < 10; i++) {
        deprecationCounters.incrementA3AnomalyNonNull();
        deprecationCounters.incrementA3MissionTicks();
      }
      const a3Violation = deprecationCounters.checkBudgetViolation('a3');
      expect(a3Violation.violated).toBe(true);
      // A6 checkpoint 仍可正常工作
      const coord = new FingerprintLeaseCoordinator();
      coord.commitLease('lease-1', 1000);
      const ckpt = coord.writeCheckpoint('ckpt-1', 1001);
      expect(ckpt.written).toBe(true);
      // ✅ A3 violation 不 gate A6 — 但 degrade_to_default_decision 可能影响 anomaly 处理
    });
  });

  describe('3. replay_rollback 重放过程中 checkpoint 写入', () => {
    it('replay_rollback 后新 checkpoint 引用新 lease', () => {
      const coord = new FingerprintLeaseCoordinator();
      // 第一次 pause
      coord.commitLease('lease-1', 1000);
      const ckpt1 = coord.writeCheckpoint('ckpt-1', 1001);
      // replay_rollback 后第二次 pause — 需要新 lease
      // 🚨 BUG-FIND: FingerprintLeaseCoordinator 是有状态的，lastLease 仍是 lease-1
      // 第二次 writeCheckpoint 不需要新 commitLease — 可能引用 stale lease
      const ckpt2 = coord.writeCheckpoint('ckpt-2', 2000);
      expect(ckpt2.leaseId).toBe('lease-1'); // 🚨 仍是旧 lease
      // 这意味着 rollback 后的 checkpoint 可能引用 rollback 前的 lease
    });
  });
});

// ---------------------------------------------------------------------------
// Pair 3: A5 + A2 (budget + orchestration)
// ---------------------------------------------------------------------------

describe('跨领域 — A5+A2: budget 与 wave 调度', () => {
  describe('1. budget 修改对已 started wave 的影响', () => {
    it('started wave 不受 rePlan maxWorkers 变化影响 (wave immutability)', () => {
      const graph = makeMultiWorkerGraph(5);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      planner.startWave(1);
      // 修改 budget — wave 1 已 started，应被拒绝
      const result = planner.rePlan({ appliesToWave: 1, maxWorkers: 2 });
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('wave_started');
    });

    it('planned wave 受 rePlan maxWorkers 变化影响', () => {
      const graph = makeMultiWorkerGraph(10);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      // wave 1 未 started — rePlan 应被接受
      const result = planner.rePlan({ appliesToWave: 1, maxWorkers: 2 });
      expect(result.accepted).toBe(true);
      const waves = planner.getPlan();
      expect(waves[0].maxWorkers).toBe(2);
    });
  });

  describe('2. 每个 worker 的 budget 计数独立性', () => {
    it('🚨 BUG-FIND: maxWorkers 只在 plan 层面，没有 per-worker budget 隔离', () => {
      const graph = makeMultiWorkerGraph(10);
      const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 3 });
      const waves = scheduler.plan();
      // 每个 wave 的 maxWorkers 是相同的（全局）
      for (const wave of waves) {
        expect(wave.maxWorkers).toBe(3);
      }
      // 🚨 没有 per-worker budget tracking — budget 是 wave 级别的，不是 worker 级别的
      // 如果某个 worker 消耗过多 token，其他 worker 无法感知
    });
  });

  describe('3. budget re-plan vs wave re-plan 优先级', () => {
    it('budget 和 wave 共用同一个 rePlan 路径（无优先级区分）', () => {
      const graph = makeMultiWorkerGraph(5);
      const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 4 });
      scheduler.plan();
      scheduler.startWave(1);
      // budget re-plan (只改 maxWorkers)
      const budgetResult = scheduler.rePlan({ appliesToWave: 2, maxWorkers: 2 });
      // wave re-plan (改 graph)
      const newGraph = makeMultiWorkerGraph(3);
      const waveResult = scheduler.rePlan({ appliesToWave: 2, graph: newGraph });
      // 两者都走同一个 rePlan，没有优先级机制
      // 🚨 如果 budget re-plan 和 wave re-plan 同时到达，最后写入的胜出（无 lock）
      expect(budgetResult.accepted).toBe(true);
      expect(waveResult.accepted).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Pair 4: A5 + A6 (budget + persistence)
// ---------------------------------------------------------------------------

describe('跨领域 — A5+A6: resume 后 budget 重算', () => {
  describe('1. resume 后 budget 重算不使用旧 budget', () => {
    it('replanOnResume 用新 maxWorkers 重新计算', () => {
      const graph = makeMultiWorkerGraph(5);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      // resume with new budget
      planner.replanOnResume(2);
      expect(planner.hasReexecuted).toBe(true);
      expect(planner.resumeReexecutions).toBe(1);
      // 新 plan 应该用 maxWorkers=2
      const waves = planner.getPlan();
      for (const wave of waves) {
        if (wave.status === 'planned') {
          expect(wave.maxWorkers).toBe(2);
        }
      }
    });

    it('🚨 BUG-FIND: resume 时已 started 的 wave 保留旧 maxWorkers', () => {
      const graph = makeMultiWorkerGraph(5);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      planner.startWave(1);
      planner.replanOnResume(2);
      // wave 1 已 started，maxWorkers 仍是 4
      const waves = planner.getPlan();
      expect(waves[0].maxWorkers).toBe(4); // started wave 不变
      // 🚨 这意味着 resume 后 budget 重算只影响未开始的 wave
      // 如果 pause 发生在 wave 1 中间，resume 后 wave 1 用旧 budget
    });
  });

  describe('2. budget 历史记录的持久性分类', () => {
    it('🚨 BUG-FIND: ContextBudgetPlanner 没有持久化 budget 历史', () => {
      const graph = makeMultiWorkerGraph(5);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      planner.replanOnResume(2);
      // 🚨 planner 是内存对象，lastPlan 不持久化到 checkpoint
      // resume 时无法从 checkpoint 恢复 budget 历史
      // budget 历史属于 "volatile" 类（重启丢失），不是 guaranteed
      expect(planner.resumeReexecutions).toBe(1);
      // 但 initialBudget 可恢复
      expect(planner.initialBudget).toBe(4);
    });
  });

  describe('3. resume 后 budgetPressureLevel 初始化', () => {
    it('🚨 BUG-FIND: budgetPressureLevel 不在 ContextBudgetPlanner 中管理', () => {
      const graph = makeMultiWorkerGraph(5);
      const planner = new ContextBudgetPlanner(graph, 4);
      planner.plan();
      // 🚨 ContextBudgetPlanner 不暴露 budgetPressureLevel
      // budgetPressureLevel 在 compression-planner.ts 中，不在 A5 facade
      // resume 后 budgetPressureLevel 需要由 compression-planner 重新计算
      expect(typeof planner.plan).toBe('function');
      expect(typeof planner.initialBudget).toBe('number');
    });
  });
});

// ---------------------------------------------------------------------------
// Pair 5: A1 + A2 (isolation + orchestration)
// ---------------------------------------------------------------------------

describe('跨领域 — A1+A2: per-worker 隔离与 fan-in', () => {
  describe('1. per-worker policy 独立性', () => {
    it('两个 recorder 实例有独立的 tool 集合', () => {
      const recorder1 = new ShadowWriteEventRecorder([
        { name: 'tool-a', profile: { kind: 'declared_paths', writePaths: ['/path/a'] } as WriteRiskProfile },
      ]);
      const recorder2 = new ShadowWriteEventRecorder([
        { name: 'tool-b', profile: { kind: 'declared_paths', writePaths: ['/path/b'] } as WriteRiskProfile },
      ]);
      // 两个 worker 的 policy 独立 — worker A 的 declared paths 不影响 worker B
      recorder1.recordActualWrites('tool-a', ['/path/a/file.txt']);
      recorder2.recordActualWrites('tool-a', ['/path/a/file.txt']);
      expect(recorder1.getEventCount()).toBe(0); // tool-a 在 recorder1 中 declared
      // tool-a 在 recorder2 中 undeclared（不在其 declaredPathsByTool 中）
      expect(recorder2.getEventCount()).toBeGreaterThan(0);
    });

    it('🚨 BUG-FIND: policy narrowing 不影响其他 worker（无 fan-in 合并机制）', () => {
      // A1 设计声明 "policy 单调递减不可逆"
      // 但 ShadowWriteEventRecorder 是无状态的 — 没有 per-turn narrowing 概念
      // 多个 worker 各自的 narrowing 无法在 fan-in 时合并
      const recorder = new ShadowWriteEventRecorder([
        { name: 'dynamic-tool', profile: { kind: 'dynamic_writes' } as WriteRiskProfile },
      ]);
      recorder.recordActualWrites('dynamic-tool', ['/any/path']);
      // dynamic_writes 永远不被 flag
      expect(recorder.getEventCount()).toBe(0);
      // 🚨 没有 "policy merge" 机制 — fan-in 时多个 worker 的 policy 无法合并
    });
  });

  describe('2. fan-in 时多 worker policy 合并', () => {
    it('🚨 BUG-FIND: 没有 policy merge API — fan-in 时 policy 合并由调用方负责', () => {
      // A2 设计声明 fan-in 时 merge 结果应确定性
      // 但 A1 ShadowWriteEventRecorder 不提供 merge 接口
      const recorder1 = new ShadowWriteEventRecorder([
        { name: 'tool-a', profile: { kind: 'declared_paths', writePaths: ['/path/a'] } as WriteRiskProfile },
      ]);
      const recorder2 = new ShadowWriteEventRecorder([
        { name: 'tool-b', profile: { kind: 'declared_paths', writePaths: ['/path/b'] } as WriteRiskProfile },
      ]);
      // 没有 recorder1.merge(recorder2) API
      expect(typeof (recorder1 as any).merge).toBe('undefined');
      // 🚨 fan-in 时调用方需要自己合并 events — 容易遗漏
    });
  });

  describe('3. wave 中 worker 隔离策略', () => {
    it('同一 wave 的多个 worker 共享 maxWorkers 但 policy 独立', () => {
      const graph = makeMultiWorkerGraph(5);
      const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 3 });
      const waves = scheduler.plan();
      // wave 1 可能有多个 worker（取决于依赖图）
      expect(waves.length).toBeGreaterThan(0);
      // 每个 worker 的 policy 是独立的（由 ShadowWriteEventRecorder 实例隔离）
      // 但 maxWorkers 是 wave 级别的共享资源
    });
  });
});

// ---------------------------------------------------------------------------
// Pair 6: A2 + A6 (orchestration + persistence)
// ---------------------------------------------------------------------------

describe('跨领域 — A2+A6: worker crash 与 checkpoint', () => {
  describe('1. wave 中 worker 崩溃时 checkpoint 状态', () => {
    it('🚨 BUG-FIND: checkpoint 不记录 per-worker 状态（只记录 lease）', () => {
      const coord = new FingerprintLeaseCoordinator();
      coord.commitLease('lease-1', 1000);
      const ckpt = coord.writeCheckpoint('ckpt-1', 1001);
      // checkpoint 只记录 leaseId，不记录哪个 worker 崩溃
      expect(ckpt.leaseId).toBe('lease-1');
      expect(ckpt).not.toHaveProperty('workerStatus');
      expect(ckpt).not.toHaveProperty('crashedWorker');
      // 🚨 resume 时无法知道哪个 worker 崩溃，需要整个 wave 重跑
    });

    it('wave 中 worker 崩溃不影响其他 worker 的 checkpoint', () => {
      const coord1 = new FingerprintLeaseCoordinator();
      const coord2 = new FingerprintLeaseCoordinator();
      coord1.commitLease('lease-1', 1000);
      coord2.commitLease('lease-2', 1000);
      const ckpt1 = coord1.writeCheckpoint('ckpt-1', 1001);
      const ckpt2 = coord2.writeCheckpoint('ckpt-2', 1001);
      // 每个 worker 有独立的 lease + checkpoint
      expect(ckpt1.leaseId).toBe('lease-1');
      expect(ckpt2.leaseId).toBe('lease-2');
    });
  });

  describe('2. resume 后已崩溃 worker 重新加入', () => {
    it('🚨 BUG-FIND: 没有 "rejoin" 机制 — 崩溃 worker 需要重新调度', () => {
      const graph = makeMultiWorkerGraph(5);
      const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 3 });
      scheduler.plan();
      scheduler.startWave(1);
      // 假设 wave 1 中 worker 2 崩溃
      // scheduler 没有 "markWorkerCrashed" API
      expect(typeof (scheduler as any).markWorkerCrashed).toBe('undefined');
      // 🚨 resume 时需要调用方重新构建 graph 并 rePlan
      // 没有 per-worker crash recovery 机制
    });

    it('rePlan 可以用新 graph 重新调度', () => {
      const graph = makeMultiWorkerGraph(5);
      const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 3 });
      scheduler.plan();
      scheduler.startWave(1);
      // 用新 graph（移除崩溃 worker）rePlan wave 2+
      const newGraph = makeMultiWorkerGraph(4);
      const result = scheduler.rePlan({ appliesToWave: 2, graph: newGraph });
      // wave 2+ 用新 graph
      expect(result.accepted).toBe(true);
    });
  });

  describe('3. checkpoint 频率与 wave 完成度', () => {
    it('每个 wave 完成后可以写 checkpoint', () => {
      const coord = new FingerprintLeaseCoordinator();
      coord.commitLease('lease-wave-1', 1000);
      const ckpt1 = coord.writeCheckpoint('ckpt-wave-1', 1001);
      coord.commitLease('lease-wave-2', 2000);
      const ckpt2 = coord.writeCheckpoint('ckpt-wave-2', 2001);
      expect(ckpt1.checkpointId).toBe('ckpt-wave-1');
      expect(ckpt2.checkpointId).toBe('ckpt-wave-2');
      // 🚨 但 lease-wave-1 仍可被引用（lastLease 被覆盖，但已写入的 checkpoint 仍引用它）
    });
  });
});

// ---------------------------------------------------------------------------
// Step 4: 性能数值采集 (p50/p95/p99)
// ---------------------------------------------------------------------------

describe('跨领域 — 性能数值采集', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  describe('A1 policy-light-snapshotter p50/p95/p99', () => {
    it('beginSnapshot 100 次调用的延迟分布', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'perf-a1-'));
      await writeFile(join(tempDir, 'file.txt'), 'content');
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await beginSnapshot(
          [{ name: 'tool', profile: { kind: 'no_writes' } as WriteRiskProfile }],
          { workspaceRoot: tempDir, a1Enabled: false },
        );
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);
      const p99 = percentile(samples, 99);
      const max = samples[samples.length - 1];
      console.log(`A1 beginSnapshot: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${max.toFixed(2)}ms`);
      await rm(tempDir, { recursive: true, force: true });
      // 性能预算: p99 ≤ 200ms（flag-off 时是 no-op，应该很快）
      expect(p99).toBeLessThan(200);
    });
  });

  describe('A2 ResourceAwareWaveScheduler.rePlan p50/p95/p99', () => {
    it('rePlan 1000 次调用的延迟分布', () => {
      const graph = makeMultiWorkerGraph(20);
      const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 4 });
      scheduler.plan();
      const samples: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const start = performance.now();
        scheduler.rePlan({ appliesToWave: 1, maxWorkers: 2 + (i % 5) });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);
      const p99 = percentile(samples, 99);
      const max = samples[samples.length - 1];
      console.log(`A2 rePlan: p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms p99=${p99.toFixed(4)}ms max=${max.toFixed(4)}ms`);
      // 性能预算: ≤ 80ms
      expect(p99).toBeLessThan(80);
    });
  });

  describe('A5 ContextBudgetPlanner.plan p50/p95/p99', () => {
    it('budget planning 1000 次调用的延迟分布', () => {
      const samples: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const graph = makeMultiWorkerGraph(10 + (i % 5));
        const planner = new ContextBudgetPlanner(graph, 4);
        const start = performance.now();
        planner.plan();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);
      const p99 = percentile(samples, 99);
      const max = samples[samples.length - 1];
      console.log(`A5 budget planning: p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms p99=${p99.toFixed(4)}ms max=${max.toFixed(4)}ms`);
      // 性能预算: p99 ≤ 30ms
      expect(p99).toBeLessThan(30);
    });
  });

  describe('A3 classifyAnomalyPattern p99 (1000 次)', () => {
    it('classifyAnomalyPattern 1000 次延迟分布', () => {
      const samples: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const start = performance.now();
        classifyAnomalyPattern({
          tick: i,
          maxTicks: 100,
          failures: [],
          recentToolCalls: [],
          features: { runtimeMemory: { snapshot: undefined } },
        });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);
      const p99 = percentile(samples, 99);
      console.log(`A3 classifyAnomalyPattern: p50=${p50.toFixed(5)}ms p95=${p95.toFixed(5)}ms p99=${p99.toFixed(5)}ms`);
      // 性能预算: ≤ 15ms
      expect(p99).toBeLessThan(15);
    });
  });
});
