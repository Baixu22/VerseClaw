// Guardian 自动中断兜底（P2-7，对标 Codex `GuardianRejectionCircuitBreaker`）。
//
// 语义（与 codex-rs/core/src/guardian/mod.rs 对齐）：
//   - 每轮连续 blocking 级控制信号 ≥3 → trip（MAX_CONSECUTIVE_GUARDIAN_DENIALS_PER_TURN）
//   - 最近 50 次检查内 blocking ≥10 → trip（MAX_RECENT_AUTO_REVIEW_DENIALS 窗口）
//   - clean 记录复位连续计数；trip 后保持 tripped，由调用方在完成中断动作后 reset。
//
// 信号源：task-loop self-check 与 mission reviewer 产生的
// `LongConversationControlSignal`（severity === "blocking" 视为拒绝等价物）。

import {
  hasBlockingControlSignal,
  type LongConversationControlSignal,
} from "./long-conversation-control-signals.js";

export type GuardianRecordOutcome = "clean" | "blocking" | "trip";

export type GuardianCircuitBreakerOptions = {
  /** 连续 blocking 阈值（默认 3，对标 Codex 每轮连续拒绝上限）。 */
  consecutiveBlockingThreshold?: number;
  /** 滑动窗口大小（默认 50，对标 Codex 最近审查窗口）。 */
  windowSize?: number;
  /** 窗口内 blocking 阈值（默认 10，对标 Codex 最近拒绝上限）。 */
  windowBlockingThreshold?: number;
  now?: () => number;
};

export type GuardianCircuitBreakerSnapshot = {
  consecutiveBlocking: number;
  windowBlockingCount: number;
  windowSize: number;
  tripped: boolean;
  trippedAt?: number;
};

const DEFAULT_CONSECUTIVE_THRESHOLD = 3;
const DEFAULT_WINDOW_SIZE = 50;
const DEFAULT_WINDOW_THRESHOLD = 10;

export class GuardianCircuitBreaker {
  #consecutiveBlocking: number;
  #window: boolean[];
  #tripped: boolean;
  #trippedAt: number | undefined;
  #now: () => number;
  #consecutiveBlockingThreshold: number;
  #windowSize: number;
  #windowBlockingThreshold: number;

  constructor(options: GuardianCircuitBreakerOptions = {}) {
    const consecutiveBlockingThreshold =
      options.consecutiveBlockingThreshold ?? DEFAULT_CONSECUTIVE_THRESHOLD;
    const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
    const windowBlockingThreshold =
      options.windowBlockingThreshold ?? DEFAULT_WINDOW_THRESHOLD;
    if (
      !Number.isInteger(consecutiveBlockingThreshold) ||
      consecutiveBlockingThreshold <= 0 ||
      !Number.isInteger(windowSize) ||
      windowSize <= 0 ||
      !Number.isInteger(windowBlockingThreshold) ||
      windowBlockingThreshold <= 0
    ) {
      throw new Error(
        "GuardianCircuitBreaker thresholds must be positive integers",
      );
    }
    if (windowBlockingThreshold > windowSize) {
      throw new Error(
        "GuardianCircuitBreaker windowBlockingThreshold must not exceed windowSize",
      );
    }
    this.#consecutiveBlockingThreshold = consecutiveBlockingThreshold;
    this.#windowSize = windowSize;
    this.#windowBlockingThreshold = windowBlockingThreshold;
    this.#now = options.now ?? Date.now;
    this.#consecutiveBlocking = 0;
    this.#window = [];
    this.#tripped = false;
    this.#trippedAt = undefined;
  }

  /**
   * 记录一次检查结果（可能含多条 signals）。返回：
   *   - "clean"    本次无 blocking 信号，连续计数复位
   *   - "blocking" 本次有 blocking 信号但未达阈值
   *   - "trip"     达到熔断阈值（调用方应执行中断动作并 reset）
   * trip 后再次调用恒返回 "trip"，直到 reset()。
   */
  record(signals: readonly LongConversationControlSignal[] | undefined): GuardianRecordOutcome {
    if (this.#tripped) {
      return "trip";
    }
    const blocking = hasBlockingControlSignal(signals);
    this.#window.push(blocking);
    if (this.#window.length > this.#windowSize) {
      this.#window.shift();
    }
    if (blocking) {
      this.#consecutiveBlocking += 1;
    } else {
      this.#consecutiveBlocking = 0;
    }
    const windowBlockingCount = this.#window.filter(Boolean).length;
    if (
      this.#consecutiveBlocking >= this.#consecutiveBlockingThreshold ||
      windowBlockingCount >= this.#windowBlockingThreshold
    ) {
      this.#tripped = true;
      this.#trippedAt = this.#now();
      return "trip";
    }
    return blocking ? "blocking" : "clean";
  }

  getSnapshot(): GuardianCircuitBreakerSnapshot {
    return {
      consecutiveBlocking: this.#consecutiveBlocking,
      windowBlockingCount: this.#window.filter(Boolean).length,
      windowSize: this.#windowSize,
      tripped: this.#tripped,
      ...(this.#trippedAt !== undefined ? { trippedAt: this.#trippedAt } : {}),
    };
  }

  reset(): void {
    this.#consecutiveBlocking = 0;
    this.#window = [];
    this.#tripped = false;
    this.#trippedAt = undefined;
  }
}

/** 会话级熔断器注册表（per-sessionKey）。 */
const sessionBreakers = new Map<string, GuardianCircuitBreaker>();

export function getSessionGuardianCircuitBreaker(
  sessionKey: string,
  options?: GuardianCircuitBreakerOptions,
): GuardianCircuitBreaker {
  let breaker = sessionBreakers.get(sessionKey);
  if (!breaker) {
    breaker = new GuardianCircuitBreaker(options);
    sessionBreakers.set(sessionKey, breaker);
  }
  return breaker;
}

export function resetGuardianCircuitBreaker(sessionKey: string): void {
  sessionBreakers.delete(sessionKey);
}

export function resetAllGuardianCircuitBreakersForTests(): void {
  sessionBreakers.clear();
}
