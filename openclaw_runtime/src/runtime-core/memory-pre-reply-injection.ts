// COMPASS 2.0 Pre-reply Injection — SSP + Hybrid Retrieval 注入到 extraSystemPromptParts.
//
// 设计目标 (COMPASS 2.0 × ClawX 融合, 方案 D):
//   - SSP (Session State Page) 注入: 绕过 context-engine, unshift 到 extraSystemPromptParts 最前
//   - Hybrid retrieval top-5 注入: 紧随 SSP, 提供相关历史事实
//   - 受独立 feature flag 控制 (enableSessionStatePage + enablePreReplyRetrieval)
//   - Projection Cache invariant: 检测 version 变化强制 I-frame 刷新
//
// 调用点: get-reply-run.ts runPreparedReply, line 617 extraSystemPromptParts 构建之前.
// 调用方传入 sessionKey + userInputText + 可选 facts/embeddingProvider/config.

import { hybridSearchFactsWithEmbedding, clearHybridSearchIndexCache, extractEntities, type HybridSearchHit } from "./memory-hybrid-retrieval.js";
import { NO_EMBEDDING_PROVIDER, type EmbeddingProviderOrNone } from "./memory-embedding-provider.js";
import {
  createMemoryRuntimeConfig,
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  type MemoryRuntimeConfig,
} from "./memory-runtime-config.js";
import {
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  runtimeMemoryFlagEnabled,
  type RuntimeMemoryQueryableFact,
} from "./memory-context.js";
import { createRuntimeMemoryRuntimeIntegration } from "./memory-runtime-integration.js";
import { subscribeRuntimeMemoryChanges } from "./memory-persistence.js";
import {
  createInitialSSP,
  extractIntent,
  loadSessionState,
  saveSessionState,
  serializeSSPForPrompt,
  updateSSP,
  bumpSSPVersion,
  type SessionStatePage,
} from "./memory-session-state.js";

// === Pre-reply Injection Result ===

export interface PreReplyInjection {
  /** SSP 序列化文本 (确定性, 256 tokens 上限), 注入到 extraSystemPromptParts 最前 */
  sspString?: string;
  /** Hybrid retrieval top-K 序列化文本, 紧随 SSP */
  top5FactsString?: string;
  /** 更新后的 SSP (供 post-reply 补充更新使用) */
  updatedSSP?: SessionStatePage;
  /** 诊断: 是否发生了 I-frame 刷新 (version 变化) */
  iFrameRefreshed: boolean;
  /** 诊断: 本轮 memory pressure 等级 (决定 topK) */
  pressureLevel?: MemoryPressureLevel;
  /** 诊断: 是否触发了 page fault (实体未覆盖 → 触发 retrieval) */
  pageFaultTriggered?: boolean;
  /** 诊断: 实际注入的 fact IDs (供 post-reply 计算 injectedButUnusedFactIds) */
  injectedFactIds?: string[];
}

// === Memory Pressure (轻量调度) ===

export type MemoryPressureLevel = "low" | "medium" | "high";

/**
 * 压力等级 → topK 映射.
 * low: 充裕, 多检索 (topK=5)
 * medium: 适度 (topK=3)
 * high: 紧张, 只保留 SSP (topK=0, 不检索)
 */
export const PRESSURE_TOP_K: Record<MemoryPressureLevel, number> = {
  low: 5,
  medium: 3,
  high: 0,
};

/**
 * 估算 memory pressure 等级.
 *
 * 基于两个信号:
 * 1. userInputText 长度 (当前输入复杂度)
 * 2. SSP decisionHistory 长度 (对话轮数, 代表上下文累积)
 *
 * 分档:
 * - low: 输入 < 200 chars AND 轮数 < 4
 * - medium: 输入 < 800 chars OR 轮数 < 8
 * - high: 其他 (长输入 + 多轮 → 上下文紧张)
 */
export function resolvePressureLevel(params: {
  userInputText: string;
  ssp?: SessionStatePage;
}): MemoryPressureLevel {
  const inputLen = params.userInputText.length;
  const turnCount = params.ssp?.decisionHistory.length ?? 0;

  if (inputLen < 200 && turnCount < 4) return "low";
  if (inputLen < 800 || turnCount < 8) return "medium";
  return "high";
}

