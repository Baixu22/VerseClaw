// Week 7-8 WP0: 统一的 MemoryRuntimeConfig + configHash + fingerprint.
//
// Source: Week 7-8 DEV PROMPT WP0
//
// 设计目标:
//   - 每个新策略可开关、可 A/B、写入 trace
//   - configHash: 对关键 config 做稳定 hash (用于 A/B 对比)
//   - fingerprint: 写入 RecallTrace, 记录 configHash + featureFlags + hashAlg
//
// 约束:
//   - 所有 feature flag 默认关闭, 不破坏现有基线
//   - 不引入第三方依赖 (djb2 + stableStringify 即可, configHash 不需要密码学强度)
//   - 与 WP1 的 SHA-256 hashAlg 独立 (configHash 只用于 A/B 标识)

// === Schema ===

/**
 * Week 7-8 引入的 feature flags.
 *
 * 所有 flag 默认 false, 确保基线不变.
 * 通过 MemoryRuntimeConfig 传入, 写入 RecallTrace.runtimeFingerprint.featureFlags.
 */
export type MemoryFeatureFlags = {
  /**
   * WP2: 在 bridge discovery 路径上启用 EntityResolver (canonicalize e1/e2 + 候选 fact entities).
   * 默认 false. 启用后 multi-hop 的 pathExistence/bridgeCandidateCount 可能提升.
   */
  enableEntityResolverInBridge: boolean;

  /**
   * WP3: 在 constrained expansion 中启用 weighted traversal (best-first 排序, 偏向 causal 边).
   * 默认 false. 启用后 expansion 的 selectedEdges 会偏向 causes/caused_by/enables.
   */
  enableWeightedTraversalInExpansion: boolean;

  /**
   * WP4: 在 generate/finalize 阶段启用 evidence discipline (usedFactIds 校验 + 降级).
   * 默认 false. 启用后模型输出必须包含 usedFactIds 且是 recalledFacts 的子集.
   */
  enableEvidenceDiscipline: boolean;

  // === COMPASS 2.0 × ClawX 融合 flags ===

  /**
   * COMPASS L-1: 启用 Session State Page (256 tokens 有界状态).
   * 默认 false. 启用后 pre-reply 会加载/更新/注入 SSP 到 extraSystemPromptParts.
   */
  enableSessionStatePage: boolean;

  /**
   * COMPASS 应用层: 启用 pre-reply hybrid retrieval top-5 注入.
   * 默认 false. 启用后 pre-reply 会调用 hybridSearchFactsWithEmbedding 取 top-5 facts.
   */
  enablePreReplyRetrieval: boolean;

  /**
   * COMPASS L0: 启用 U_decision 排序 (expansionFactor × finalScore × actionCoupling).
   * 默认 false. 启用后替代 confidence 排序.
   */
  enableUDecisionRanking: boolean;

  /**
   * COMPASS L1 v2: 启用成本感知驱逐 v2 (value 用 U_decision).
   * 默认 false. 启用后 computeEvictionScore 的 value 来源切换到 U_decision.
   */
  enableCostAwareEvictionV2: boolean;

  /**
   * COMPASS L3: 启用 ConfigVersionTree 版本化配置.
   * 默认 false. 启用后支持 feature flag 安全回滚.
   */
  enableConfigVersionTree: boolean;
};

/**
 * Event log hash 算法标记.
 *
 * - djb2: 旧链 (Week 6), 非密码学, 仅用于兼容
 * - sha256: Week 7 新链, 密码学 hash, 用于审计完整性
 *
 * 默认 sha256 (WP1 要求).
 */
export type EventLogHashAlg = "djb2" | "sha256";

/**
 * 统一的 Memory runtime 配置.
 *
 * 包含 feature flags + hashAlg + 其他可调参数.
 * 调用方构造此对象, 传给各组件.
 */
export type MemoryRuntimeConfig = {
  /** Feature flags (所有 flag 默认 false) */
  featureFlags: MemoryFeatureFlags;

  /** Event log hash 算法 (默认 sha256, WP1) */
  eventLogHashAlg: EventLogHashAlg;
};

