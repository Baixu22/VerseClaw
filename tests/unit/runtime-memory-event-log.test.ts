// @vitest-environment node
// Week 6 v2: Memory event log 单元测试.
//
// 覆盖 memory-arch-roadmap.md §B6, §D1, E.2 #8/#12, Week 6 完成定义:
// - hash chain 完整性 (append + verifyChain)
// - 篡改检测: 修改任意 event 后 verifyChain 失败
// - REDACT 后内容字段置空, hash chain 仍连续
// - as-of snapshot 重建: 7 种 eventType 正确应用
// - per-user hash chain 隔离
// - getEventsInRange / getRedactionEvents / size
import { describe, expect, it } from "vitest";
import {
  MemoryEventLog,
  type MemoryEvent,
  type MemoryEventPayload,
  verifyChainLink,
  verifyEventHash,
} from "../../openclaw_runtime/src/runtime-core/memory-event-log";

function makeAddPayload(factId: string, subject: string): MemoryEventPayload {
  return {
    factId,
    subject,
    predicate: "lives_in",
    objectSummary: "Boston",
    entityIds: ["e1", "e2"],
    validAt: 1000,
  };
}

describe("MemoryEventLog - hash chain 完整性", () => {
  it("append sets prevHash=genesis for first event", () => {
    const log = new MemoryEventLog("user_1");
    const evt = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
    });
    expect(evt.prevHash).toBe("genesis");
    expect(evt.eventHash).toMatch(/^h_[0-9a-f]+$/);
    expect(evt.eventId).toMatch(/^evt_[0-9a-f]+$/);
    expect(evt.userId).toBe("user_1");
  });

  it("subsequent events chain via prevHash === previous eventHash", () => {
    const log = new MemoryEventLog("user_1");
    const e1 = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    const e2 = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 2000,
    });
    const e3 = log.append({
      eventType: "INVALIDATE",
      payload: { factId: "f1", invalidAt: 3000, reason: "moved" },
      timestamp: 3000,
    });

    expect(e2.prevHash).toBe(e1.eventHash);
    expect(e3.prevHash).toBe(e2.eventHash);
    expect(log.verifyChain()).toBe(true);
  });

  it("verifyChain returns true for empty log", () => {
    const log = new MemoryEventLog("user_1");
    expect(log.verifyChain()).toBe(true);
  });

  it("verifyChain returns true for single-event log", () => {
    const log = new MemoryEventLog("user_1");
    log.append({ eventType: "ADD", payload: makeAddPayload("f1", "Jon") });
    expect(log.verifyChain()).toBe(true);
  });

  it("verifyChain returns false when prevHash is tampered", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 2000,
    });
    // Tamper: mutate the second event's prevHash
    const events = log.getEvents() as MemoryEvent[];
    (events[1] as { prevHash: string }).prevHash = "tampered_hash";
    expect(log.verifyChain()).toBe(false);
  });

  it("verifyChain returns false when eventHash is tampered", () => {
    const log = new MemoryEventLog("user_1");
    log.append({ eventType: "ADD", payload: makeAddPayload("f1", "Jon") });
    const events = log.getEvents() as MemoryEvent[];
    (events[0] as { eventHash: string }).eventHash = "h_tampered";
    expect(log.verifyChain()).toBe(false);
  });

  it("verifyChain returns false when payload is tampered", () => {
    const log = new MemoryEventLog("user_1");
    log.append({ eventType: "ADD", payload: makeAddPayload("f1", "Jon") });
    const events = log.getEvents() as MemoryEvent[];
    (events[0].payload as { subject: string }).subject = "TAMPERED";
    // eventHash unchanged but recomputed from tampered payload won't match
    expect(log.verifyChain()).toBe(false);
  });

  it("verifyChain returns false when first event prevHash is not genesis", () => {
    const log = new MemoryEventLog("user_1");
    log.append({ eventType: "ADD", payload: makeAddPayload("f1", "Jon") });
    const events = log.getEvents() as MemoryEvent[];
    (events[0] as { prevHash: string }).prevHash = "not_genesis";
    expect(log.verifyChain()).toBe(false);
  });
});

describe("MemoryEventLog - 独立工具函数", () => {
  it("verifyEventHash returns true for valid event", () => {
    const log = new MemoryEventLog("user_1");
    const evt = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
    });
    expect(verifyEventHash(evt)).toBe(true);
  });

  it("verifyEventHash returns false for tampered event", () => {
    const log = new MemoryEventLog("user_1");
    const evt = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
    });
    const tampered: MemoryEvent = {
      ...evt,
      payload: { ...evt.payload, subject: "TAMPERED" },
    };
    expect(verifyEventHash(tampered)).toBe(false);
  });

  it("verifyChainLink returns true for consecutive events", () => {
    const log = new MemoryEventLog("user_1");
    const e1 = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    const e2 = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 2000,
    });
    expect(verifyChainLink(e1, e2)).toBe(true);
  });

  it("verifyChainLink returns false for non-consecutive events", () => {
    const log = new MemoryEventLog("user_1");
    const e1 = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    const e2 = log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 2000,
    });
    const tampered: MemoryEvent = { ...e2, prevHash: "wrong" };
    expect(verifyChainLink(e1, tampered)).toBe(false);
  });
});