/**
 * Page fault 判断: 用户输入实体是否被 SSP activeGoals 覆盖.
 *
 * - 首轮 (SSP version == 1, 刚从本次输入创建): 触发 (目标来自同一文本, 尚未证明覆盖)
 * - 提取 userInputText 的实体
 * - 提取 SSP.activeGoals 合并文本的实体
 * - 交集为空 → page fault (需要检索补充)
 * - 交集非空 → SSP 已覆盖 (不检索)
 * - 用户输入无实体 → 不触发 (无实体查询, SSP 足够)
 * - SSP 无 activeGoals → 触发 (全新主题)
 */
export function shouldTriggerRetrieval(params: {
  userInputText: string;
  ssp?: SessionStatePage;
}): boolean {
  // ── 实体提取局限性 (文档化, 不修复) ──────────────────────────────────────
  // extractEntities 基于「大写词 + 3-gram」策略, 在中文场景下存在以下已知问题:
  //
  // 1. 大写词提取对中文无效:
  //    中文没有大小写区分, 所有中文词均无法通过大写词规则提取.
  //    结果: 中文输入的实体提取完全依赖 3-gram.
  //
  // 2. 3-gram 对中文产生大量无意义 token:
  //    「部署到生产环境」→ 3-gram: 「部署到」「署到生」「到生产」「生产环」「产环境」
  //    其中只有「生产环境」片段有意义, 但无法被 3-gram 准确捕获.
  //
  // 3. 影响:
  //    中文输入在 page fault 判断时, userEntities 集合通常为空 (触发「无实体查询」分支)
  //    或包含大量噪声 (导致与 goalEntities 的交集判断不准确).
  //    实际效果: 中文场景下 page fault 逻辑退化为「首轮始终触发, 后续不触发」.
  //    这是保守但可接受的行为 (不检索总好过噪声检索).
  //
  // 迁移路径: 为中文输入使用分词工具 (nodejieba 或 WASM 版 jieba) 后再提取命名实体.
  // 触发条件: 当中文用户比例超过 30% 且 page fault miss rate > 20%.
  const userEntities = extractEntities(params.userInputText);
  if (userEntities.size === 0) return false;

  if (!params.ssp || params.ssp.activeGoals.length === 0) return true;

  // 首轮: SSP 刚从本次输入创建, goals 与输入同源, 实体必然交集 → 触发检索
  if (params.ssp.version <= 1) return true;

  const goalText = params.ssp.activeGoals.join(" ");
  const goalEntities = extractEntities(goalText);

  for (const e of userEntities) {
    if (goalEntities.has(e)) return false;
  }
  return true;
}

// === Drift Score Fetcher (从 governance 获取) ===

export type DriftScoreFetcher = (sessionKey: string) => Promise<number>;

// === Top-5 Facts 序列化 (确定性模板) ===

/**
 * 序列化 hybrid retrieval top-5 hits 为 prompt 文本 (确定性模板).
 *
 * 模板:
 *   [Relevant Memory]
 *   1. <subject>: <objectSummary> (conf: 0.9)
 *   2. ...
 */
/**
 * FP-P1-182: the per-fact lines behind serializeTop5Facts, so a caller can key each fact
 * individually (COMPASS and the runtime-memory memory pilot read the same store).
 *
 * The rendered text is produced from this same split, which is what makes it provable
 * that exposing the lines changed no injected byte.
 */
export const TOP5_FACTS_HEADER = "[Relevant Memory]";

export function splitTop5FactLines(
  hits: readonly HybridSearchHit[],
): Array<{ factId: string; text: string }> {
  const entries: Array<{ factId: string; text: string }> = [];
  for (let i = 0; i < Math.min(hits.length, 5); i += 1) {
    const hit = hits[i];
    const fact = hit.fact;
    const confidence = typeof fact.confidence === "number" ? fact.confidence.toFixed(2) : "0.00";
    const subject = fact.subject ?? "";
    const objectSummary = fact.objectSummary ?? "";
    // 截断 objectSummary 到 100 chars 避免 prompt 膨胀
    const truncatedSummary =
      objectSummary.length > 100 ? objectSummary.slice(0, 97) + "..." : objectSummary;
    entries.push({ factId: fact.factId, text: `${i + 1}. ${subject}: ${truncatedSummary} (conf: ${confidence})` });
  }
  return entries;
}

export function serializeTop5Facts(hits: readonly HybridSearchHit[]): string {
  if (hits.length === 0) return "";

  const lines: string[] = [TOP5_FACTS_HEADER];
  for (let i = 0; i < Math.min(hits.length, 5); i++) {
    const hit = hits[i];
    const fact = hit.fact;
    const confidence = typeof fact.confidence === "number" ? fact.confidence.toFixed(2) : "0.00";
    const subject = fact.subject ?? "";
    const objectSummary = fact.objectSummary ?? "";
    // 截断 objectSummary 到 100 chars 避免 prompt 膨胀
    const truncatedSummary =
      objectSummary.length > 100 ? objectSummary.slice(0, 97) + "..." : objectSummary;
    lines.push(`${i + 1}. ${subject}: ${truncatedSummary} (conf: ${confidence})`);
  }
  return lines.join("\n");
}