/**
 * 默认配置: 所有 feature flag 关闭, hashAlg=sha256.
 *
 * 确保不破坏现有基线.
 */
export const DEFAULT_MEMORY_RUNTIME_CONFIG: MemoryRuntimeConfig = {
  featureFlags: {
    enableEntityResolverInBridge: false,
    enableWeightedTraversalInExpansion: false,
    enableEvidenceDiscipline: false,
    // COMPASS 2.0 flags — 默认全 false, 确保零风险部署
    enableSessionStatePage: false,
    enablePreReplyRetrieval: false,
    enableUDecisionRanking: false,
    enableCostAwareEvictionV2: false,
    enableConfigVersionTree: false,
  },
  eventLogHashAlg: "sha256",
};

/**
 * 创建带 override 的配置 (便捷工具).
 *
 * 用法:
 *   const config = createMemoryRuntimeConfig({
 *     featureFlags: { enableEntityResolverInBridge: true }
 *   });
 */
export function createMemoryRuntimeConfig(
  override: Partial<MemoryRuntimeConfig> & {
    featureFlags?: Partial<MemoryFeatureFlags>;
  } = {},
): MemoryRuntimeConfig {
  const featureFlags: MemoryFeatureFlags = {
    ...DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags,
    ...(override.featureFlags ?? {}),
  };
  return {
    featureFlags,
    eventLogHashAlg: override.eventLogHashAlg ?? DEFAULT_MEMORY_RUNTIME_CONFIG.eventLogHashAlg,
  };
}

// === configHash ===

/**
 * 对关键 config 做稳定 hash (djb2, 16 进制).
 *
 * 用于 A/B 对比: 同 config → 同 hash; 任一 flag 变更 → hash 变更.
 *
 * 注意: 这是标识性 hash, 不是密码学 hash. 密码学完整性由 WP1 的 SHA-256 保证.
 */
export function computeConfigHash(config: MemoryRuntimeConfig): string {
  const stable = stableStringify({
    featureFlags: config.featureFlags,
    eventLogHashAlg: config.eventLogHashAlg,
  });
  return `cfg_${djb2Hash(stable)}`;
}

// === RuntimeFingerprint (写入 RecallTrace) ===

/**
 * Runtime fingerprint, 写入 RecallTrace.
 *
 * 用于 A/B 对比和可审计性:
 *   - configHash: 标识本次运行使用的配置
 *   - featureFlags: 展开记录 (便于读 trace)
 *   - hashAlg: event log hash 算法
 */
export type RuntimeFingerprint = {
  /** 配置 hash (同 config → 同 hash) */
  configHash: string;
  /** Feature flags 展开 (便于读 trace) */
  featureFlags: MemoryFeatureFlags;
  /** Event log hash 算法 */
  hashAlg: EventLogHashAlg;
};

/**
 * 从 config 构建 fingerprint.
 */
export function buildRuntimeFingerprint(
  config: MemoryRuntimeConfig = DEFAULT_MEMORY_RUNTIME_CONFIG,
): RuntimeFingerprint {
  return {
    configHash: computeConfigHash(config),
    featureFlags: { ...config.featureFlags },
    hashAlg: config.eventLogHashAlg,
  };
}

// === 内部工具 (djb2 + stableStringify, 与 event log 共用风格) ===

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16);
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      `"${k}":${stableStringify((obj as Record<string, unknown>)[k])}`,
  );
  return `{${pairs.join(",")}}`;
}

// === COMPASS 2.0 L3: ConfigVersionTree (版本化配置) ===
//
// Source: COMPASS 2.0 × ClawX 融合设计 L3
//
// 设计目标:
//   - 支持 feature flag 安全回滚: 当新能力导致性能退化时, 可快速回滚到上一稳定版本
//   - 纯内存数据结构 (不落盘), 调用方负责持久化 (如需)
//   - 版本号: semver patch 递增 (1.0.0 → 1.0.1 → 1.0.2)
//   - 回滚语义: currentVersion 回退, history 截断, nodes 保留 (支持再次前进)
//
// 约束:
//   - 不引入第三方依赖
//   - 与 configHash 独立 (configHash 用于 A/B 标识, ConfigVersionTree 用于回滚)

