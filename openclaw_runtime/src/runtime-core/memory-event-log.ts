// Week 6 v2 + Week 7-8 WP1: Memory event log
//   (append-only + hash chain + REDACT + SHA-256 + hashAlg 迁移).
//
// Source: memory-arch-roadmap.md §B6, §D1, Week 6 + Week 7-8 DEV PROMPT WP1
//
// 核心设计:
//   - append-only: 所有写入/失效/合并/删除都是 event, 不可变
//   - hash chain: 每个 event 包含 prev_hash, 形成链 (可验证完整性)
//   - as-of snapshot: 任意时间点的内存状态可重建 (deterministic replay)
//   - REDACT 事件 (v2): GDPR/CCPA 合规, 原文置空, hash chain 仍连续
//   - Week 7-8 WP1: SHA-256 替代 djb2 (密码学完整性) + hashAlg 标记 + 混合链验证 +
//                   MIGRATE_HASHALG 事件 (链不断)
//
// 8 种 eventType (Week 7-8 新增 MIGRATE_HASHALG):
//   ADD / SUPERSEDE / INVALIDATE / MERGE / PRUNE / STRENGTHEN / REDACT / MIGRATE_HASHALG
//
// hashAlg 迁移策略:
//   - 老链 (djb2): verifyChain 按 event.hashAlg 逐事件验证, 仍能通过
//   - 新链 (sha256, 默认): 所有新 event 用 SHA-256
//   - 混合链: 老 djb2 event + MIGRATE_HASHALG event + 新 sha256 event, 链不断
//   - MIGRATE_HASHALG event: 标记切换点, prev_hash 连到旧链末尾
//
// 与 Hindsight 区别:
//   - Hindsight: 无 event log, observation 是 LLM 维护的, 不可回放
//   - ClawX: append-only + hash chain (SHA-256), 任意时间点可回放, 密码学可审计

import { createHash } from "node:crypto";
import type { EventLogHashAlg } from "./memory-runtime-config.js";

// === Schema ===

/**
 * 事件类型. 8 种 (含 REDACT + Week 7-8 MIGRATE_HASHALG).
 */
export type MemoryEventType =
  | "ADD" // 新增 fact
  | "SUPERSEDE" // 取代旧 fact (冲突解决)
  | "INVALIDATE" // 失效 fact (不带替代)
  | "MERGE" // 合并多个 fact
  | "PRUNE" // 清理过期 fact
  | "STRENGTHEN" // 强化 fact (增加 proofCount)
  | "REDACT" // GDPR/CCPA 删除 (原文置空, hash chain 连续)
  | "MIGRATE_HASHALG"; // Week 7-8: hash 算法迁移标记 (djb2 → sha256)

/**
 * 事件 payload. REDACT 时只保留 factId/原因/时间戳.
 * MIGRATE_HASHALG 时只保留迁移元数据 (fromAlg/toAlg).
 */
export type MemoryEventPayload = {
  factId: string;
  subject?: string;
  predicate?: string;
  objectSummary?: string;
  entityIds?: string[];
  validAt?: number;
  invalidAt?: number;
  supersededFactId?: string;
  mergedFactIds?: string[];
  reason?: string;
  /** REDACT 专用: 删除原因 */
  redactionReason?: string;
  /** MIGRATE_HASHALG 专用: 迁移元数据 */
  migration?: {
    fromAlg: EventLogHashAlg;
    toAlg: EventLogHashAlg;
  };
};

/**
 * 内存变更事件. append-only, 含 hash chain + hashAlg 标记.
 */
export type MemoryEvent = {
  /** 事件 ID (deterministic: hash of timestamp + sequence) */
  eventId: string;
  /** 事件时间戳 (Unix ms) */
  timestamp: number;
  /** 事件类型 */
  eventType: MemoryEventType;
  /** 事件 payload (REDACT 时内容字段置空) */
  payload: MemoryEventPayload;
  /** 前一个事件的 hash (链式完整性). 第一个事件为 "genesis" */
  prevHash: string;
  /** 当前事件的 hash (hash of eventId + timestamp + eventType + payload + prevHash) */
  eventHash: string;
  /** 用户 ID (per-user hash chain) */
  userId: string;
  /**
   * Week 7-8 WP1: 此事件使用的 hash 算法.
   * - djb2: 老链 (Week 6)
   * - sha256: 新链 (Week 7-8, 密码学完整性)
   * 老事件若无此字段, 默认 "djb2".
   */
  hashAlg: EventLogHashAlg;
};

// === EventLog 主类 ===