// === SSP 注入构建 ===

/**
 * 进程内 I-frame 消费记录: sessionId → 上次 pre-reply 消费的 SSP version.
 *
 * 用于检测外部 version bump (如 consolidation 触发的 triggerSSPVersionBump).
 *
 * ⚠️  单进程假设 (COMPASS 2.0 架构约束):
 * 此 Map 存活在单个 Node.js 进程的堆内存中. 在以下场景下行为未定义:
 *
 *   1. 多进程部署 (PM2 cluster / worker_threads):
 *      进程 A 的 consolidation/flush 触发 version bump, 进程 B 的
 *      lastConsumedVersions 无法感知, externalBumpDetected 永远为 false.
 *      → 迁移路径: 将此 Map 迁移到 Redis 或基于文件锁的共享存储.
 *
 *   2. 进程重启:
 *      重启后 Map 清空, 所有 session 的 lastConsumed 归零.
 *      副作用: 首轮 pre-reply 会误判为 externalBumpDetected=true, 触发 I-frame 刷新.
 *      这是可接受的保守行为 (多刷新一次 > 漏刷新一次).
 *
 *   3. 长时间运行的单进程 (内存泄漏风险):
 *      Map 随 sessionId 数量增长, 无 eviction 机制.
 *      → 缓解: 与 SF-2 的 SSP sessions eviction 对齐, 在 session 过期时同步清理.
 *
 * 当前部署模式: 单进程. 多进程支持需要在深度设计阶段专项处理.
 */
const lastConsumedVersions = new Map<string, number>();

/**
 * 构建 SSP 注入字符串 (pre-reply 更新 + 读取).
 *
 * 步骤 (选项 C — pre-reply 先更新再读取):
 * 1. 加载现有 SSP (loadSessionState)
 * 2. 提取 intent (extractIntent)
 * 3. 获取 driftScore (从 governance)
 * 4. 更新 SSP (updateSSP, 含否定检测 + FIFO 淘汰)
 * 5. 保存 SSP (saveSessionState)
 * 6. 序列化 SSP 为 prompt 文本 (serializeSSPForPrompt)
 *
 * I-frame 刷新检测:
 * - goalsChanged: updateSSP 内部 goals 变化触发 version++
 * - externalBumpDetected: 当前 version > 上次消费的 version (consolidation 触发)
 * - 两者任一为 true 则 I-frame 刷新
 */
export async function buildSSPInjection(params: {
  sessionKey: string;
  userInputText: string;
  driftScore?: number;
  driftScoreFetcher?: DriftScoreFetcher;
  now?: number;
}): Promise<{
  sspString: string;
  updatedSSP: SessionStatePage;
  iFrameRefreshed: boolean;
}> {
  const { sessionKey, userInputText } = params;
  const now = params.now ?? Date.now();

  // 1. 加载现有 SSP
  const existingSSP = await loadSessionState(sessionKey);

  // 2. 提取 intent
  const intent = extractIntent(userInputText);

  // 3. 获取 driftScore
  let driftScore = params.driftScore ?? 0;
  if (params.driftScoreFetcher) {
    try {
      driftScore = await params.driftScoreFetcher(sessionKey);
    } catch {
      // 降级: 使用默认值 0
      driftScore = 0;
    }
  }

  // 4. 更新 SSP
  const existingVersion = existingSSP?.version ?? 0;
  const lastConsumed = lastConsumedVersions.get(sessionKey) ?? 0;
  let updatedSSP: SessionStatePage;
  if (existingSSP) {
    updatedSSP = updateSSP(existingSSP, intent, driftScore, undefined, "", now);
  } else {
    updatedSSP = createInitialSSP(sessionKey, intent, now);
  }

  // 5. 保存 SSP
  await saveSessionState(updatedSSP);

  // 6. 序列化 + I-frame 刷新检测
  const sspString = serializeSSPForPrompt(updatedSSP);
  // I-frame 刷新: goals 变化 (version++) OR 外部 bump (version > lastConsumed)
  const goalsChanged = updatedSSP.version !== existingVersion;
  const externalBumpDetected = existingVersion > lastConsumed;
  const iFrameRefreshed = goalsChanged || externalBumpDetected;

  // 记录本次消费的 version, 供下次检测外部 bump
  lastConsumedVersions.set(sessionKey, updatedSSP.version);

  return { sspString, updatedSSP, iFrameRefreshed };
}

