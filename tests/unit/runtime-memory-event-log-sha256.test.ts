// @vitest-environment node
// WP1 (Week 7-8): SHA-256 hash chain 单元测试.
//
// 覆盖:
// - SHA-256 链生成与验证 (should_verify_chain_sha256)
// - djb2 老链兼容 (should_verify_chain_djb2_legacy)
// - 混合链 (djb2 → MIGRATE_HASHALG → sha256) 验证 (should_verify_mixed_hash_alg_chain)
// - 篡改检测: payload 修改后 verifyChain 失败 (should_fail_verification_on_tamper_sha256)
// - REDACT 后链连续性 + 内容字段置空 (should_preserve_chain_continuity_on_redact)
// - migrateHashAlg 行为 + 迁移元数据 (should_migrate_hash_alg_via_migrate_event)
// - 同算法迁移 throw (should_throw_when_migrating_to_same_alg)
// - rebuildAsOfSnapshot 忽略 MIGRATE_HASHALG 事件 (should_rebuild_snapshot_ignoring_migrate_events)
// - sha256 eventHash 长度 > djb2 eventHash 长度 (sha256_hash_should_be_longer_than_djb2)
import { describe, expect, it } from "vitest";
import { MemoryEventLog } from "../../openclaw_runtime/src/runtime-core/memory-event-log.js";
import type { MemoryEventPayload } from "../../openclaw_runtime/src/runtime-core/memory-event-log.js";

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