/**
 * Memory event log. append-only + per-user hash chain + SHA-256 (Week 7-8).
 *
 * 用法:
 *   const log = new MemoryEventLog("user_123", { hashAlg: "sha256" });
 *   log.append({ eventType: "ADD", payload: { factId: "f1", ... } });
 *   log.append({ eventType: "SUPERSEDE", payload: { factId: "f2", supersededFactId: "f1", ... } });
 *   log.append({ eventType: "REDACT", payload: { factId: "f1", redactionReason: "user_request" } });
 *
 *   const events = log.getEvents();
 *   const valid = log.verifyChain(); // true (按 event.hashAlg 逐事件验证)
 *   const snapshot = log.rebuildAsOfSnapshot(T); // T 时刻的 fact 状态
 *
 *   // Week 7-8: 迁移老 djb2 链到 sha256
 *   log.migrateHashAlg("sha256"); // 写入 MIGRATE_HASHALG 事件, 后续 event 用 sha256
 */
export class MemoryEventLog {
  private events: MemoryEvent[] = [];
  private readonly userId: string;
  private sequence = 0;
  /**
   * 当前 hash 算法 (新 event 使用此算法).
   * Week 7-8 默认 sha256. 老链可传 "djb2" 维持兼容.
   */
  private currentHashAlg: EventLogHashAlg;

  constructor(
    userId: string,
    options: { hashAlg?: EventLogHashAlg } = {},
  ) {
    this.userId = userId;
    this.currentHashAlg = options.hashAlg ?? "sha256";
  }

  /**
   * 追加事件. 自动计算 prevHash + eventHash + hashAlg.
   */
  append(input: {
    eventType: MemoryEventType;
    payload: MemoryEventPayload;
    timestamp?: number;
  }): MemoryEvent {
    const timestamp = input.timestamp ?? Date.now();
    this.sequence += 1;
    const eventId = this.computeEventId(timestamp, this.sequence);

    const prevHash =
      this.events.length === 0
        ? "genesis"
        : this.events[this.events.length - 1].eventHash;

    // REDACT: payload 内容字段置空 (合规要求)
    const payload =
      input.eventType === "REDACT"
        ? this.redactPayload(input.payload)
        : input.payload;

    const hashAlg = this.currentHashAlg;
    const eventHash = this.computeEventHash(
      eventId,
      timestamp,
      input.eventType,
      payload,
      prevHash,
      hashAlg,
    );

    const event: MemoryEvent = {
      eventId,
      timestamp,
      eventType: input.eventType,
      payload,
      prevHash,
      eventHash,
      userId: this.userId,
      hashAlg,
    };

    this.events.push(event);
    return event;
  }

  /**
   * Week 7-8 WP1: 迁移 hash 算法.
   *
   * 写入一个 MIGRATE_HASHALG 事件, 标记从 fromAlg 切换到 toAlg.
   * 后续 append() 的 event 使用 toAlg.
   *
   * prev_hash 连到旧链末尾, 保证链不断.
   *
   * @param toAlg 目标算法 (默认 sha256)
   * @returns MIGRATE_HASHALG 事件
   */
  migrateHashAlg(toAlg: EventLogHashAlg = "sha256"): MemoryEvent {
    const fromAlg = this.currentHashAlg;
    if (fromAlg === toAlg) {
      // 已是目标算法, 不需要迁移
      throw new Error(`Already using ${toAlg}, no migration needed`);
    }

    // 写入 MIGRATE_HASHALG 事件 (用旧算法 hash, 保证链连续)
    const migrateEvent = this.append({
      eventType: "MIGRATE_HASHALG",
      payload: {
        factId: `migrate_${this.sequence + 1}`,
        migration: { fromAlg, toAlg },
        reason: `hash algorithm migration: ${fromAlg} → ${toAlg}`,
      },
    });

    // 切换当前算法 (后续 event 用新算法)
    this.currentHashAlg = toAlg;
    return migrateEvent;
  }

  /**
   * 获取所有事件 (只读).
   */
  getEvents(): readonly MemoryEvent[] {
    return this.events;
  }

  /**
   * 获取指定时间范围内的事件.
   */
  getEventsInRange(start: number, end: number): MemoryEvent[] {
    return this.events.filter(
      (e) => e.timestamp >= start && e.timestamp <= end,
    );
  }

  /**
   * 验证 hash chain 完整性.
   *
   * Week 7-8 WP1: 按 event.hashAlg 逐事件验证 (支持混合链).
   *
   * 检查:
   *   1. 第一个事件 prevHash === "genesis"
   *   2. 每个事件 prevHash === 前一个事件 eventHash
   *   3. 每个事件 eventHash === 用其 hashAlg 重新计算的 hash
   */
  verifyChain(): boolean {
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];