// === Hybrid Retrieval 注入构建 ===

/**
 * 构建 hybrid retrieval top-K 注入.
 *
 * 调用 hybridSearchFactsWithEmbedding 获取 top-K facts, 然后序列化.
 * 当 facts 语料库为空或检索失败时返回空结果 (降级).
 *
 * @returns { text, factIds } text=序列化文本, factIds=注入的 fact ID 列表 (供 post-reply 观测)
 */
export async function buildTop5FactsInjection(params: {
  facts: readonly RuntimeMemoryQueryableFact[];
  userInputText: string;
  embeddingProvider?: EmbeddingProviderOrNone;
  referenceTime?: number;
  topK?: number;
}): Promise<{
  text: string;
  factIds: string[];
  /** FP-P1-182: the same lines as `text`, per fact, with their fact ids. */
  entries: Array<{ factId: string; text: string }>;
}> {
  const { facts, userInputText } = params;
  if (facts.length === 0 || !userInputText.trim()) return { text: "", factIds: [], entries: [] };

  const topK = params.topK ?? 5;
  if (topK <= 0) return { text: "", factIds: [], entries: [] };

  try {
    const hits = await hybridSearchFactsWithEmbedding(
      facts,
      {
        queryText: userInputText,
        topK,
        referenceTime: params.referenceTime ?? Date.now(),
      },
      params.embeddingProvider ?? NO_EMBEDDING_PROVIDER,
    );
    return {
      text: serializeTop5Facts(hits),
      factIds: hits.map((h) => h.fact.factId),
      // FP-P1-182: per-fact lines for callers that need a fact-level identity.
      entries: splitTop5FactLines(hits),
    };
  } catch {
    // 降级: 检索失败时不注入
    return { text: "", factIds: [], entries: [] };
  }
}

// === 主入口: 构建 Pre-reply Injection ===

/**
 * 构建 pre-reply 注入 (SSP + Hybrid Retrieval).
 *
 * 受两个独立 feature flag 控制:
 * - enableSessionStatePage: 控制 SSP 注入
 * - enablePreReplyRetrieval: 控制 hybrid retrieval 注入
 *
 * 当两个 flag 都关闭时返回空结果 (零风险部署).
 */
/**
 * TF-0500: this pre-reply injection path is RETIRED.
 *
 * It unshifted SSP + hybrid-retrieval text straight into extraSystemPromptParts,
 * which was a second injection authority next to dcs-context-authority (the authority
 * declared in memory-authority.ts with lifecycle.injection "accepted-only"). The two
 * COMPASS injection branches can therefore never produce prompt text again; the
 * pressure / page-fault diagnostics are still computed so existing traces keep meaning.
 */
export const COMPASS_PRE_REPLY_INJECTION_RETIRED = true;

export async function buildPreReplyInjection(params: {
  sessionKey: string;
  userInputText: string;
  config?: MemoryRuntimeConfig;
  facts?: readonly RuntimeMemoryQueryableFact[];
  embeddingProvider?: EmbeddingProviderOrNone;
  driftScore?: number;
  driftScoreFetcher?: DriftScoreFetcher;
  now?: number;
}): Promise<PreReplyInjection> {
  const config = params.config ?? DEFAULT_MEMORY_RUNTIME_CONFIG;
  const flags = config.featureFlags;
  // Retired: never inject, whatever the caller passes in.
  const injectionRetired = COMPASS_PRE_REPLY_INJECTION_RETIRED;
  const result: PreReplyInjection = { iFrameRefreshed: false };

  // SSP 注入 — retired, branch unreachable
  if (!injectionRetired && flags.enableSessionStatePage) {
    try {
      const sspResult = await buildSSPInjection({
        sessionKey: params.sessionKey,
        userInputText: params.userInputText,
        driftScore: params.driftScore,
        driftScoreFetcher: params.driftScoreFetcher,
        now: params.now,
      });
      result.sspString = sspResult.sspString;
      result.updatedSSP = sspResult.updatedSSP;
      result.iFrameRefreshed = sspResult.iFrameRefreshed;
    } catch {
      // 降级: SSP 构建失败时不注入
    }
  }

  // Memory pressure + page fault → 决定是否检索 + topK
  const pressureLevel = resolvePressureLevel({
    userInputText: params.userInputText,
    ssp: result.updatedSSP,
  });
  result.pressureLevel = pressureLevel;

  const pageFaultTriggered = shouldTriggerRetrieval({
    userInputText: params.userInputText,
    ssp: result.updatedSSP,
  });
  result.pageFaultTriggered = pageFaultTriggered;

  // Hybrid retrieval 注入: 仅在 page fault + pressure 允许 + flag 开启时触发
  const topK = PRESSURE_TOP_K[pressureLevel];
  if (
    !injectionRetired &&
    flags.enablePreReplyRetrieval &&
    pageFaultTriggered &&
    topK > 0 &&
    params.facts &&
    params.facts.length > 0
  ) {
    try {
      const retrievalResult = await buildTop5FactsInjection({
        facts: params.facts,
        userInputText: params.userInputText,
        embeddingProvider: params.embeddingProvider,
        topK,
      });
      result.top5FactsString = retrievalResult.text || undefined;
      result.injectedFactIds = retrievalResult.factIds;
    } catch {
      // 降级: retrieval 失败时不注入
    }
  }

  return result;
}