describe("MemoryEventLog - REDACT 合规处理", () => {
  it("REDACT event clears content fields from payload", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    const redactEvt = log.append({
      eventType: "REDACT",
      payload: {
        factId: "f1",
        subject: "should_be_cleared",
        predicate: "should_be_cleared",
        objectSummary: "should_be_cleared",
        redactionReason: "user_request_gdpr",
      },
      timestamp: 2000,
    });

    expect(redactEvt.payload.factId).toBe("f1");
    expect(redactEvt.payload.subject).toBeUndefined();
    expect(redactEvt.payload.predicate).toBeUndefined();
    expect(redactEvt.payload.objectSummary).toBeUndefined();
    expect(redactEvt.payload.entityIds).toBeUndefined();
    expect(redactEvt.payload.redactionReason).toBe("user_request_gdpr");
    expect(redactEvt.payload.reason).toBe("redacted");
  });

  it("REDACT uses default reason when not provided", () => {
    const log = new MemoryEventLog("user_1");
    const evt = log.append({
      eventType: "REDACT",
      payload: { factId: "f1" },
    });
    expect(evt.payload.redactionReason).toBe("user_request");
    expect(evt.payload.reason).toBe("redacted");
  });

  it("REDACT preserves hash chain continuity", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "REDACT",
      payload: { factId: "f1", redactionReason: "gdpr" },
      timestamp: 2000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 3000,
    });
    expect(log.verifyChain()).toBe(true);
  });

  it("getRedactionEvents returns only REDACT events", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "REDACT",
      payload: { factId: "f1", redactionReason: "gdpr" },
      timestamp: 2000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 3000,
    });
    log.append({
      eventType: "REDACT",
      payload: { factId: "f2", redactionReason: "user_request" },
      timestamp: 4000,
    });

    const redactions = log.getRedactionEvents();
    expect(redactions).toHaveLength(2);
    expect(redactions[0].payload.factId).toBe("f1");
    expect(redactions[1].payload.factId).toBe("f2");
  });

  it("REDACT event removes fact from as-of snapshot", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 2000,
    });
    log.append({
      eventType: "REDACT",
      payload: { factId: "f1", redactionReason: "gdpr" },
      timestamp: 3000,
    });

    const snapshot = log.rebuildAsOfSnapshot(3000);
    expect(snapshot.facts).toHaveLength(1);
    expect(snapshot.facts[0].factId).toBe("f2");
  });
});

describe("MemoryEventLog - as-of snapshot 7 种 eventType", () => {
  it("ADD adds fact to snapshot", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    const snap = log.rebuildAsOfSnapshot(1000);
    expect(snap.facts).toHaveLength(1);
    expect(snap.facts[0].factId).toBe("f1");
    expect(snap.facts[0].subject).toBe("Jon");
  });

  it("SUPERSEDE invalidates old fact and adds new fact", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "SUPERSEDE",
      payload: {
        factId: "f2",
        supersededFactId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "NYC",
        validAt: 2000,
      },
      timestamp: 2000,
    });
    const snap = log.rebuildAsOfSnapshot(2000);
    expect(snap.facts).toHaveLength(2);
    const f1 = snap.facts.find((f) => f.factId === "f1");
    const f2 = snap.facts.find((f) => f.factId === "f2");
    expect(f1?.invalidAt).toBe(2000);
    expect(f2?.invalidAt).toBeUndefined();
    expect(f2?.objectSummary).toBe("NYC");
  });

  it("INVALIDATE marks fact invalidAt", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "INVALIDATE",
      payload: { factId: "f1", invalidAt: 5000, reason: "wrong" },
      timestamp: 5000,
    });
    const snap = log.rebuildAsOfSnapshot(5000);
    expect(snap.facts).toHaveLength(1);
    expect(snap.facts[0].invalidAt).toBe(5000);
  });

  it("MERGE invalidates merged facts and adds new merged fact", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Jon"),
      timestamp: 2000,
    });
    log.append({
      eventType: "MERGE",
      payload: {
        factId: "f_merged",
        mergedFactIds: ["f1", "f2"],
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "Boston (consolidated)",
      },
      timestamp: 3000,
    });
    const snap = log.rebuildAsOfSnapshot(3000);
    expect(snap.facts).toHaveLength(3);
    expect(snap.facts.find((f) => f.factId === "f1")?.invalidAt).toBe(3000);
    expect(snap.facts.find((f) => f.factId === "f2")?.invalidAt).toBe(3000);
    expect(
      snap.facts.find((f) => f.factId === "f_merged")?.invalidAt,
    ).toBeUndefined();
  });

  it("PRUNE removes fact from snapshot", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "PRUNE",
      payload: { factId: "f1", reason: "stale" },
      timestamp: 2000,
    });
    const snap = log.rebuildAsOfSnapshot(2000);
    expect(snap.facts).toHaveLength(0);
  });

  it("STRENGTHEN does not change snapshot content", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "STRENGTHEN",
      payload: { factId: "f1", reason: "extra_evidence" },
      timestamp: 2000,
    });
    const snap = log.rebuildAsOfSnapshot(2000);
    expect(snap.facts).toHaveLength(1);
    expect(snap.facts[0].factId).toBe("f1");
  });

  it("snapshot respects asOfTime cutoff", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 3000,
    });
    const snapAt1500 = log.rebuildAsOfSnapshot(1500);
    expect(snapAt1500.facts).toHaveLength(1);
    expect(snapAt1500.facts[0].factId).toBe("f1");
    expect(snapAt1500.eventCount).toBe(1);

    const snapAt3500 = log.rebuildAsOfSnapshot(3500);
    expect(snapAt3500.facts).toHaveLength(2);
    expect(snapAt3500.eventCount).toBe(2);
  });

  it("snapshot defaults to last event time when asOfTime omitted", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 5000,
    });
    const snap = log.rebuildAsOfSnapshot();
    expect(snap.asOfTime).toBe(5000);
    expect(snap.facts).toHaveLength(2);
  });
});

