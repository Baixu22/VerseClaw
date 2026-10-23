// @vitest-environment node
// COMPASS 2.0 体验收益验收测试 — 真实多轮对话场景.
//
// 目标：量化 COMPASS 启用前后对"用户好用 + Agent 好处理"的实际收益.
// 测量维度：
//   1. Prompt 体积压缩（SSP 256 tokens 有界 vs 全量 facts 注入）
//   2. SSP 状态演进（多轮对话中 activeGoals/resolvedConstraints 的追踪）
//   3. 信息分层效果（Full facts vs Structured summary vs Pointer）
//   4. Pre-reply top-5 retrieval 命中率
//   5. I-frame 刷新检测（version 变化触发）
//
// 场景：模拟用户 Alice 与 agent 的 5 轮对话，涉及目标变更、否定约束、多主题切换.
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildPreReplyInjection,
  serializeTop5Facts,
  recordInjectionOutcome,
  observePostReplyInjection,
} from "../../openclaw_runtime/src/runtime-core/memory-pre-reply-injection";
import {
  createInitialSSP,
  extractIntent,
  serializeSSPForPrompt,
  updateSSP,
  type SessionStatePage,
} from "../../openclaw_runtime/src/runtime-core/memory-session-state";
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  createMemoryRuntimeConfig,
} from "../../openclaw_runtime/src/runtime-core/memory-runtime-config";
import { NO_EMBEDDING_PROVIDER } from "../../openclaw_runtime/src/runtime-core/memory-embedding-provider";
import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context";
import type { HybridSearchHit } from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";

// === Token 估算 (与项目一致: chars / 4) ===
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// === 构造真实 fact 语料库 (模拟长期记忆) ===
function makeFact(opts: {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence?: number;
  validAt?: number;
}): RuntimeMemoryQueryableFact {
  const ts = opts.validAt ?? 1000;
  return {
    schemaVersion: 1 as const,
    factId: opts.factId,
    subject: opts.subject,
    predicate: opts.predicate,
    objectSummary: opts.objectSummary,
    confidence: opts.confidence ?? 0.9,
    source: "tool_result" as const,
    verificationStatus: "verified" as const,
    sourceEpisodeRefs: [{ episodeId: "ep-test" }],
    evidenceRefs: [{ type: "manual" as const, ref: "test-evidence" }],
    proposedAt: ts,
    valid_at: ts,
    reference_time: ts,
    acceptedAt: ts,
    promotion: {
      promotedBy: "verifier" as const,
      evidenceRefs: [{ type: "manual" as const, ref: "test-evidence" }],
    },
  };
}