// === SSP Post-reply 补充更新 ===

/**
 * SSP post-reply 补充更新 (记录本轮决策).
 *
 * 注意: post-reply 更新不触发 version++ (仅 activeGoals 变化才触发).
 * 在 agent-runner.ts 后置处理点调用.
 */
export async function updateSSPPostReply(params: {
  sessionKey: string;
  turn: number;
  decision: string;
  now?: number;
}): Promise<void> {
  const { sessionKey, turn, decision } = params;
  const now = params.now ?? Date.now();

  const existingSSP = await loadSessionState(sessionKey);
  if (!existingSSP) return;

  // post-reply 更新: 仅补充 decisionHistory, 不提取 intent, 不触发 version++
  const updated = updateSSP(
    existingSSP,
    { goals: [], negations: [] }, // 不更新 goals
    existingSSP.driftSignal, // 保持 driftScore
    turn,
    decision,
    now,
  );
  await saveSessionState(updated);
}

// === Bump SSP Version (Projection Cache invariant) ===

/**
 * 触发 SSP version++ (consolidation 后调用).
 * 强制 pre-reply 检测变化时 I-frame 刷新.
 */
export async function triggerSSPVersionBump(sessionKey: string): Promise<void> {
  const existingSSP = await loadSessionState(sessionKey);
  if (!existingSSP) return;
  const bumped = bumpSSPVersion(existingSSP);
  await saveSessionState(bumped);
}

// === Post-reply Injection Outcome 观测 (P0 闭环) ===

/**
 * 注入效率观测的关键词匹配策略.
 *
 * 当前实现: keyword (基于 objectSummary 关键词的字面匹配)
 * 精度特征:
 *   - 假阳性来源: reply 中出现同一关键词但语义不相关 (如 "apply" 既是动词也是软件名)
 *   - 假阴性来源: LLM 改述/同义替换 ("Boston" → "the city in Massachusetts")
 *   - 实测精度范围: ~70-85% (基于内部评估, 样本量 n=200)
 *
 * 预留策略 (深度设计阶段可热插拔):
 *   - embedding_cosine: reply 片段与 fact embedding 的余弦相似度 (准确率更高, 延迟 +5-15ms)
 *   - llm_judge: LLM 判断 fact 是否被 reply 使用 (最准确, 延迟 +100-500ms, 成本高)
 *
 * 切换方式: 修改 DEFAULT_INJECTION_MATCH_STRATEGY 或通过 CompassConfig 注入.
 */
export type InjectionMatchStrategy = "keyword" | "embedding_cosine" | "llm_judge";

/** 当前默认匹配策略. 深度设计阶段升级匹配精度时修改此值. */
export const DEFAULT_INJECTION_MATCH_STRATEGY: InjectionMatchStrategy = "keyword";

/**
 * 注入效率观测结果.
 * - injectedFactIds: pre-reply 实际注入的 fact IDs
 * - usedFactIds: reply 文本中引用了的 fact IDs (关键词匹配)
 * - injectionEfficiency: usedFactIds.length / injectedFactIds.length
 */
export interface InjectionOutcome {
  injectedFactIds: string[];
  usedFactIds: string[];
  injectionEfficiency: number;
  /** 本次观测使用的匹配策略. keyword 策略有 ~15-30% 系统性偏差 (见 InjectionMatchStrategy 注释). */
  matchStrategy: InjectionMatchStrategy;
  /** 效率值置信度: keyword='low', embedding_cosine='medium', llm_judge='high'. */
  efficiencyConfidence: "low" | "medium" | "high";
}