describe("MemoryEventLog - 其他 API", () => {
  it("getEventsInRange filters by time range inclusive", () => {
    const log = new MemoryEventLog("user_1");
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 2000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f3", "Bob"),
      timestamp: 3000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f4", "Ann"),
      timestamp: 4000,
    });

    const range = log.getEventsInRange(2000, 3000);
    expect(range).toHaveLength(2);
    expect(range.map((e) => e.payload.factId)).toEqual(["f2", "f3"]);
  });

  it("size returns event count", () => {
    const log = new MemoryEventLog("user_1");
    expect(log.size()).toBe(0);
    log.append({ eventType: "ADD", payload: makeAddPayload("f1", "Jon") });
    log.append({ eventType: "ADD", payload: makeAddPayload("f2", "Mary") });
    expect(log.size()).toBe(2);
  });

  it("per-user hash chains are isolated", () => {
    const logA = new MemoryEventLog("user_A");
    const logB = new MemoryEventLog("user_B");
    const eA = logA.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    const eB = logB.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    // 相同 payload + timestamp, 但 userId 不同 → eventHash 不同
    expect(eA.eventHash).not.toBe(eB.eventHash);
    expect(eA.userId).toBe("user_A");
    expect(eB.userId).toBe("user_B");
  });

  it("deterministic eventId for same userId+timestamp+sequence", () => {
    const log1 = new MemoryEventLog("user_1");
    const log2 = new MemoryEventLog("user_1");
    const e1 = log1.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    const e2 = log2.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    // 相同 userId + timestamp + sequence=1 → 相同 eventId + eventHash (确定性)
    expect(e1.eventId).toBe(e2.eventId);
    expect(e1.eventHash).toBe(e2.eventHash);
  });
});

describe("MemoryEventLog - 端到端场景", () => {
  it("full lifecycle: ADD → SUPERSEDE → REDACT → as-of snapshots", () => {
    const log = new MemoryEventLog("user_1");
    // T1: ADD f1
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "Jon"),
      timestamp: 1000,
    });
    // T2: ADD f2
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "Mary"),
      timestamp: 2000,
    });
    // T3: SUPERSEDE f1 with f3
    log.append({
      eventType: "SUPERSEDE",
      payload: {
        factId: "f3",
        supersededFactId: "f1",
        subject: "Jon",
        predicate: "lives_in",
        objectSummary: "NYC",
        validAt: 3000,
      },
      timestamp: 3000,
    });
    // T4: REDACT f2 (GDPR 删除)
    log.append({
      eventType: "REDACT",
      payload: { factId: "f2", redactionReason: "user_request" },
      timestamp: 4000,
    });

    // Chain integrity 全程保持
    expect(log.verifyChain()).toBe(true);

    // T=1500: 只有 f1
    const snap1500 = log.rebuildAsOfSnapshot(1500);
    expect(snap1500.facts.map((f) => f.factId).sort()).toEqual(["f1"]);

    // T=2500: f1 + f2
    const snap2500 = log.rebuildAsOfSnapshot(2500);
    expect(snap2500.facts.map((f) => f.factId).sort()).toEqual(["f1", "f2"]);

    // T=3500: f1 (invalidated) + f2 + f3
    const snap3500 = log.rebuildAsOfSnapshot(3500);
    expect(snap3500.facts.map((f) => f.factId).sort()).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
    expect(snap3500.facts.find((f) => f.factId === "f1")?.invalidAt).toBe(
      3000,
    );

    // T=4500: f1 (invalidated) + f3 (f2 已被 REDACT 移除)
    const snap4500 = log.rebuildAsOfSnapshot(4500);
    expect(snap4500.facts.map((f) => f.factId).sort()).toEqual(["f1", "f3"]);

    // REDACT 事件审计
    const redactions = log.getRedactionEvents();
    expect(redactions).toHaveLength(1);
    expect(redactions[0].payload.factId).toBe("f2");
    expect(redactions[0].payload.subject).toBeUndefined();
  });
});
