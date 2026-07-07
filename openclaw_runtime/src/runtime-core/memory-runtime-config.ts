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