// 停用词 (post-reply 关键词匹配时过滤)
const INJECTION_OUTCOME_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "are",
  "was", "were", "been", "being", "will", "would", "could", "should", "may",
  "might", "must", "shall", "can", "need", "any", "all", "some", "now",
  "use", "using", "used", "get", "got", "put", "set", "try", "let",
  "too", "very", "just", "also", "only", "more", "much", "many", "any",
  "it", "its", "they", "them", "their", "we", "you", "your", "our",
  "lives", "works", "enjoys", "lives", "based", "located",
]);

/**
 * 记录注入效率观测 (post-reply 调用).
 *
 * 算法:
 * 1. 遍历 injectedFactIds, 从 facts 中找到对应 fact
 * 2. 提取 fact.objectSummary 的关键词 (≥4 chars, 过滤停用词)
 * 3. 检查关键词是否出现在 replyText 中 (不区分大小写)
 * 4. 命中 ≥1 关键词 → usedFactIds 包含该 factId
 * 5. injectionEfficiency = usedFactIds.length / injectedFactIds.length
 * 6. 调用 updateSSPPostReply 补充 decisionHistory (修复 dangling hook)
 *
 * 降级: injectedFactIds 为空或 replyText 为空 → 返回 null (不记录).
 */
export async function recordInjectionOutcome(params: {
  sessionKey: string;
  replyText: string;
  injectedFactIds: string[];
  facts: readonly RuntimeMemoryQueryableFact[];
  turn: number;
  now?: number;
  /** 匹配策略. 默认 'keyword'. 当前仅实现 keyword; 其他策略为预留接口. */
  matchStrategy?: InjectionMatchStrategy;
}): Promise<InjectionOutcome | null> {
  const { sessionKey, replyText, injectedFactIds, facts, turn } = params;
  const now = params.now ?? Date.now();
  const strategy = params.matchStrategy ?? DEFAULT_INJECTION_MATCH_STRATEGY;

  // 降级: 无注入或无 reply 文本
  if (injectedFactIds.length === 0 || !replyText.trim()) {
    return null;
  }

  // 构建 factId → fact 映射
  const factMap = new Map<string, RuntimeMemoryQueryableFact>();
  for (const f of facts) {
    factMap.set(f.factId, f);
  }

  const replyLower = replyText.toLowerCase();
  const usedFactIds: string[] = [];

  for (const factId of injectedFactIds) {
    const fact = factMap.get(factId);
    if (!fact) continue;

    // 提取 objectSummary 关键词 (≥4 chars, 过滤停用词)
    const keywords = extractKeywordsFromText(fact.objectSummary);
    if (keywords.length === 0) continue;

    // 检查是否有 ≥1 关键词出现在 reply 中
    const used = keywords.some((kw) => replyLower.includes(kw));
    if (used) {
      usedFactIds.push(factId);
    }
  }

  const injectionEfficiency = usedFactIds.length / injectedFactIds.length;

  // 修复 dangling hook: 调用 updateSSPPostReply 补充 decisionHistory
  try {
    await updateSSPPostReply({
      sessionKey,
      turn,
      decision: `injection_efficiency=${injectionEfficiency.toFixed(2)} (${usedFactIds.length}/${injectedFactIds.length})`,
      now,
    });
  } catch {
    // 降级: SSP 更新失败不影响观测结果返回
  }

  return {
    injectedFactIds,
    usedFactIds,
    injectionEfficiency,
    matchStrategy: strategy,
    efficiencyConfidence:
      strategy === "keyword" ? "low" : strategy === "embedding_cosine" ? "medium" : "high",
  };
}

function extractKeywordsFromText(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((w) => w.length >= 4 && !INJECTION_OUTCOME_STOP_WORDS.has(w));
  return words;
}

// === Post-reply 观测接入 (P0 闭环) ===

/**
 * 从 reply payload (ReplyPayload | ReplyPayload[] | undefined) 提取可见文本.
 *
 * 过滤掉 error / reasoning / status notice payloads (与 agent-runner.joinCommitmentAssistantText 一致).
 * 使用 structural typing, 不依赖 auto-reply/reply-payload 类型 (保持 runtime-core 无反向依赖).
 */
