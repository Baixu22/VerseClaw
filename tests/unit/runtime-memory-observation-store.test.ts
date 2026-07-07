// @vitest-environment node
// Week 3 v2: Observation 索引化 + 增量物化 vs rebuild 一致性 单元测试.
//
// 覆盖 memory-arch-roadmap.md §C.1, §C.2, Week 3 完成定义:
//   1. Observation schema: observationId / key / entityIds[] / timeSpan /
//      supportFactIds[] / canonicalFactId / stats / summary?（≤200 chars）
//   2. 增量物化: updateObservationsIncremental(newEvents[]) 正确更新
//   3. 全量重建: rebuildObservationsFromScratch(allEvents[]) 正确重建
//   4. 一致性: 增量与 rebuild 等价 (核心验收指标)
//   5. 5 种 eventType: ADD / SUPERSEDE / INVALIDATE / MERGE / PRUNE
//   6. summary 限长 ≤200 chars
//   7. 查询接口: getByKey / getById / getByFactId / getByEntityId / getByTimeSpan
import { describe, expect, it } from "vitest";
import {
  assertStoresEqual,
  computeObservationId,
  computeObservationKey,
  enforceSummaryLimit,
  ObservationStore,
  type MemoryMutationEvent,
} from "../../openclaw_runtime/src/runtime-core/memory-observation-store";

// === Helpers ===

function makeAddEvent(overrides: {
  eventId: string;
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  entityIds?: string[];
  validAt: number;
}): MemoryMutationEvent {
  return {
    eventId: overrides.eventId,
    timestamp: overrides.validAt,
    eventType: "ADD",
    payload: {
      factId: overrides.factId,
      subject: overrides.subject,
      predicate: overrides.predicate,
      objectSummary: overrides.objectSummary,
      entityIds: overrides.entityIds,
      validAt: overrides.validAt,
    },
  };
}

function makeSupersedeEvent(overrides: {
  eventId: string;
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  entityIds?: string[];
  validAt: number;
  supersededFactId: string;
}): MemoryMutationEvent {
  return {
    eventId: overrides.eventId,
    timestamp: overrides.validAt,
    eventType: "SUPERSEDE",
    payload: {
      factId: overrides.factId,
      subject: overrides.subject,
      predicate: overrides.predicate,
      objectSummary: overrides.objectSummary,
      entityIds: overrides.entityIds,
      validAt: overrides.validAt,
      supersededFactId: overrides.supersededFactId,
    },
  };
}

function makeInvalidateEvent(overrides: {
  eventId: string;
  factId: string;
  validAt: number;
}): MemoryMutationEvent {
  return {
    eventId: overrides.eventId,
    timestamp: overrides.validAt,
    eventType: "INVALIDATE",
    payload: {
      factId: overrides.factId,
      subject: "",
      predicate: "",
      objectSummary: "",
      validAt: overrides.validAt,
    },
  };
}

function makeMergeEvent(overrides: {
  eventId: string;
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  entityIds?: string[];
  validAt: number;
  mergedFactIds: string[];
}): MemoryMutationEvent {
  return {
    eventId: overrides.eventId,
    timestamp: overrides.validAt,
    eventType: "MERGE",
    payload: {
      factId: overrides.factId,
      subject: overrides.subject,
      predicate: overrides.predicate,
      objectSummary: overrides.objectSummary,
      entityIds: overrides.entityIds,
      validAt: overrides.validAt,
      mergedFactIds: overrides.mergedFactIds,
    },
  };
}