describe("WP1: SHA-256 hash chain", () => {
  it("should_verify_chain_sha256", () => {
    const log = new MemoryEventLog("user", { hashAlg: "sha256" });
    for (let i = 0; i < 3; i++) {
      log.append({
        eventType: "ADD",
        payload: makeAddPayload(`f${i + 1}`, `subject_${i + 1}`),
        timestamp: 1000000 + i,
      });
    }

    expect(log.verifyChain()).toBe(true);

    const events = log.getEvents();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.hashAlg).toBe("sha256");
      // eventHash 形如 "h_" + 64 hex 字符 (SHA-256 特征)
      const hexPart = event.eventHash.slice(2);
      expect(hexPart).toHaveLength(64);
      expect(hexPart).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("should_verify_chain_djb2_legacy", () => {
    const log = new MemoryEventLog("user", { hashAlg: "djb2" });
    for (let i = 0; i < 3; i++) {
      log.append({
        eventType: "ADD",
        payload: makeAddPayload(`f${i + 1}`, `subject_${i + 1}`),
        timestamp: 1000000 + i,
      });
    }

    expect(log.verifyChain()).toBe(true);

    const events = log.getEvents();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.hashAlg).toBe("djb2");
    }
  });

  it("should_verify_mixed_hash_alg_chain", () => {
    const log = new MemoryEventLog("user", { hashAlg: "djb2" });

    // 前 2 个事件: djb2
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "s1"),
      timestamp: 1000000,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "s2"),
      timestamp: 1000001,
    });

    // 迁移到 sha256 (写入 MIGRATE_HASHALG 事件)
    log.migrateHashAlg("sha256");

    // 后 2 个事件: sha256
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f3", "s3"),
      timestamp: 1000002,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f4", "s4"),
      timestamp: 1000003,
    });

    const events = log.getEvents();
    expect(events).toHaveLength(5);

    // 混合链仍可验证
    expect(log.verifyChain()).toBe(true);

    // 前 2 个事件 djb2
    expect(events[0].hashAlg).toBe("djb2");
    expect(events[1].hashAlg).toBe("djb2");

    // 第 3 个事件是 MIGRATE_HASHALG, 用旧算法 (djb2) hash 保证链连续
    expect(events[2].eventType).toBe("MIGRATE_HASHALG");
    expect(events[2].hashAlg).toBe("djb2");

    // 第 4, 5 个事件 sha256
    expect(events[3].hashAlg).toBe("sha256");
    expect(events[4].hashAlg).toBe("sha256");

    // 1 个迁移事件
    expect(log.getMigrationEvents()).toHaveLength(1);
  });

  it("should_fail_verification_on_tamper_sha256", () => {
    const log = new MemoryEventLog("user", { hashAlg: "sha256" });
    for (let i = 0; i < 3; i++) {
      log.append({
        eventType: "ADD",
        payload: makeAddPayload(`f${i + 1}`, `subject_${i + 1}`),
        timestamp: 1000000 + i,
      });
    }

    // 篡改第 2 个事件的 payload.subject (cast 到可变结构)
    const events = log.getEvents() as unknown as Array<{
      payload: { subject?: string };
    }>;
    events[1].payload.subject = "TAMPERED";

    // eventHash 未变, 但从篡改后 payload 重算的 hash 不匹配 → 验证失败
    expect(log.verifyChain()).toBe(false);
  });

  it("should_preserve_chain_continuity_on_redact", () => {
    const log = new MemoryEventLog("user", { hashAlg: "sha256" });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "s1"),
      timestamp: 1000000,
    });
    log.append({
      eventType: "REDACT",
      payload: { factId: "f1", redactionReason: "user_request" },
      timestamp: 1000001,
    });

    // REDACT 后链仍连续
    expect(log.verifyChain()).toBe(true);

    const events = log.getEvents();
    const redactEvent = events[1];
    expect(redactEvent.eventType).toBe("REDACT");

    // REDACT 后内容字段置空, 只剩 factId + redactionReason + reason
    expect(redactEvent.payload.factId).toBe("f1");
    expect(redactEvent.payload.redactionReason).toBe("user_request");
    expect(redactEvent.payload.reason).toBe("redacted");
    expect(redactEvent.payload.subject).toBeUndefined();
    expect(redactEvent.payload.predicate).toBeUndefined();
    expect(redactEvent.payload.objectSummary).toBeUndefined();
    expect(redactEvent.payload.entityIds).toBeUndefined();

    expect(log.getRedactionEvents()).toHaveLength(1);
  });

  it("should_migrate_hash_alg_via_migrate_event", () => {
    const log = new MemoryEventLog("user", { hashAlg: "djb2" });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "s1"),
      timestamp: 1000000,
    });

    // 迁移前是 djb2
    expect(log.getCurrentHashAlg()).toBe("djb2");

    log.migrateHashAlg("sha256");

    // 迁移后是 sha256
    expect(log.getCurrentHashAlg()).toBe("sha256");

    const migrations = log.getMigrationEvents();
    expect(migrations).toHaveLength(1);
    expect(migrations[0].payload.migration?.fromAlg).toBe("djb2");
    expect(migrations[0].payload.migration?.toAlg).toBe("sha256");

    // 迁移后链仍可验证
    expect(log.verifyChain()).toBe(true);
  });

  it("should_throw_when_migrating_to_same_alg", () => {
    const log = new MemoryEventLog("user", { hashAlg: "sha256" });
    expect(() => log.migrateHashAlg("sha256")).toThrow();
  });

  it("should_rebuild_snapshot_ignoring_migrate_events", () => {
    const log = new MemoryEventLog("user", { hashAlg: "sha256" });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "s1"),
      timestamp: 1000000,
    });
    // 直接 append MIGRATE_HASHALG 事件 (snapshot 重建应忽略它)
    log.append({
      eventType: "MIGRATE_HASHALG",
      payload: {
        factId: "migrate_1",
        migration: { fromAlg: "djb2", toAlg: "sha256" },
      },
      timestamp: 1000001,
    });
    log.append({
      eventType: "ADD",
      payload: makeAddPayload("f2", "s2"),
      timestamp: 1000002,
    });

    const snapshot = log.rebuildAsOfSnapshot();
    // MIGRATE 不产生 fact, 只有 2 个 ADD → 2 个 fact
    expect(snapshot.facts).toHaveLength(2);
    expect(snapshot.facts.map((f) => f.factId).sort()).toEqual(["f1", "f2"]);
  });

  it("sha256_hash_should_be_longer_than_djb2", () => {
    const sha256Log = new MemoryEventLog("user", { hashAlg: "sha256" });
    const djb2Log = new MemoryEventLog("user", { hashAlg: "djb2" });

    const sha256Event = sha256Log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "s1"),
      timestamp: 1000000,
    });
    const djb2Event = djb2Log.append({
      eventType: "ADD",
      payload: makeAddPayload("f1", "s1"),
      timestamp: 1000000,
    });

    // eventHash 形如 "h_" + hex; 比较 hex 部分 (去掉 "h_" 前缀)
    const sha256Hex = sha256Event.eventHash.slice(2);
    const djb2Hex = djb2Event.eventHash.slice(2);

    expect(sha256Hex).toHaveLength(64);
    expect(djb2Hex.length).toBeLessThanOrEqual(8);
    expect(sha256Hex.length).toBeGreaterThan(djb2Hex.length);
  });
});