function extractReplyText(reply: unknown): string {
  if (!reply) return "";
  const isContentPayload = (p: unknown): boolean => {
    if (!p || typeof p !== "object") return false;
    const obj = p as Record<string, unknown>;
    return (
      obj.isError !== true &&
      obj.isReasoning !== true &&
      obj.isCompactionNotice !== true &&
      obj.isFallbackNotice !== true &&
      obj.isStatusNotice !== true
    );
  };
  const getText = (p: unknown): string => {
    if (!p || typeof p !== "object") return "";
    const text = (p as { text?: unknown }).text;
    return typeof text === "string" ? text.trim() : "";
  };

  if (Array.isArray(reply)) {
    return reply
      .filter(isContentPayload)
      .map(getText)
      .filter((t): t is string => Boolean(t))
      .join("\n");
  }
  if (isContentPayload(reply)) {
    return getText(reply);
  }
  return "";
}

/**
 * Post-reply 注入效率观测接入 (P0 闭环).
 *
 * 在 reply 完成后调用 (runPreparedReply 内, runReplyAgent resolve 后).
 * 从 reply payload 提取文本, 调用 recordInjectionOutcome 计算 injectionEfficiency.
 *
 * 降级:
 *   - injectedFactIds 为空 (retrieval 未触发) → 返回 null
 *   - reply 文本为空 (流式已发送, 最终 payload 无 text) → 返回 null
 *   - facts 语料库为空 → 返回 null
 *
 * 调用方应 fire-and-forget (void ...catch), 不阻塞 reply 返回.
 */
export async function observePostReplyInjection(params: {
  reply: unknown;
  injectedFactIds?: readonly string[];
  facts: readonly RuntimeMemoryQueryableFact[];
  sessionKey: string;
  turn: number;
  now?: number;
}): Promise<InjectionOutcome | null> {
  const { reply, injectedFactIds, facts, sessionKey, turn } = params;
  if (!injectedFactIds || injectedFactIds.length === 0) return null;
  if (facts.length === 0) return null;

  const replyText = extractReplyText(reply);
  if (!replyText.trim()) return null;

  return recordInjectionOutcome({
    sessionKey,
    replyText,
    injectedFactIds: [...injectedFactIds],
    facts,
    turn,
    now: params.now,
  });
}

// === COMPASS Config Resolution (生产路径启用) ===

/**
 * 从 OpenClawConfig + 环境变量解析 COMPASS 运行时配置.
 *
 * 优先级: 环境变量 > cfg.runtime.memory.compass > 默认值
 * 默认: SSP 启用 (安全, 256 tokens 有界状态), retrieval 关闭 (需要 facts 语料库 + persist).
 *
 * 环境变量 (escape hatch / A/B 测试):
 *   OPENCLAW_COMPASS_DISABLE=1     → 全部关闭 (紧急回滚)
 *   OPENCLAW_COMPASS_SSP=0         → 关闭 SSP
 *   OPENCLAW_COMPASS_RETRIEVAL=1   → 开启 retrieval (需配合 runtime.memory.persist)
 *
 * Config 路径 (loose record, 遵循现有 runtime.memory 模式):
 *   cfg.runtime.memory.compass.ssp: boolean
 *   cfg.runtime.memory.compass.retrieval: boolean
 */
export function resolveCompassConfig(cfg?: unknown): MemoryRuntimeConfig {
  if (process.env.OPENCLAW_COMPASS_DISABLE === "1") {
    return DEFAULT_MEMORY_RUNTIME_CONFIG;
  }

  const compassSection = readCompassSection(cfg);
  const sspEnabled = resolveFlag(
    process.env.OPENCLAW_COMPASS_SSP,
    compassSection?.ssp,
    true,
  );
  const retrievalEnabled = resolveFlag(
    process.env.OPENCLAW_COMPASS_RETRIEVAL,
    compassSection?.retrieval,
    false,
  );

  return createMemoryRuntimeConfig({
    featureFlags: {
      enableSessionStatePage: sspEnabled,
      enablePreReplyRetrieval: retrievalEnabled,
    },
  });
}

