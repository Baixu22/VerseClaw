// Week 7-8 WP0 测试: Feature Flags 与配置 hash.
//
// Source: Week 7-8 DEV PROMPT WP0 验收要求
//
// 覆盖:
//   - configHash 对同配置稳定
//   - 任一 flag 变更导致 configHash 变更
//   - trace 中 fingerprint 字段完整
//   - 默认配置: 所有 flag false + hashAlg=sha256
//   - createMemoryRuntimeConfig override 正确

import { describe, it, expect } from "vitest";
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  createMemoryRuntimeConfig,
  computeConfigHash,
  buildRuntimeFingerprint,
} from "../../openclaw_runtime/src/runtime-core/memory-runtime-config.js";
import { createRecallTraceBuilder } from "../../openclaw_runtime/src/runtime-core/memory-trace.js";

describe("WP0: MemoryRuntimeConfig + configHash + fingerprint", () => {
  describe("computeConfigHash", () => {
    it("should be stable for same config", () => {
      const config1 = createMemoryRuntimeConfig();
      const config2 = createMemoryRuntimeConfig();
      expect(computeConfigHash(config1)).toBe(computeConfigHash(config2));
    });

    it("should change when enableEntityResolverInBridge flips", () => {
      const baseline = createMemoryRuntimeConfig();
      const modified = createMemoryRuntimeConfig({
        featureFlags: { enableEntityResolverInBridge: true },
      });
      expect(computeConfigHash(baseline)).not.toBe(computeConfigHash(modified));
    });

    it("should change when enableWeightedTraversalInExpansion flips", () => {
      const baseline = createMemoryRuntimeConfig();
      const modified = createMemoryRuntimeConfig({
        featureFlags: { enableWeightedTraversalInExpansion: true },
      });
      expect(computeConfigHash(baseline)).not.toBe(computeConfigHash(modified));
    });

    it("should change when enableEvidenceDiscipline flips", () => {
      const baseline = createMemoryRuntimeConfig();
      const modified = createMemoryRuntimeConfig({
        featureFlags: { enableEvidenceDiscipline: true },
      });
      expect(computeConfigHash(baseline)).not.toBe(computeConfigHash(modified));
    });

    it("should change when eventLogHashAlg changes", () => {
      const sha256 = createMemoryRuntimeConfig({ eventLogHashAlg: "sha256" });
      const djb2 = createMemoryRuntimeConfig({ eventLogHashAlg: "djb2" });
      expect(computeConfigHash(sha256)).not.toBe(computeConfigHash(djb2));
    });
  });

  describe("DEFAULT_MEMORY_RUNTIME_CONFIG", () => {
    it("should have all feature flags false by default", () => {
      expect(DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags.enableEntityResolverInBridge).toBe(false);
      expect(DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags.enableWeightedTraversalInExpansion).toBe(false);
      expect(DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags.enableEvidenceDiscipline).toBe(false);
    });

    it("should default to sha256 hash algorithm", () => {
      expect(DEFAULT_MEMORY_RUNTIME_CONFIG.eventLogHashAlg).toBe("sha256");
    });
  });

  describe("createMemoryRuntimeConfig", () => {
    it("should merge feature flags correctly", () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableEntityResolverInBridge: true },
      });
      expect(config.featureFlags.enableEntityResolverInBridge).toBe(true);
      // 其他 flag 保持默认 false
      expect(config.featureFlags.enableWeightedTraversalInExpansion).toBe(false);
      expect(config.featureFlags.enableEvidenceDiscipline).toBe(false);
    });

    it("should override eventLogHashAlg", () => {
      const config = createMemoryRuntimeConfig({ eventLogHashAlg: "djb2" });
      expect(config.eventLogHashAlg).toBe("djb2");
    });
  });

  describe("buildRuntimeFingerprint", () => {
    it("should produce complete fingerprint with configHash + featureFlags + hashAlg", () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableEvidenceDiscipline: true },
      });
      const fp = buildRuntimeFingerprint(config);
      expect(fp.configHash).toMatch(/^cfg_[a-f0-9]+$/);
      expect(fp.featureFlags).toEqual(config.featureFlags);
      expect(fp.hashAlg).toBe(config.eventLogHashAlg);
    });

    it("should default to DEFAULT_MEMORY_RUNTIME_CONFIG when no arg", () => {
      const fp = buildRuntimeFingerprint();
      expect(fp.hashAlg).toBe("sha256");
      expect(fp.featureFlags.enableEntityResolverInBridge).toBe(false);
    });

    it("should be writable to RecallTrace via builder", () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableEntityResolverInBridge: true },
      });
      const fp = buildRuntimeFingerprint(config);
      const builder = createRecallTraceBuilder({
        questionId: "Q1",
        query: "test",
      });
      builder.setRuntimeFingerprint(fp);
      const trace = builder.build();
      expect(trace.runtimeFingerprint).toBeDefined();
      expect(trace.runtimeFingerprint?.configHash).toBe(fp.configHash);
      expect(trace.runtimeFingerprint?.featureFlags.enableEntityResolverInBridge).toBe(true);
    });
  });
});