const CONFIG_VERSION_ROOT = "1.0.0" as const;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * ConfigVersionTree 的节点 — 一个版本对应一个 config 快照.
 */
export interface ConfigVersionNode {
  /** semver, e.g. "1.0.0" */
  version: string;
  /** 该版本的 config 快照 */
  config: MemoryRuntimeConfig;
  /** 父版本 (形成树, root 无父版本) */
  parentVersion?: string;
  /** 创建时间 (Unix ms) */
  createdAt: number;
  /** 变更原因 */
  reason: string;
}

/**
 * 版本化配置树.
 *
 * - nodes: 所有版本节点 (version → node), 保留历史支持回滚后前进
 * - currentVersion: 当前生效版本
 * - history: 按时间排序的 version 链 (root → current)
 */
export interface ConfigVersionTree {
  nodes: Map<string, ConfigVersionNode>;
  currentVersion: string;
  history: string[];
}

/**
 * 创建初始 ConfigVersionTree, root 版本为 "1.0.0".
 */
export function createConfigVersionTree(
  initial: MemoryRuntimeConfig,
  now: number = Date.now(),
): ConfigVersionTree {
  const rootNode: ConfigVersionNode = {
    version: CONFIG_VERSION_ROOT,
    config: { ...initial, featureFlags: { ...initial.featureFlags } },
    createdAt: now,
    reason: "initial",
  };
  return {
    nodes: new Map([[CONFIG_VERSION_ROOT, rootNode]]),
    currentVersion: CONFIG_VERSION_ROOT,
    history: [CONFIG_VERSION_ROOT],
  };
}

/**
 * 提交新版本 (创建新节点, 更新 currentVersion + history).
 *
 * 版本号: 基于 currentVersion 做 patch 级递增 (1.0.0 → 1.0.1).
 *
 * @returns 新版本号
 */
export function commitConfigVersion(
  tree: ConfigVersionTree,
  config: MemoryRuntimeConfig,
  reason: string,
  now: number = Date.now(),
): string {
  const newVersion = bumpPatchVersion(tree.currentVersion);
  const node: ConfigVersionNode = {
    version: newVersion,
    config: { ...config, featureFlags: { ...config.featureFlags } },
    parentVersion: tree.currentVersion,
    createdAt: now,
    reason,
  };
  tree.nodes.set(newVersion, node);
  tree.currentVersion = newVersion;
  tree.history.push(newVersion);
  return newVersion;
}

/**
 * 回滚到指定版本.
 *
 * - 将 currentVersion 设为 targetVersion
 * - history 截断到 targetVersion 之前 (含 targetVersion)
 * - nodes 保留 (支持再次前进到被回滚的版本)
 *
 * @returns 回滚后的 config, 找不到版本时返回 undefined
 */
export function rollbackConfigVersion(
  tree: ConfigVersionTree,
  targetVersion: string,
): MemoryRuntimeConfig | undefined {
  const node = tree.nodes.get(targetVersion);
  if (!node) return undefined;

  tree.currentVersion = targetVersion;
  // history 截断到 targetVersion (含)
  const targetIdx = tree.history.indexOf(targetVersion);
  if (targetIdx !== -1) {
    tree.history = tree.history.slice(0, targetIdx + 1);
  }
  return { ...node.config, featureFlags: { ...node.config.featureFlags } };
}

/**
 * 获取指定版本的 config (不改变 currentVersion).
 *
 * @returns 该版本的 config, 找不到版本时返回 undefined
 */
export function getConfigAtVersion(
  tree: ConfigVersionTree,
  version: string,
): MemoryRuntimeConfig | undefined {
  const node = tree.nodes.get(version);
  if (!node) return undefined;
  return { ...node.config, featureFlags: { ...node.config.featureFlags } };
}

/**
 * 递增 patch 版本号 (1.0.0 → 1.0.1).
 */
function bumpPatchVersion(version: string): string {
  const match = version.match(SEMVER_PATTERN);
  if (!match) return CONFIG_VERSION_ROOT;
  const parts = version.split(".").map((p) => parseInt(p, 10));
  parts[2] += 1;
  return parts.join(".");
}