// === 模拟 fact 语料库 (20 条 facts, 模拟长期记忆) ===
const MOCK_FACTS: RuntimeMemoryQueryableFact[] = [
  makeFact({ factId: "f1", subject: "alice", predicate: "lives_in", objectSummary: "lives in Boston, Massachusetts", validAt: 1000 }),
  makeFact({ factId: "f2", subject: "alice", predicate: "works_at", objectSummary: "works as a software engineer at Google", validAt: 1100 }),
  makeFact({ factId: "f3", subject: "alice", predicate: "hobby", objectSummary: "enjoys hiking on weekends, especially in the White Mountains", validAt: 1200 }),
  makeFact({ factId: "f4", subject: "alice", predicate: "has_pet", objectSummary: "has a golden retriever named Max who is 3 years old", validAt: 1300 }),
  makeFact({ factId: "f5", subject: "alice", predicate: "studies", objectSummary: "studying for a master's degree in computer science at MIT", validAt: 1400 }),
  makeFact({ factId: "f6", subject: "alice", predicate: "speaks", objectSummary: "speaks fluent English, Mandarin Chinese, and intermediate Japanese", validAt: 1500 }),
  makeFact({ factId: "f7", subject: "alice", predicate: "favorite_food", objectSummary: "loves Italian food, especially homemade pasta and wood-fired pizza", validAt: 1600 }),
  makeFact({ factId: "f8", subject: "alice", predicate: "birthday", objectSummary: "birthday is March 15th, likes to celebrate with close friends", validAt: 1700 }),
  makeFact({ factId: "f9", subject: "alice", predicate: "car", objectSummary: "drives a blue Toyota Prius that she bought in 2022", validAt: 1800 }),
  makeFact({ factId: "f10", subject: "alice", predicate: "music", objectSummary: "plays the piano and enjoys classical music by Chopin", validAt: 1900 }),
  makeFact({ factId: "f11", subject: "bob", predicate: "lives_in", objectSummary: "lives in Seattle, Washington, works from home", validAt: 2000 }),
  makeFact({ factId: "f12", subject: "bob", predicate: "works_at", objectSummary: "is a product manager at Microsoft", validAt: 2100 }),
  makeFact({ factId: "f13", subject: "bob", predicate: "hobby", objectSummary: "enjoys photography and landscape nature shoots", validAt: 2200 }),
  makeFact({ factId: "f14", subject: "project_alpha", predicate: "status", objectSummary: "project alpha is in the testing phase, expected launch next month", validAt: 2300 }),
  makeFact({ factId: "f15", subject: "project_alpha", predicate: "team", objectSummary: "team consists of 5 engineers led by Alice with Bob as PM", validAt: 2400 }),
  makeFact({ factId: "f16", subject: "project_beta", predicate: "status", objectSummary: "project beta was cancelled due to budget constraints", validAt: 2500 }),
  makeFact({ factId: "f17", subject: "alice", predicate: "moved_to", objectSummary: "previously lived in NYC before moving to Boston in 2023", validAt: 2600 }),
  makeFact({ factId: "f18", subject: "alice", predicate: "allergy", objectSummary: "allergic to peanuts and shellfish, carries an EpiPen", validAt: 2700 }),
  makeFact({ factId: "f19", subject: "team", predicate: "meeting", objectSummary: "weekly team meetings every Monday at 10am via Zoom", validAt: 2800 }),
  makeFact({ factId: "f20", subject: "alice", predicate: "vacation", objectSummary: "planning a vacation to Japan in autumn for cherry blossom season", validAt: 2900 }),
];

// === Mock SSP 落盘 (隔离测试, 不写入真实文件系统) ===
const sspStore = new Map<string, SessionStatePage>();

vi.mock("../../openclaw_runtime/src/runtime-core/memory-session-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../openclaw_runtime/src/runtime-core/memory-session-state")>();
  return {
    ...actual,
    loadSessionState: async (sessionKey: string) => sspStore.get(sessionKey) ?? null,
    saveSessionState: async (ssp: SessionStatePage) => {
      sspStore.set(ssp.sessionId, ssp);
    },
  };
});