// === 工具函数 ===
describe("utility functions", () => {
  it("computeObservationKey: subject+predicate normalized lowercase", () => {
    expect(computeObservationKey("Jon", "lives_in")).toBe("jon|lives_in");
    expect(computeObservationKey("JON", "LIVES_IN")).toBe("jon|lives_in");
  });

  it("computeObservationId: deterministic hash of key+startTime", () => {
    const id1 = computeObservationId("jon|lives_in", 1000);
    const id2 = computeObservationId("jon|lives_in", 1000);
    const id3 = computeObservationId("jon|lives_in", 2000);
    const id4 = computeObservationId("mary|lives_in", 1000);

    expect(id1).toBe(id2); // 同输入同输出
    expect(id1).not.toBe(id3); // 不同 startTime
    expect(id1).not.toBe(id4); // 不同 key
    expect(id1).toMatch(/^obs_[0-9a-f]+$/);
  });

  it("enforceSummaryLimit: ≤200 chars 原样返回", () => {
    const short = "Jon lives in Boston";
    expect(enforceSummaryLimit(short)).toBe(short);
  });

  it("enforceSummaryLimit: >200 chars 截断 + ...", () => {
    const long = "a".repeat(250);
    const result = enforceSummaryLimit(long);
    expect(result.length).toBe(200);
    expect(result.endsWith("...")).toBe(true);
  });

  it("enforceSummaryLimit: 边界 200 chars 原样返回", () => {
    const exact = "a".repeat(200);
    expect(enforceSummaryLimit(exact).length).toBe(200);
    expect(enforceSummaryLimit(exact).endsWith("...")).toBe(false);
  });

  it("enforceSummaryLimit: 201 chars 截断", () => {
    const over = "a".repeat(201);
    expect(enforceSummaryLimit(over).length).toBe(200);
    expect(enforceSummaryLimit(over).endsWith("...")).toBe(true);
  });
});

// === ADD 事件 ===
describe("ADD event", () => {
  it("首次 ADD 创建新 observation", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "lives in Boston",
        entityIds: ["Boston", "USA"],
        validAt: 1000,
      }),
    ]);

    expect(store.size()).toBe(1);
    const obs = store.getByKey("jon|lives_in");
    expect(obs).toBeDefined();
    if (obs) {
      expect(obs.observationId).toMatch(/^obs_/);
      expect(obs.key).toBe("jon|lives_in");
      expect(obs.entityIds).toEqual(["Boston", "USA"]);
      expect(obs.timeSpan).toEqual({ start: 1000, end: 1000 });
      expect(obs.supportFactIds).toEqual(["f1"]);
      expect(obs.canonicalFactId).toBe("f1");
      expect(obs.stats.supportCount).toBe(1);
      expect(obs.stats.lastEvidenceAt).toBe(1000);
      expect(obs.stats.usageCount).toBe(0);
    }
  });

  it("同 key 第二次 ADD 追加到已有 observation", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "lives in Boston",
        entityIds: ["Boston"],
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "previously lived in NYC",
        entityIds: ["NYC"],
        validAt: 2000,
      }),
    ]);

    expect(store.size()).toBe(1);
    const obs = store.getByKey("jon|lives_in");
    if (obs) {
      expect(obs.supportFactIds).toEqual(["f1", "f2"]);
      expect(obs.stats.supportCount).toBe(2);
      expect(obs.timeSpan).toEqual({ start: 1000, end: 2000 });
      expect(obs.stats.lastEvidenceAt).toBe(2000);
      expect(obs.entityIds).toEqual(["Boston", "NYC"]); // union
    }
  });

  it("不同 subject/predicate 创建独立 observation", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Mary",
        predicate: "works_at",
        objectSummary: "Google",
        validAt: 1000,
      }),
    ]);

    expect(store.size()).toBe(2);
    expect(store.getByKey("jon|lives_in")).toBeDefined();
    expect(store.getByKey("mary|works_at")).toBeDefined();
  });
});

// === SUPERSEDE 事件 ===
describe("SUPERSEDE event", () => {
  it("SUPERSEDE 移除旧 fact, 加入新 fact", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f_old",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "lives in NYC",
        validAt: 1000,
      }),
      makeSupersedeEvent({
        eventId: "e2",
        factId: "f_new",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "moved to Boston",
        validAt: 2000,
        supersededFactId: "f_old",
      }),
    ]);

    const obs = store.getByKey("jon|lives_in");
    if (obs) {
      expect(obs.supportFactIds).toEqual(["f_new"]);
      expect(obs.canonicalFactId).toBe("f_new");
      expect(obs.stats.supportCount).toBe(1);
      // SUPERSEDE 后旧 observation (仅含 f_old) 被删除, 新 observation 创建
      // timeSpan 只反映新 fact 的 validAt (旧 fact 已失效, 不再贡献时间跨度)
      expect(obs.timeSpan).toEqual({ start: 2000, end: 2000 });
    }
    // 旧 fact 反向索引清除
    expect(store.getByFactId("f_old")).toBeUndefined();
    // 新 fact 反向索引建立
    expect(store.getByFactId("f_new")).toBeDefined();
  });

  it("SUPERSEDE 多 fact observation 中只移除一个", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "hiking",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "cooking",
        validAt: 1500,
      }),
      makeSupersedeEvent({
        eventId: "e3",
        factId: "f3",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "now prefers reading",
        validAt: 3000,
        supersededFactId: "f1",
      }),
    ]);

    const obs = store.getByKey("jon|hobby");
    if (obs) {
      expect(obs.supportFactIds).toEqual(["f2", "f3"]); // f1 被移除
      expect(obs.stats.supportCount).toBe(2);
    }
  });
});

