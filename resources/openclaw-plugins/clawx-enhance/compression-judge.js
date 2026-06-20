// c:\Users\27933\Desktop\clawx\ClawX\resources\openclaw-plugins\clawx-enhance\compression-judge.js
//
// 压缩触发判断（纯函数，不做压缩）
//
// 这个文件只回答一个问题："在当前 token 占用 + 消息数量状态下，是否应该让
// OpenClaw 的内置 compaction 跑起来？"
//
// 实际的 LLM 摘要 / 滑动窗口切分全部交给 OpenClaw 自带的 ContextEngine
// （LegacyContextEngine + delegateCompactionToRuntime）。我们只是给"是否压
// 缩"加了一个可调的策略层：
//
//   1. 防抖（debounce）：两次压缩之间最小间隔
//   2. older 消息下限：参与压缩的历史消息条数至少要够多
//   3. token 比例：contextTokenCount / contextTokenBudget
//   4. older-token 下限：即便比例够，老的 token 太短也不值得压
//
// 输入参数（input）：
//   messageCount:        当前消息总数
//   tokenCount:          当前 token 占用
//   tokenBudget:         context window 预算（未知时为 0）
//   freshTailSize:       滑动窗口保留的最近 N 条（OpenClaw 引擎用）
//   lastCompressionAt:   上次压缩的 epoch ms（debounce 用）
//   nowMs / config:      可选的时间戳和配置覆盖
//
// 输出（return）：
//   {
//     shouldCompress: boolean,    // true = 让 OpenClaw 引擎 compact()
//     reason: string,             // 给人看的可读 reason
//     ratio: number,              // 0..1
//     olderMessageCount: number,
//   }

'use strict';

const DEFAULTS = Object.freeze({
  triggerRatio: 0.75,
  freshTailSize: 32,
  minMessagesToCompress: 8,
  minOlderTokens: 20000,
  debounceMs: 60000,
});

function judgeCompression(input) {
  const cfg = { ...DEFAULTS, ...(input && input.config || {}) };
  const freshTailSize = input.freshTailSize ?? cfg.freshTailSize;
  const minMessages = cfg.minMessagesToCompress;
  const triggerRatio = cfg.triggerRatio;
  const minOlderTokens = cfg.minOlderTokens;
  const debounceMs = cfg.debounceMs;
  const now = input.nowMs ?? Date.now();

  const messageCount = Math.max(0, Math.floor(input.messageCount || 0));
  const tokenCount = Number.isFinite(input.tokenCount) ? Math.max(0, input.tokenCount) : 0;
  const tokenBudget = Number.isFinite(input.tokenBudget) ? Math.max(0, input.tokenBudget) : 0;
  const olderMessageCount = Math.max(0, messageCount - freshTailSize);

  // ratio(tokenBudget 未知时返回 0，便于日志但不触发）
  const ratio = tokenBudget > 0 ? tokenCount / tokenBudget : 0;

  // 1. 防抖期
  if (input.lastCompressionAt && debounceMs > 0) {
    const since = now - input.lastCompressionAt;
    if (since >= 0 && since < debounceMs) {
      return {
        shouldCompress: false,
        reason: `debounce: ${Math.round(since)}ms < ${debounceMs}ms`,
        ratio,
        olderMessageCount,
      };
    }
  }

  // 2. 消息数太少
  if (olderMessageCount < minMessages) {
    return {
      shouldCompress: false,
      reason: `too-few-older-messages: ${olderMessageCount} < ${minMessages} (total=${messageCount}, freshTail=${freshTailSize})`,
      ratio,
      olderMessageCount,
    };
  }

  // 3. token 预算未知 — 无法判断压力，直接跳过
  if (tokenBudget <= 0) {
    return {
      shouldCompress: false,
      reason: 'token-budget-unavailable',
      ratio: 0,
      olderMessageCount,
    };
  }

  // 4. token 占用率不足
  if (ratio < triggerRatio) {
    return {
      shouldCompress: false,
      reason: `below-threshold: ${(ratio * 100).toFixed(1)}% < ${(triggerRatio * 100).toFixed(0)}%`,
      ratio,
      olderMessageCount,
    };
  }

  // 5. older 部分 token 太少 — 即便比例超阈值，老的 token 太短也不值得压
  //    (8 条消息也可能很短，按 token 二次过滤)
  const olderTokenEstimate = messageCount > 0
    ? Math.floor(tokenCount * (olderMessageCount / messageCount))
    : 0;
  if (olderTokenEstimate < minOlderTokens && ratio < 0.95) {
    return {
      shouldCompress: false,
      reason: `older-tokens-too-low: ~${olderTokenEstimate} < ${minOlderTokens}`,
      ratio,
      olderMessageCount,
    };
  }

  return {
    shouldCompress: true,
    reason: `trigger: ${(ratio * 100).toFixed(1)}% >= ${(triggerRatio * 100).toFixed(0)}%, older=${olderMessageCount} msgs (~${olderTokenEstimate} tok)`,
    ratio,
    olderMessageCount,
  };
}

module.exports = { judgeCompression, DEFAULTS };