      // 1. 第一个事件 prevHash
      if (i === 0) {
        if (event.prevHash !== "genesis") return false;
      } else {
        // 2. 后续事件 prevHash === 前一个 eventHash
        if (event.prevHash !== this.events[i - 1].eventHash) return false;
      }

      // 3. 重新计算 eventHash 验证 (按 event.hashAlg)
      const eventAlg = event.hashAlg ?? "djb2"; // 老事件无字段, 默认 djb2
      const recomputedHash = this.computeEventHash(
        event.eventId,
        event.timestamp,
        event.eventType,
        event.payload,
        event.prevHash,
        eventAlg,
      );
      if (recomputedHash !== event.eventHash) return false;
    }
    return true;
  }

  /**
   * 重建 T 时刻的 fact 状态 (as-of snapshot).
   *
   * 算法: 按顺序 apply 所有 timestamp ≤ T 的事件, 返回 T 时刻有效的 fact 集合.
   *
   * @param asOfTime T 时间点 (Unix ms), 默认 = 最后一个事件时间
   */
  rebuildAsOfSnapshot(asOfTime?: number): AsOfSnapshot {
    const cutoff =
      asOfTime ?? (this.events[this.events.length - 1]?.timestamp ?? 0);
    const applicableEvents = this.events.filter(
      (e) => e.timestamp <= cutoff,
    );

    const facts = new Map<string, SnapshotFact>();

    for (const event of applicableEvents) {
      this.applyEventToSnapshot(event, facts);
    }

    return {
      asOfTime: cutoff,
      facts: [...facts.values()],
      eventCount: applicableEvents.length,
    };
  }

  /**
   * 获取 REDACT 事件 (用于审计).
   */
  getRedactionEvents(): MemoryEvent[] {
    return this.events.filter((e) => e.eventType === "REDACT");
  }

  /**
   * Week 7-8 WP1: 获取 MIGRATE_HASHALG 事件 (用于审计).
   */
  getMigrationEvents(): MemoryEvent[] {
    return this.events.filter((e) => e.eventType === "MIGRATE_HASHALG");
  }

  /**
   * 获取事件数量.
   */
  size(): number {
    return this.events.length;
  }

  /**
   * Week 7-8 WP1: 获取当前使用的 hash 算法.
   */
  getCurrentHashAlg(): EventLogHashAlg {
    return this.currentHashAlg;
  }

  // === 内部: REDACT payload 处理 ===

  /**
   * REDACT: 原文内容字段置空, 只保留 factId/原因/时间戳.
   * hash chain 仍连续 (eventHash 基于 redact 后的 payload 计算).
   */
  private redactPayload(payload: MemoryEventPayload): MemoryEventPayload {
    return {
      factId: payload.factId,
      redactionReason: payload.redactionReason ?? "user_request",
      reason: "redacted",
      // subject/predicate/objectSummary/entityIds 等内容字段不保留
    };
  }

  // === 内部: hash 计算 ===

  private computeEventId(timestamp: number, sequence: number): string {
    const input = `${this.userId}|${timestamp}|${sequence}`;
    // eventId 用当前算法 (老链 djb2, 新链 sha256)
    return `evt_${this.hashString(input, this.currentHashAlg)}`;
  }

  private computeEventHash(
    eventId: string,
    timestamp: number,
    eventType: MemoryEventType,
    payload: MemoryEventPayload,
    prevHash: string,
    hashAlg: EventLogHashAlg,
  ): string {
    // 序列化 payload (稳定排序, 避免 JSON.stringify 键顺序差异)
    const payloadStr = this.stableStringify(payload);
    const input = `${eventId}|${timestamp}|${eventType}|${payloadStr}|${prevHash}`;
    return `h_${this.hashString(input, hashAlg)}`;
  }

  /**
   * 按算法 hash 字符串.
   * - djb2: 32-bit 非密码学 hash (老链兼容)
   * - sha256: SHA-256 密码学 hash (Week 7-8 新链)
   */
  private hashString(input: string, hashAlg: EventLogHashAlg): string {
    if (hashAlg === "sha256") {
      return createHash("sha256").update(input, "utf8").digest("hex");
    }
    return this.djb2Hash(input);
  }

  private djb2Hash(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
    }
    return (hash >>> 0).toString(16);
  }

  /**
   * 稳定 JSON 序列化 (键排序, 避免 JSON.stringify 键顺序差异).
   */
  private stableStringify(obj: unknown): string {
    if (obj === null || typeof obj !== "object") {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return `[${obj.map((v) => this.stableStringify(v)).join(",")}]`;
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) =>
        `"${k}":${this.stableStringify(
          (obj as Record<string, unknown>)[k],
        )}`,
    );
    return `{${pairs.join(",")}}`;
  }

  // === 内部: snapshot 重建 ===

  private applyEventToSnapshot(
    event: MemoryEvent,
    facts: Map<string, SnapshotFact>,
  ): void {
    // MIGRATE_HASHALG 不改 fact 状态, 只标记 hash 切换
    if (event.eventType === "MIGRATE_HASHALG") {
      return;
    }

    const { factId } = event.payload;

    switch (event.eventType) {
      case "ADD": {
        facts.set(factId, {
          factId,
          subject: event.payload.subject ?? "",
          predicate: event.payload.predicate ?? "",
          objectSummary: event.payload.objectSummary ?? "",
          entityIds: event.payload.entityIds ?? [],
          validAt: event.payload.validAt ?? event.timestamp,
          invalidAt: undefined,
        });
        break;
      }
      case "SUPERSEDE": {
        // 旧 fact 失效
        const oldFactId = event.payload.supersededFactId;
        if (oldFactId && facts.has(oldFactId)) {
          const oldFact = facts.get(oldFactId)!;
          oldFact.invalidAt = event.payload.invalidAt ?? event.timestamp;
        }
        // 新 fact 加入
        facts.set(factId, {
          factId,
          subject: event.payload.subject ?? "",
          predicate: event.payload.predicate ?? "",
          objectSummary: event.payload.objectSummary ?? "",
          entityIds: event.payload.entityIds ?? [],
          validAt: event.payload.validAt ?? event.timestamp,
          invalidAt: undefined,
        });
        break;
      }
      case "INVALIDATE": {
        if (facts.has(factId)) {
          facts.get(factId)!.invalidAt =
            event.payload.invalidAt ?? event.timestamp;
        }
        break;
      }
      case "MERGE": {
        // 合并的 fact 失效
        for (const mergedId of event.payload.mergedFactIds ?? []) {
          if (facts.has(mergedId)) {
            facts.get(mergedId)!.invalidAt = event.timestamp;
          }
        }
        // 新合并 fact 加入
        facts.set(factId, {
          factId,
          subject: event.payload.subject ?? "",
          predicate: event.payload.predicate ?? "",
          objectSummary: event.payload.objectSummary ?? "",
          entityIds: event.payload.entityIds ?? [],
          validAt: event.payload.validAt ?? event.timestamp,
          invalidAt: undefined,
        });
        break;
      }
      case "PRUNE": {
        facts.delete(factId);
        break;
      }
      case "STRENGTHEN": {
        // STRENGTHEN 不改 fact 内容, 只增加 proofCount (snapshot 不追踪)
        break;
      }
      case "REDACT": {
        // REDACT: 从 snapshot 删除 fact (原文已置空)
        facts.delete(factId);
        break;
      }
    }
  }
}