// === INVALIDATE 事件 ===
describe("INVALIDATE event", () => {
  it("INVALIDATE 移除 fact, observation 仍有其他 fact → 保留", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "hiking",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "cooking",
        validAt: 1500,
      }),
      makeInvalidateEvent({
        eventId: "e3",
        factId: "f1",
        validAt: 3000,
      }),
    ]);

    const obs = store.getByKey("jon|hobby");
    if (obs) {
      expect(obs.supportFactIds).toEqual(["f2"]);
      expect(obs.stats.supportCount).toBe(1);
      // canonicalFactId 应重选
      expect(obs.canonicalFactId).toBe("f2");
    }
  });

  it("INVALIDATE 移除最后一个 fact → 删除 observation", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "hiking",
        validAt: 1000,
      }),
      makeInvalidateEvent({
        eventId: "e2",
        factId: "f1",
        validAt: 2000,
      }),
    ]);

    expect(store.size()).toBe(0);
    expect(store.getByKey("jon|hobby")).toBeUndefined();
    expect(store.getByFactId("f1")).toBeUndefined();
  });
});

// === MERGE 事件 ===
describe("MERGE event", () => {
  it("MERGE 合并多个 fact 的 evidence 到一个 observation", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "hobby_hiking",
        objectSummary: "hiking mountains",
        entityIds: ["hiking"],
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "hobby_outdoor",
        objectSummary: "outdoor activities",
        entityIds: ["outdoor"],
        validAt: 2000,
      }),
      makeMergeEvent({
        eventId: "e3",
        factId: "f_merged",
        subject: "Jon",
        predicate: "hobby_outdoor",
        objectSummary: "hiking and outdoor activities",
        entityIds: ["hiking", "outdoor", "nature"],
        validAt: 3000,
        mergedFactIds: ["f1", "f2"],
      }),
    ]);

    // 旧 observation (hobby_hiking) 应被清空删除
    expect(store.getByKey("jon|hobby_hiking")).toBeUndefined();
    // 合并后的 observation 存在
    const merged = store.getByKey("jon|hobby_outdoor");
    if (merged) {
      expect(merged.supportFactIds).toContain("f_merged");
      expect(merged.supportFactIds).toContain("f1");
      expect(merged.supportFactIds).toContain("f2");
      expect(merged.stats.supportCount).toBe(3);
      expect(merged.canonicalFactId).toBe("f_merged");
    }
  });
});

// === 查询接口 ===
describe("query interfaces", () => {
  beforeEach(() => {
    // 用 setup 而非重复代码
  });

  it("getById 按 observationId 查找", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        validAt: 1000,
      }),
    ]);

    const obs = store.getByKey("jon|lives_in");
    if (obs) {
      const found = store.getById(obs.observationId);
      expect(found).toBeDefined();
      expect(found?.key).toBe("jon|lives_in");
    }
  });

  it("getByEntityId 按 entityId 查找", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        entityIds: ["Boston", "USA"],
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Mary",
        predicate: "lives_in",
        objectSummary: "NYC",
        entityIds: ["NYC", "USA"],
        validAt: 1000,
      }),
    ]);

    const usaObs = store.getByEntityId("USA");
    expect(usaObs.length).toBe(2); // Jon + Mary 都有 USA

    const bostonObs = store.getByEntityId("Boston");
    expect(bostonObs.length).toBe(1);
    expect(bostonObs[0].key).toBe("jon|lives_in");
  });

  it("getByTimeSpan 按时间跨度筛选", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "job_2020",
        objectSummary: "Google",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "job_2024",
        objectSummary: "Apple",
        validAt: 5000,
      }),
    ]);

    // 查询 [2000, 3000] 区间: job_2020 (timeSpan 1000-1000) 不交集
    // job_2024 (timeSpan 5000-5000) 不交集 → 都不应返回
    const noOverlap = store.getByTimeSpan(2000, 3000);
    expect(noOverlap.length).toBe(0);

    // 查询 [500, 1500] 区间: job_2020 有交集
    const with2020 = store.getByTimeSpan(500, 1500);
    expect(with2020.length).toBe(1);
    expect(with2020[0].key).toBe("jon|job_2020");
  });
});