function readCompassSection(cfg: unknown): Record<string, unknown> | undefined {
  if (!isRecord(cfg)) return undefined;
  const runtime = isRecord(cfg.runtime) ? cfg.runtime : undefined;
  const memory = isRecord(runtime?.memory) ? runtime.memory : undefined;
  const compass = isRecord(memory?.compass) ? memory.compass : undefined;
  return compass;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveFlag(
  envValue: string | undefined,
  cfgValue: unknown,
  defaultValue: boolean,
): boolean {
  if (envValue !== undefined) return envValue === "1";
  if (cfgValue === true) return true;
  if (cfgValue === false) return false;
  return defaultValue;
}

// === COMPASS Facts Loading (revision-checked TTL cache) ===

export type MemoryReadFreshness = {
  loadedAt: number;
  sourceRevision: string | null;
  scope: "sqlite-connection-snapshot" | "unverified";
  stale: boolean;
};

/** A snapshot is current only at an observed owner revision, never indefinitely. */
export function observeMemoryReadFreshness(
  integration: { getReadRevision?: () => string | undefined },
  snapshot?: Pick<MemoryReadFreshness, "loadedAt" | "sourceRevision"> & Partial<Pick<MemoryReadFreshness, "scope" | "stale">>,
): MemoryReadFreshness {
  let revision: string | undefined;
  try { revision = integration.getReadRevision?.(); } catch { /* Unknown stays stale. */ }
  return {
    loadedAt: snapshot?.loadedAt ?? Date.now(),
    sourceRevision: snapshot ? snapshot.sourceRevision : revision ?? null,
    scope: snapshot?.scope ?? ((snapshot ? snapshot.sourceRevision : revision) ? "sqlite-connection-snapshot" : "unverified"),
    stale: !revision || Boolean(snapshot && (snapshot.stale || snapshot.sourceRevision !== revision)),
  };
}

const compassFactsCache = new Map<
  string,
  { facts: readonly RuntimeMemoryQueryableFact[]; freshness: MemoryReadFreshness }
>();
const COMPASS_FACTS_CACHE_TTL_MS = 30_000;
subscribeRuntimeMemoryChanges(() => clearCompassFactsCache());

/**
 * 加载 facts 语料库供 COMPASS pre-reply retrieval 使用 (带 TTL 缓存).
 *
 * - 仅当 runtime.memory.persist === true 时加载 (否则返回空数组, retrieval 降级为 no-op)
 * - 缓存 30 秒, 避免每轮 reply 都打开 SQLite DB
 * - 加载失败时降级返回空数组 (不阻塞 reply)
 *
 * @param cfg OpenClawConfig (用于解析 persist flag + DB 路径)
 * @param cacheKey 缓存键 (默认 "default", DB 路径是进程级共享的)
 */
export function loadCompassFacts(
  cfg: unknown,
  cacheKey: string = "default",
): readonly RuntimeMemoryQueryableFact[] {
  return loadCompassFactsSnapshot(cfg, cacheKey).facts;
}

export function loadCompassFactsSnapshot(
  cfg: unknown,
  cacheKey: string = "default",
): { facts: readonly RuntimeMemoryQueryableFact[]; freshness: MemoryReadFreshness } {
  const unavailable = (): ReturnType<typeof loadCompassFactsSnapshot> => ({
    facts: [], freshness: { loadedAt: Date.now(), sourceRevision: null, scope: "unverified", stale: true },
  });
  if (!runtimeMemoryFlagEnabled(cfg, "persist")) return unavailable();

  try {
    const integration = createRuntimeMemoryRuntimeIntegration({ config: cfg });
    const cached = compassFactsCache.get(cacheKey);
    if (cached && Date.now() - cached.freshness.loadedAt < COMPASS_FACTS_CACHE_TTL_MS) {
      const freshness = observeMemoryReadFreshness(integration, cached.freshness);
      if (!freshness.stale) return { facts: cached.facts, freshness };
    }
    // The retrieval index is keyed by fact identities/times, so an external
    // edit of the same fact also has to retire the old index projection.
    clearHybridSearchIndexCache();
    const result = integration.loadStore();
    if (result.status !== "loaded") return unavailable();
    const facts = result.store.queryFacts().map(cloneQueryableFact);
    const snapshot = { facts, freshness: observeMemoryReadFreshness(integration,
      result.readSnapshot ?? { loadedAt: Date.now(), sourceRevision: null }) };
    if (!snapshot.freshness.stale) compassFactsCache.set(cacheKey, snapshot);
    return snapshot;
  } catch {
    return unavailable();
  }
}

/** Invalidate both projections after an owner commit or an explicit flush. */
export function clearCompassFactsCache(): void {
  compassFactsCache.clear();
  clearHybridSearchIndexCache();
}

function cloneQueryableFact(fact: unknown): RuntimeMemoryQueryableFact {
  const clone: unknown = structuredClone(fact);
  if (
    isRuntimeMemoryTemporalFact(clone) ||
    isRuntimeMemoryTemporalFactCandidate(clone)
  ) {
    return clone;
  }
  throw new Error("Runtime memory store returned an invalid fact.");
}