// === Snapshot 类型 ===

export type SnapshotFact = {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  entityIds: string[];
  validAt: number;
  invalidAt?: number;
};

export type AsOfSnapshot = {
  asOfTime: number;
  facts: SnapshotFact[];
  eventCount: number;
};

// === 工具函数 ===

/**
 * 验证单个事件的 hash (不依赖 EventLog 实例).
 *
 * Week 7-8 WP1: 按 event.hashAlg 验证 (支持 djb2 + sha256).
 */
export function verifyEventHash(event: MemoryEvent): boolean {
  const payloadStr = stableStringifyStandalone(event.payload);
  const input = `${event.eventId}|${event.timestamp}|${event.eventType}|${payloadStr}|${event.prevHash}`;
  const eventAlg = event.hashAlg ?? "djb2"; // 老事件无字段, 默认 djb2
  const recomputedHash = `h_${hashStringStandalone(input, eventAlg)}`;
  return recomputedHash === event.eventHash;
}

/**
 * 验证两个事件链的连续性 (eventB.prevHash === eventA.eventHash).
 */
export function verifyChainLink(
  eventA: MemoryEvent,
  eventB: MemoryEvent,
): boolean {
  return eventB.prevHash === eventA.eventHash;
}

// 独立工具函数 (避免循环依赖)
function hashStringStandalone(
  input: string,
  hashAlg: EventLogHashAlg,
): string {
  if (hashAlg === "sha256") {
    return createHash("sha256").update(input, "utf8").digest("hex");
  }
  return djb2HashStandalone(input);
}

function djb2HashStandalone(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16);
}

function stableStringifyStandalone(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((v) => stableStringifyStandalone(v)).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      `"${k}":${stableStringifyStandalone(
        (obj as Record<string, unknown>)[k],
      )}`,
  );
  return `{${pairs.join(",")}}`;
}