// === summary 限长 ===
describe("summary length limit", () => {
  it("setSummary ≤200 chars 原样存储", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        validAt: 1000,
      }),
    ]);
    store.setSummary("jon|lives_in", "Jon lives in Boston");

    const obs = store.getByKey("jon|lives_in");
    expect(obs?.summary).toBe("Jon lives in Boston");
  });

  it("setSummary >200 chars 截断 + ...", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        validAt: 1000,
      }),
    ]);
    const longSummary = "a".repeat(250);
    store.setSummary("jon|lives_in", longSummary);

    const obs = store.getByKey("jon|lives_in");
    expect(obs?.summary?.length).toBe(200);
    expect(obs?.summary?.endsWith("...")).toBe(true);
  });
});

// === 增量 vs rebuild 一致性 (核心验收指标) ===
describe("incremental vs rebuild consistency", () => {
  it("纯 ADD 事件: 增量与 rebuild 等价", () => {
    const events: MemoryMutationEvent[] = [
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        entityIds: ["Boston"],
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "USA",
        entityIds: ["USA"],
        validAt: 2000,
      }),
      makeAddEvent({
        eventId: "e3",
        factId: "f3",
        subject: "Mary",
        predicate: "works_at",
        objectSummary: "Google",
        entityIds: ["Google"],
        validAt: 1500,
      }),
    ];

    const incremental = new ObservationStore();
    incremental.updateObservationsIncremental(events);

    const rebuild = new ObservationStore();
    rebuild.rebuildObservationsFromScratch(events);

    const result = assertStoresEqual(incremental, rebuild);
    expect(result.equal).toBe(true);
    expect(result.diffs).toEqual([]);
  });

  it("ADD + SUPERSEDE 事件: 增量与 rebuild 等价", () => {
    const events: MemoryMutationEvent[] = [
      makeAddEvent({
        eventId: "e1",
        factId: "f_old",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "NYC",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f_other",
        subject: "Mary",
        predicate: "job",
        objectSummary: "Google",
        validAt: 1200,
      }),
      makeSupersedeEvent({
        eventId: "e3",
        factId: "f_new",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        validAt: 3000,
        supersededFactId: "f_old",
      }),
    ];

    const incremental = new ObservationStore();
    incremental.updateObservationsIncremental(events);

    const rebuild = new ObservationStore();
    rebuild.rebuildObservationsFromScratch(events);

    const result = assertStoresEqual(incremental, rebuild);
    expect(result.equal).toBe(true);
  });

  it("ADD + INVALIDATE 事件: 增量与 rebuild 等价", () => {
    const events: MemoryMutationEvent[] = [
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "hiking",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "hobby",
        objectSummary: "cooking",
        validAt: 1500,
      }),
      makeInvalidateEvent({
        eventId: "e3",
        factId: "f1",
        validAt: 3000,
      }),
    ];

    const incremental = new ObservationStore();
    incremental.updateObservationsIncremental(events);

    const rebuild = new ObservationStore();
    rebuild.rebuildObservationsFromScratch(events);

    const result = assertStoresEqual(incremental, rebuild);
    expect(result.equal).toBe(true);
  });

  it("ADD + MERGE 事件: 增量与 rebuild 等价", () => {
    const events: MemoryMutationEvent[] = [
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "hobby_hiking",
        objectSummary: "hiking",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "hobby_outdoor",
        objectSummary: "outdoor",
        validAt: 2000,
      }),
      makeMergeEvent({
        eventId: "e3",
        factId: "f_merged",
        subject: "Jon",
        predicate: "hobby_outdoor",
        objectSummary: "hiking and outdoor",
        validAt: 3000,
        mergedFactIds: ["f1", "f2"],
      }),
    ];

    const incremental = new ObservationStore();
    incremental.updateObservationsIncremental(events);

    const rebuild = new ObservationStore();
    rebuild.rebuildObservationsFromScratch(events);

    const result = assertStoresEqual(incremental, rebuild);
    expect(result.equal).toBe(true);
  });

  it("混合事件序列: 增量与 rebuild 等价", () => {
    const events: MemoryMutationEvent[] = [
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        entityIds: ["Boston"],
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "USA",
        validAt: 1200,
      }),
      makeAddEvent({
        eventId: "e3",
        factId: "f3",
        subject: "Mary",
        predicate: "job",
        objectSummary: "Google",
        validAt: 1500,
      }),
      makeSupersedeEvent({
        eventId: "e4",
        factId: "f4",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "moved to NYC",
        validAt: 3000,
        supersededFactId: "f1",
      }),
      makeInvalidateEvent({
        eventId: "e5",
        factId: "f3",
        validAt: 4000,
      }),
      makeMergeEvent({
        eventId: "e6",
        factId: "f5",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "all addresses",
        validAt: 5000,
        mergedFactIds: ["f2", "f4"],
      }),
    ];

    const incremental = new ObservationStore();
    incremental.updateObservationsIncremental(events);

    const rebuild = new ObservationStore();
    rebuild.rebuildObservationsFromScratch(events);

    const result = assertStoresEqual(incremental, rebuild);
    expect(result.equal).toBe(true);
  });

  it("增量分批 vs rebuild 一次性: 等价", () => {
    const events: MemoryMutationEvent[] = [
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "p1",
        objectSummary: "a",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "p2",
        objectSummary: "b",
        validAt: 2000,
      }),
      makeAddEvent({
        eventId: "e3",
        factId: "f3",
        subject: "Mary",
        predicate: "p3",
        objectSummary: "c",
        validAt: 3000,
      }),
      makeSupersedeEvent({
        eventId: "e4",
        factId: "f4",
        subject: "Jon",
        predicate: "p1",
        objectSummary: "d",
        validAt: 4000,
        supersededFactId: "f1",
      }),
    ];

    // 增量: 分 3 批
    const incremental = new ObservationStore();
    incremental.updateObservationsIncremental([events[0]]);
    incremental.updateObservationsIncremental([events[1], events[2]]);
    incremental.updateObservationsIncremental([events[3]]);

    // rebuild: 一次性
    const rebuild = new ObservationStore();
    rebuild.rebuildObservationsFromScratch(events);

    const result = assertStoresEqual(incremental, rebuild);
    expect(result.equal).toBe(true);
  });
});