// === 验收测试 ===
describe("COMPASS 2.0 体验收益验收", () => {
  beforeEach(() => {
    sspStore.clear();
  });

  describe("维度 1: Prompt 体积压缩", () => {
    it("SSP 序列化 ≤256 tokens (1024 chars 硬上限)", () => {
      const ssp = createInitialSSP("test-session", extractIntent("Deploy the Rust service to production and notify the team"), 1000);
      const serialized = serializeSSPForPrompt(ssp);
      const tokens = estimateTokens(serialized);

      expect(serialized.length).toBeLessThanOrEqual(1024);
      expect(tokens).toBeLessThanOrEqual(256);
    });

    it("SSP 在 goals 满载时仍 ≤256 tokens", () => {
      const ssp = createInitialSSP("test-session", { goals: [], negations: [] }, 1000);
      // 手动填满 4 个 goals (每个 80 chars)
      const fullSSP: SessionStatePage = {
        ...ssp,
        activeGoals: [
          "Deploy the Rust service to production environment with full CI/CD pipeline and monitoring dashboard configured",
          "Set up the Kubernetes cluster with auto-scaling rules and health checks for all microservices in the system",
          "Configure the database replication across three regions with automatic failover and backup rotation policies set",
          "Implement the authentication middleware with OAuth2 support and role-based access control for all API endpoints",
        ],
        resolvedConstraints: [
          "TypeScript version pinned to 5.3",
          "PostgreSQL 15 selected as primary database",
          "Docker containerization adopted for all services",
        ],
        openQuestions: [
          "Should we use Redis or Memcached for caching?",
          "What is the expected QPS for peak traffic?",
        ],
      };
      const serialized = serializeSSPForPrompt(fullSSP);
      const tokens = estimateTokens(serialized);

      expect(serialized.length).toBeLessThanOrEqual(1024);
      expect(tokens).toBeLessThanOrEqual(256);
    });

    it("基线 vs COMPASS: 注入 20 条 facts 全量 vs SSP+top5 的 token 对比", () => {
      // 基线：暴力注入全部 20 条 facts 的 objectSummary
      const baselineFullInjection = MOCK_FACTS
        .map((f, i) => `${i + 1}. ${f.subject}: ${f.objectSummary} (conf: ${(f.confidence ?? 0).toFixed(2)})`)
        .join("\n");
      const baselineTokens = estimateTokens(baselineFullInjection);

      // COMPASS: SSP (≤256 tokens) + top-5 facts 序列化
      const mockHits: HybridSearchHit[] = MOCK_FACTS.slice(0, 5).map((f) => ({
        fact: f,
        rrfScore: 0.5,
        bm25Score: 0.3,
        entityScore: 0.2,
        semanticScore: 0,
        expansionRank: undefined,
      } as unknown as HybridSearchHit));
      const compassTop5 = serializeTop5Facts(mockHits);
      const compassSSP = serializeSSPForPrompt(
        createInitialSSP("test", extractIntent("What does Alice do?"), 1000)
      );
      const compassTokens = estimateTokens(compassSSP) + estimateTokens(compassTop5);

      // 量化断言
      expect(compassTokens).toBeLessThan(baselineTokens);
      const compressionRatio = ((baselineTokens - compassTokens) / baselineTokens * 100).toFixed(1);

      // 输出对比数据 (测试报告中可见)
      console.log(`\n  [Prompt 体积对比]`);
      console.log(`    基线 (20 facts 全量注入): ${baselineTokens} tokens, ${baselineFullInjection.length} chars`);
      console.log(`    COMPASS (SSP + top-5): ${compassTokens} tokens (SSP: ${estimateTokens(compassSSP)}, top5: ${estimateTokens(compassTop5)})`);
      console.log(`    压缩率: ${compressionRatio}%`);
      console.log(`    节省: ${baselineTokens - compassTokens} tokens/轮`);
    });
  });

  // TF-0500: the pre-reply SSP / top-5 injection path is RETIRED.
  //
  // Dimensions 2-6 used to accept the *benefit* of injecting SSP and top-5 facts into the
  // prompt (goal tracking, retrieval hit rate, I-frame refresh, the combined multi-turn flow
  // and the layering effect). That injection was a second prompt authority next to
  // dcs-context-authority, so it is retired and those benefit claims are superseded. What
  // remains verifiable is the retirement itself; the low-level helpers other dimensions still
  // exercise (serialization bounds, post-reply observation, goal evolution) are unchanged.
  describe("维度 2-6 (superseded): pre-reply injection is retired", () => {
    it("produces no prompt text even when the retired flags are requested", async () => {
      const requested = {
        ...DEFAULT_MEMORY_RUNTIME_CONFIG,
        featureFlags: {
          ...DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags,
          enableSessionStatePage: true,
          enablePreReplyRetrieval: true,
        },
      };
      const result = await buildPreReplyInjection({
        sessionKey: "agent:main:main",
        userInputText: "Alice lives where?",
        config: requested,
        facts: [makeFact({ factId: "f1", subject: "alice", predicate: "lives_in", objectSummary: "Boston" })],
        embeddingProvider: NO_EMBEDDING_PROVIDER,
      });
      expect(result.sspString).toBeUndefined();
      expect(result.top5FactsString).toBeUndefined();
      expect(result.injectedFactIds ?? []).toHaveLength(0);
      expect(result.iFrameRefreshed).toBe(false);
    });

    it("keeps the two injection flags off through the config factory", () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableSessionStatePage: true, enablePreReplyRetrieval: true },
      });
      expect(config.featureFlags.enableSessionStatePage).toBe(false);
      expect(config.featureFlags.enablePreReplyRetrieval).toBe(false);
    });
  });

  // === 维度 7: Post-reply 注入效率观测 ===
  describe("维度 7: Post-reply 注入效率观测", () => {
    it("recordInjectionOutcome 在 injectedFactIds 为空时返回 null", async () => {
      const outcome = await recordInjectionOutcome({
        sessionKey: "test-null",
        replyText: "Some reply text",
        injectedFactIds: [],
        facts: MOCK_FACTS,
        turn: 1,
        now: 1000,
      });
      expect(outcome).toBeNull();
    });

    it("recordInjectionOutcome 在 replyText 为空时返回 null", async () => {
      const outcome = await recordInjectionOutcome({
        sessionKey: "test-empty-reply",
        replyText: "",
        injectedFactIds: ["f1", "f2"],
        facts: MOCK_FACTS,
        turn: 1,
        now: 1000,
      });
      expect(outcome).toBeNull();
    });

    it("recordInjectionOutcome 在 reply 文本包含 fact 关键词时正确识别 usedFactIds", async () => {
      // f1: "lives in Boston, Massachusetts" → 关键词包含 "boston"
      // f11: "lives in Seattle, Washington, works from home" → 关键词包含 "seattle"
      // reply 提到 "boston" → f1 被使用, f11 未被使用
      const outcome = await recordInjectionOutcome({
        sessionKey: "test-used",
        replyText: "Alice is based in the Boston area, she mentioned it last week.",
        injectedFactIds: ["f1", "f11"],
        facts: MOCK_FACTS,
        turn: 1,
        now: 1000,
      });

      expect(outcome).not.toBeNull();
      expect(outcome!.injectedFactIds).toEqual(["f1", "f11"]);
      expect(outcome!.usedFactIds).toContain("f1");
      expect(outcome!.usedFactIds).not.toContain("f11");
      expect(outcome!.injectionEfficiency).toBeCloseTo(0.5, 2);
    });

    it("recordInjectionOutcome 的 injectionEfficiency 在全部命中时为 1.0", async () => {
      // reply 同时提到 boston 和 seattle
      const outcome = await recordInjectionOutcome({
        sessionKey: "test-all-used",
        replyText: "Alice lives in Boston while Bob lives in Seattle.",
        injectedFactIds: ["f1", "f11"],
        facts: MOCK_FACTS,
        turn: 1,
        now: 1000,
      });

      expect(outcome).not.toBeNull();
      expect(outcome!.usedFactIds).toEqual(["f1", "f11"]);
      expect(outcome!.injectionEfficiency).toBe(1.0);
    });

    it("recordInjectionOutcome 在无关键词命中时 efficiency 为 0", async () => {
      const outcome = await recordInjectionOutcome({
        sessionKey: "test-none-used",
        replyText: "The weather is nice today, let's go for a walk.",
        injectedFactIds: ["f1", "f11"],
        facts: MOCK_FACTS,
        turn: 1,
        now: 1000,
      });

      expect(outcome).not.toBeNull();
      expect(outcome!.usedFactIds).toEqual([]);
      expect(outcome!.injectionEfficiency).toBe(0);
    });

    // === P0: observePostReplyInjection (从 reply payload 提取文本) ===

    it("observePostReplyInjection 从单个 ReplyPayload 提取文本并计算 efficiency", async () => {
      const outcome = await observePostReplyInjection({
        reply: { text: "Alice lives in Boston, works at Google." },
        injectedFactIds: ["f1", "f2"],
        facts: MOCK_FACTS,
        sessionKey: "test-observe-single",
        turn: 1,
        now: 1000,
      });
      expect(outcome).not.toBeNull();
      expect(outcome!.usedFactIds).toContain("f1");
      expect(outcome!.usedFactIds).toContain("f2");
      expect(outcome!.injectionEfficiency).toBe(1.0);
    });

    it("observePostReplyInjection 从 ReplyPayload 数组提取文本 (过滤 reasoning/error/status)", async () => {
      const outcome = await observePostReplyInjection({
        reply: [
          { text: "Thinking about the answer", isReasoning: true },
          { text: "Alice lives in Boston area", isCompactionNotice: false },
          { text: "⚠️ Something went wrong", isError: true },
          { text: "Compacting...", isCompactionNotice: true },
        ],
        injectedFactIds: ["f1"],
        facts: MOCK_FACTS,
        sessionKey: "test-observe-array",
        turn: 1,
        now: 1000,
      });
      // 只有第 2 个 payload 是有效内容, 包含 "boston" → f1 被使用
      expect(outcome).not.toBeNull();
      expect(outcome!.usedFactIds).toEqual(["f1"]);
      expect(outcome!.injectionEfficiency).toBe(1.0);
    });

    it("observePostReplyInjection 在 injectedFactIds 为空时降级返回 null", async () => {
      const outcome = await observePostReplyInjection({
        reply: { text: "Some reply" },
        injectedFactIds: [],
        facts: MOCK_FACTS,
        sessionKey: "test-observe-empty",
        turn: 1,
        now: 1000,
      });
      expect(outcome).toBeNull();
    });

    it("observePostReplyInjection 在 reply 文本为空时降级返回 null", async () => {
      const outcome = await observePostReplyInjection({
        reply: { text: "" },
        injectedFactIds: ["f1"],
        facts: MOCK_FACTS,
        sessionKey: "test-observe-empty-reply",
        turn: 1,
        now: 1000,
      });
      expect(outcome).toBeNull();
    });

    it("observePostReplyInjection 在 reply 为 undefined 时降级返回 null", async () => {
      const outcome = await observePostReplyInjection({
        reply: undefined,
        injectedFactIds: ["f1"],
        facts: MOCK_FACTS,
        sessionKey: "test-observe-undefined",
        turn: 1,
        now: 1000,
      });
      expect(outcome).toBeNull();
    });

    it("observePostReplyInjection 在 facts 为空时降级返回 null", async () => {
      const outcome = await observePostReplyInjection({
        reply: { text: "Alice lives in Boston" },
        injectedFactIds: ["f1"],
        facts: [],
        sessionKey: "test-observe-empty-facts",
        turn: 1,
        now: 1000,
      });
      expect(outcome).toBeNull();
    });
  });

  // === 维度 8: P2 SSP Goal 演进 ===
  describe("维度 8: SSP Goal 演进 (completion / continuation / new_goal)", () => {
    it("completion: 'done with deployment' 将匹配的 goal 移到 resolvedConstraints", () => {
      const initial = createInitialSSP(
        "evo-test",
        extractIntent("Deploy the Rust service to production"),
        1000,
      );
      // 确认初始 goal 包含 deploy
      expect(initial.activeGoals.some((g) => g.toLowerCase().includes("deploy"))).toBe(true);
      expect(initial.resolvedConstraints).toEqual([]);

      // 用户说 "done with the deployment" → completion 检测
      const intent = extractIntent("Done with the deployment, it's live now");
      expect(intent.evolution).toBe("completion");

      const updated = updateSSP(initial, intent, 0, 2, "", 2000);
      // deploy goal 应被移到 resolvedConstraints
      expect(updated.activeGoals.some((g) => g.toLowerCase().includes("deploy"))).toBe(false);
      expect(updated.resolvedConstraints.some((r) => r.toLowerCase().includes("deploy"))).toBe(true);
      // version++ (activeGoals 变化)
      expect(updated.version).toBe(initial.version + 1);
    });

    it("completion: 无关键词匹配时不移动 goal", () => {
      const initial = createInitialSSP(
        "evo-test",
        extractIntent("Deploy the Rust service to production"),
        1000,
      );
      // "finished cooking dinner" 与 deploy 无关键词交集
      const intent = extractIntent("Finished cooking dinner, it was great");
      expect(intent.evolution).toBe("completion");

      const updated = updateSSP(initial, intent, 0, 2, "", 2000);
      // deploy goal 不应被移动 (关键词不匹配)
      expect(updated.activeGoals.some((g) => g.toLowerCase().includes("deploy"))).toBe(true);
      expect(updated.resolvedConstraints).toEqual([]);
      // version 不变 (activeGoals 未变化)
      expect(updated.version).toBe(initial.version);
    });

    it("continuation: 'continue with the testing' 不添加新 goal", () => {
      const initial = createInitialSSP(
        "evo-test",
        extractIntent("Deploy the Rust service to production"),
        1000,
      );
      const initialGoalCount = initial.activeGoals.length;

      const intent = extractIntent("Continue with the testing phase");
      expect(intent.evolution).toBe("continuation");

      const updated = updateSSP(initial, intent, 0, 2, "", 2000);
      // 不应添加新 goal (continuation = 细化现有 goal)
      expect(updated.activeGoals.length).toBe(initialGoalCount);
      // activeGoals 未变化 → version 不变
      expect(updated.version).toBe(initial.version);
    });

    it("continuation: 中文 '继续上面的任务' 不添加新 goal", () => {
      const initial = createInitialSSP(
        "evo-test",
        extractIntent("部署 Rust 服务到生产环境"),
        1000,
      );
      const initialGoalCount = initial.activeGoals.length;

      const intent = extractIntent("继续上面的任务");
      expect(intent.evolution).toBe("continuation");

      const updated = updateSSP(initial, intent, 0, 2, "", 2000);
      expect(updated.activeGoals.length).toBe(initialGoalCount);
      expect(updated.version).toBe(initial.version);
    });

    it("new_goal: 普通指令正常 append 新 goal (默认行为不变)", () => {
      const initial = createInitialSSP(
        "evo-test",
        extractIntent("Deploy the Rust service to production"),
        1000,
      );

      const intent = extractIntent("Set up the monitoring dashboard");
      expect(intent.evolution).toBe("new_goal");

      const updated = updateSSP(initial, intent, 0, 2, "", 2000);
      // 新 goal 被添加
      expect(updated.activeGoals.length).toBe(initial.activeGoals.length + 1);
      expect(updated.activeGoals.some((g) => g.toLowerCase().includes("monitoring"))).toBe(true);
      expect(updated.version).toBe(initial.version + 1);
    });

    it("查询性输入不触发 evolution 检测 (evolution 为 undefined)", () => {
      const intent = extractIntent("What is Alice's current role?");
      expect(intent.goals).toEqual([]);
      expect(intent.evolution).toBeUndefined();
    });

    it("完成检测后 resolvedConstraints 受 FIFO 上限约束", () => {
      // 预填 3 个 resolvedConstraints (上限)
      const initial: SessionStatePage = {
        ...createInitialSSP("evo-test", extractIntent("Deploy the service"), 1000),
        activeGoals: ["Deploy the service", "Set up monitoring", "Configure CI/CD"],
        resolvedConstraints: ["Old task 1", "Old task 2", "Old task 3"],
      };

      // 完成 "service" → "Deploy the service" 移到 resolvedConstraints, 淘汰最旧的
      const intent = extractIntent("Done with the service deployment");
      expect(intent.evolution).toBe("completion");

      const updated = updateSSP(initial, intent, 0, 2, "", 2000);
      // resolvedConstraints 上限 3, FIFO 淘汰
      expect(updated.resolvedConstraints.length).toBeLessThanOrEqual(3);
      // 最旧的 "Old task 1" 应被淘汰
      expect(updated.resolvedConstraints).not.toContain("Old task 1");
      // 新完成的 goal 应在 resolvedConstraints 中
      expect(updated.resolvedConstraints.some((r) => r.toLowerCase().includes("deploy"))).toBe(true);
    });
  });
});