// === usageCount 增量 ===
describe("usageCount", () => {
  it("incrementUsage 增加 usageCount", () => {
    const store = new ObservationStore();
    store.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston",
        validAt: 1000,
      }),
    ]);

    expect(store.getByKey("jon|lives_in")?.stats.usageCount).toBe(0);
    store.incrementUsage("jon|lives_in");
    store.incrementUsage("jon|lives_in");
    expect(store.getByKey("jon|lives_in")?.stats.usageCount).toBe(2);
  });
});

// === assertStoresEqual diff 检测 ===
describe("assertStoresEqual diff detection", () => {
  it("数量不同 → diff", () => {
    const storeA = new ObservationStore();
    storeA.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "p1",
        objectSummary: "a",
        validAt: 1000,
      }),
    ]);

    const storeB = new ObservationStore();
    storeB.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "p1",
        objectSummary: "a",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Mary",
        predicate: "p2",
        objectSummary: "b",
        validAt: 1000,
      }),
    ]);

    const result = assertStoresEqual(storeA, storeB);
    expect(result.equal).toBe(false);
    expect(result.diffs.length).toBeGreaterThan(0);
  });

  it("supportFactIds 不同 → diff", () => {
    const events: MemoryMutationEvent[] = [
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "Jon",
        predicate: "p1",
        objectSummary: "a",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "Jon",
        predicate: "p1",
        objectSummary: "b",
        validAt: 2000,
      }),
    ];

    const storeA = new ObservationStore();
    storeA.updateObservationsIncremental(events);

    const storeB = new ObservationStore();
    storeB.updateObservationsIncremental([events[0]]); // 只有 f1, 无 f2

    const result = assertStoresEqual(storeA, storeB);
    expect(result.equal).toBe(false);
    expect(
      result.diffs.some((d) => d.includes("supportFactIds")),
    ).toBe(true);
  });
});
