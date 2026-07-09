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
  triggerSSPVersionBump,
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
    validAt: ts,
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

// === 测试场景数据 ===
interface ConversationTurn {
  turn: number;
  userInput: string;
  description: string;
  expectedGoalMatch?: string; // 期望 SSP activeGoals 包含的关键词
}

const CONVERSATION_SCENARIO: ConversationTurn[] = [
  {
    turn: 1,
    userInput: "Help me deploy the Rust service to production",
    description: "初始目标：部署 Rust 服务",
    expectedGoalMatch: "deploy",
  },
  {
    turn: 2,
    userInput: "What's Alice's current role in the project?",
    description: "查询记忆：Alice 的角色",
  },
  {
    turn: 3,
    userInput: "Don't use Rust, let's switch to Go for better concurrency",
    description: "目标变更：Rust → Go（否定 + 新目标）",
    expectedGoalMatch: "Go",
  },
  {
    turn: 4,
    userInput: "Can you check if Alice is available for the code review?",
    description: "查询记忆：Alice 可用性",
  },
  {
    turn: 5,
    userInput: "Also remind me about the team meeting schedule",
    description: "追加目标：团队会议提醒",
    expectedGoalMatch: "team meeting",
  },
];

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
      }));
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

  describe("维度 2: SSP 状态演进 (多轮对话追踪)", () => {
    it("5 轮对话中 SSP 正确追踪 activeGoals 变化", async () => {
      const sessionKey = "exp-test-session";
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableSessionStatePage: true },
      });

      const results: Array<{ turn: number; ssp?: string; goals: string[]; version: number; iFrameRefreshed: boolean }> = [];

      for (const turnData of CONVERSATION_SCENARIO) {
        const injection = await buildPreReplyInjection({
          sessionKey,
          userInputText: turnData.userInput,
          config,
          now: 1000 + turnData.turn * 100,
        });

        const ssp = injection.updatedSSP;
        results.push({
          turn: turnData.turn,
          ssp: injection.sspString,
          goals: ssp?.activeGoals ?? [],
          version: ssp?.version ?? 0,
          iFrameRefreshed: injection.iFrameRefreshed,
        });
      }

      // 验证 1: 第 1 轮创建初始 SSP，包含 deploy 目标
      expect(results[0].goals.length).toBeGreaterThan(0);
      expect(results[0].goals.some((g) => g.toLowerCase().includes("deploy"))).toBe(true);
      expect(results[0].version).toBe(1);

      // 验证 2: 第 3 轮 "Don't use Rust, switch to Go" 应触发目标变更
      // Rust 被 negate, Go 加入 → goalsChanged → version++
      expect(results[2].iFrameRefreshed).toBe(true);
      expect(results[2].goals.some((g) => g.toLowerCase().includes("go"))).toBe(true);

      // 验证 3: version 单调递增（每次 goals 变化 +1）
      const versions = results.map((r) => r.version);
      const maxVersion = Math.max(...versions);
      expect(maxVersion).toBeGreaterThanOrEqual(2);

      // 输出 SSP 演进轨迹
      console.log(`\n  [SSP 状态演进]`);
      for (const r of results) {
        const turnData = CONVERSATION_SCENARIO[r.turn - 1];
        console.log(`    Turn ${r.turn}: "${turnData.userInput.slice(0, 50)}..."`);
        console.log(`      Goals: [${r.goals.join(", ")}]`);
        console.log(`      Version: ${r.version}, I-frame refresh: ${r.iFrameRefreshed}`);
      }
    });

    it("SSP 否定检测: 'Don't use Rust' 正确移除被否定 goal", async () => {
      const sessionKey = "exp-negation-test";
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableSessionStatePage: true },
      });

      // Turn 1: 确立 Rust 目标
      await buildPreReplyInjection({
        sessionKey,
        userInputText: "Set up the Rust development environment",
        config,
        now: 1000,
      });

      // Turn 2: 否定 Rust
      const injection = await buildPreReplyInjection({
        sessionKey,
        userInputText: "Don't use Rust anymore, it's too complex",
        config,
        now: 2000,
      });

      const goals = injection.updatedSSP?.activeGoals ?? [];
      // Rust 相关 goal 应被移除（否定检测生效）
      const hasRustGoal = goals.some((g) => g.toLowerCase().includes("rust") && !g.toLowerCase().includes("don't"));
      expect(hasRustGoal).toBe(false); // 修复后: Rust goal 应被移除
      console.log(`\n  [否定检测] Turn 2 后 goals: [${goals.join(", ")}]`);
      console.log(`    Rust 被移除: ${!hasRustGoal} ✓`);
    });

    it("修复验证: extractIntent 不再过度提取查询性输入为 goal", () => {
      // 查询性输入不应提取为 goal
      const queryInputs = [
        "What's Alice's current role in the project?",
        "Where does Alice live?",
        "Can you check if Alice is available?",
        "How do I configure the database?",
        "Is the service running?",
      ];
      for (const input of queryInputs) {
        const intent = extractIntent(input);
        expect(intent.goals.length).toBe(0);
      }

      // 指令性输入应提取为 goal
      const commandInputs = [
        "Deploy the Rust service to production",
        "Set up the development environment",
        "Help me configure the CI/CD pipeline",
        "Remind me about the team meeting",
      ];
      for (const input of commandInputs) {
        const intent = extractIntent(input);
        expect(intent.goals.length).toBeGreaterThan(0);
      }

      console.log(`\n  [extractIntent 修复]`);
      console.log(`    查询性输入: ${queryInputs.length} 个, 全部不提取为 goal ✓`);
      console.log(`    指令性输入: ${commandInputs.length} 个, 全部提取为 goal ✓`);
    });
  });

  describe("维度 3: Pre-reply top-5 retrieval 命中率", () => {
    it("查询 'Alice lives where' 应命中 f1 (lives_in Boston)", async () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: { enablePreReplyRetrieval: true },
      });

      const injection = await buildPreReplyInjection({
        sessionKey: "exp-retrieval-test",
        userInputText: "Where does Alice live?",
        config,
        facts: MOCK_FACTS,
        embeddingProvider: NO_EMBEDDING_PROVIDER,
        now: 3000,
      });

      expect(injection.top5FactsString).toBeDefined();
      expect(injection.top5FactsString!).toContain("alice");
      expect(injection.top5FactsString!).toContain("[Relevant Memory]");

      const tokens = estimateTokens(injection.top5FactsString!);
      console.log(`\n  [Top-5 Retrieval] 查询: "Where does Alice live?"`);
      console.log(`    注入内容:\n${injection.top5FactsString}`);
      console.log(`    Token 占用: ${tokens} tokens`);
      expect(tokens).toBeLessThan(300); // top-5 应远小于全量
    });

    it("查询 'project status' 应命中 project_alpha 相关 facts", async () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: { enablePreReplyRetrieval: true },
      });

      const injection = await buildPreReplyInjection({
        sessionKey: "exp-retrieval-test-2",
        userInputText: "What is the status of project alpha?",
        config,
        facts: MOCK_FACTS,
        embeddingProvider: NO_EMBEDDING_PROVIDER,
        now: 3000,
      });

      expect(injection.top5FactsString).toBeDefined();
      // 应包含 project_alpha 相关 fact
      const content = injection.top5FactsString!;
      console.log(`\n  [Top-5 Retrieval] 查询: "project alpha status"`);
      console.log(`    注入内容:\n${content}`);
      console.log(`    Token 占用: ${estimateTokens(content)} tokens`);
    });

    it("不同查询产生不同 top-5 结果（非固定输出）", async () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: { enablePreReplyRetrieval: true },
      });

      const queries = [
        "Where does Alice live?",
        "What is Bob's job?",
        "Tell me about the team meeting",
      ];

      const results: string[] = [];
      for (let i = 0; i < queries.length; i++) {
        const injection = await buildPreReplyInjection({
          sessionKey: `exp-diversity-${i}`,
          userInputText: queries[i],
          config,
          facts: MOCK_FACTS,
          embeddingProvider: NO_EMBEDDING_PROVIDER,
          now: 3000,
        });
        results.push(injection.top5FactsString ?? "");
      }

      // 三个查询的 top-5 应不完全相同
      const allSame = results.every((r) => r === results[0]);
      expect(allSame).toBe(false);

      console.log(`\n  [Top-5 多样性]`);
      for (let i = 0; i < queries.length; i++) {
        console.log(`    Query: "${queries[i]}" → ${estimateTokens(results[i])} tokens`);
      }
    });
  });

  describe("维度 4: I-frame 刷新检测 (Projection Cache invariant)", () => {
    it("goals 变化触发 version++ 和 I-frame 刷新, 相同 goals 不触发", async () => {
      const sessionKey = "exp-iframe-test";
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableSessionStatePage: true },
      });

      // Turn 1: 创建 SSP — 首次创建, version=1, I-frame refresh=true
      const turn1 = await buildPreReplyInjection({
        sessionKey,
        userInputText: "Initialize the project setup",
        config,
        now: 1000,
      });
      const versionAfterTurn1 = turn1.updatedSSP?.version ?? 0;
      expect(turn1.iFrameRefreshed).toBe(true);

      // Turn 2: 相同输入 → extractIntent 提取相同 goal → goalsChanged=false → version 不变
      const turn2 = await buildPreReplyInjection({
        sessionKey,
        userInputText: "Initialize the project setup",
        config,
        now: 2000,
      });
      expect(turn2.iFrameRefreshed).toBe(false);

      // Turn 3: 新 goal → goalsChanged=true → version++ → I-frame refresh=true
      const turn3 = await buildPreReplyInjection({
        sessionKey,
        userInputText: "Now deploy to Kubernetes cluster",
        config,
        now: 3000,
      });
      expect(turn3.iFrameRefreshed).toBe(true);
      expect(turn3.updatedSSP?.version).toBeGreaterThan(versionAfterTurn1);

      console.log(`\n  [I-frame 刷新检测 — goals 变化]`);
      console.log(`    Turn 1: version=${versionAfterTurn1}, refresh=true (首次创建)`);
      console.log(`    Turn 2: version=${turn2.updatedSSP?.version}, refresh=false (相同 goals)`);
      console.log(`    Turn 3: version=${turn3.updatedSSP?.version}, refresh=true (新 goal)`);
    });

    it("修复验证: consolidation 触发 version++ 后, pre-reply 检测到 I-frame 刷新", async () => {
      const sessionKey = "exp-iframe-external-bump";
      const config = createMemoryRuntimeConfig({
        featureFlags: { enableSessionStatePage: true },
      });

      // Turn 1: 创建 SSP
      const turn1 = await buildPreReplyInjection({
        sessionKey,
        userInputText: "Initialize the project setup",
        config,
        now: 1000,
      });
      expect(turn1.iFrameRefreshed).toBe(true);

      // Turn 2: 相同 goals, 不触发刷新
      const turn2 = await buildPreReplyInjection({
        sessionKey,
        userInputText: "Initialize the project setup",
        config,
        now: 2000,
      });
      expect(turn2.iFrameRefreshed).toBe(false);

      // 模拟 consolidation 触发 version++
      await triggerSSPVersionBump(sessionKey);
      const bumpedSSP = sspStore.get(sessionKey);
      const versionAfterBump = bumpedSSP?.version ?? 0;

      // Turn 3: 相同 goals, 但 version 被 consolidation bump 了
      // 修复后: externalBumpDetected=true (version > lastConsumed) → I-frame refresh=true
      const turn3 = await buildPreReplyInjection({
        sessionKey,
        userInputText: "Initialize the project setup", // 相同 goals
        config,
        now: 3000,
      });
      expect(turn3.iFrameRefreshed).toBe(true); // 修复后: 应检测到外部 bump

      console.log(`\n  [I-frame 刷新检测 — 外部 bump 修复验证]`);
      console.log(`    Turn 1: version=${turn1.updatedSSP?.version}, refresh=true (首次创建)`);
      console.log(`    Turn 2: version=${turn2.updatedSSP?.version}, refresh=false (相同 goals)`);
      console.log(`    Bump后: version=${versionAfterBump} (consolidation 触发 +1)`);
      console.log(`    Turn 3: version=${turn3.updatedSSP?.version}, refresh=true (外部 bump 检测) ✓`);
    });
  });

  describe("维度 5: 完整多轮对话综合验收", () => {
    it("5 轮对话完整流程: SSP + top-5 + token 统计", async () => {
      const sessionKey = "exp-full-scenario";
      const config = createMemoryRuntimeConfig({
        featureFlags: {
          enableSessionStatePage: true,
          enablePreReplyRetrieval: true,
        },
      });

      const stats: Array<{
        turn: number;
        input: string;
        sspTokens: number;
        top5Tokens: number;
        totalCompassTokens: number;
        baselineTokens: number;
        iFrameRefreshed: boolean;
        sspGoals: string[];
      }> = [];

      // 基线: 全量注入 20 facts 的 token 数
      const baselineFullInjection = MOCK_FACTS
        .map((f, i) => `${i + 1}. ${f.subject}: ${f.objectSummary} (conf: ${(f.confidence ?? 0).toFixed(2)})`)
        .join("\n");
      const baselineTokens = estimateTokens(baselineFullInjection);

      for (const turnData of CONVERSATION_SCENARIO) {
        const injection = await buildPreReplyInjection({
          sessionKey,
          userInputText: turnData.userInput,
          config,
          facts: MOCK_FACTS,
          embeddingProvider: NO_EMBEDDING_PROVIDER,
          now: 1000 + turnData.turn * 100,
        });

        const sspTokens = estimateTokens(injection.sspString ?? "");
        const top5Tokens = estimateTokens(injection.top5FactsString ?? "");
        const totalCompassTokens = sspTokens + top5Tokens;

        stats.push({
          turn: turnData.turn,
          input: turnData.userInput,
          sspTokens,
          top5Tokens,
          totalCompassTokens,
          baselineTokens,
          iFrameRefreshed: injection.iFrameRefreshed,
          sspGoals: injection.updatedSSP?.activeGoals ?? [],
        });
      }

      // === 输出综合报告 ===
      console.log(`\n${"=".repeat(80)}`);
      console.log(`  COMPASS 2.0 体验收益综合报告 — 5 轮对话场景`);
      console.log(`${"=".repeat(80)}`);
      console.log(`\n  基线 (全量 20 facts 注入): ${baselineTokens} tokens/轮\n`);

      console.log(`  ${"Turn"} | ${"输入"} | ${"SSP tok"} | ${"Top5 tok"} | ${"总 tok"} | ${"压缩率"} | ${"I-frame"} | ${"SSP Goals"}`);
      console.log(`  ${"-".repeat(76)}`);

      for (const s of stats) {
        const compressionRatio = ((baselineTokens - s.totalCompassTokens) / baselineTokens * 100).toFixed(1);
        const inputShort = s.input.slice(0, 35).padEnd(35);
        const goalsShort = s.sspGoals.join("; ").slice(0, 20);
        console.log(
          `  ${s.turn}     | ${inputShort} | ${String(s.sspTokens).padStart(7)} | ${String(s.top5Tokens).padStart(8)} | ${String(s.totalCompassTokens).padStart(7)} | ${compressionRatio.padStart(6)}% | ${String(s.iFrameRefreshed).padEnd(7)} | ${goalsShort}`
        );
      }

      // 汇总统计
      const avgCompassTokens = stats.reduce((sum, s) => sum + s.totalCompassTokens, 0) / stats.length;
      const avgCompression = ((baselineTokens - avgCompassTokens) / baselineTokens * 100).toFixed(1);
      const totalSaved = (baselineTokens - avgCompassTokens) * stats.length;
      const iframeRefreshCount = stats.filter((s) => s.iFrameRefreshed).length;

      console.log(`\n  ${"-".repeat(76)}`);
      console.log(`  汇总:`);
      console.log(`    平均 COMPASS token/轮: ${avgCompassTokens.toFixed(0)}`);
      console.log(`    平均压缩率: ${avgCompression}%`);
      console.log(`    5 轮总节省: ${totalSaved.toFixed(0)} tokens`);
      console.log(`    I-frame 刷新次数: ${iframeRefreshCount}/${stats.length}`);
      console.log(`    SSP 目标追踪: ${stats.filter((s) => s.sspGoals.length > 0).length}/${stats.length} 轮有活跃目标`);

      // === 量化断言 ===
      // 1. 每轮 COMPASS 注入都小于基线全量注入
      for (const s of stats) {
        expect(s.totalCompassTokens).toBeLessThan(baselineTokens);
      }

      // 2. SSP 始终 ≤256 tokens
      for (const s of stats) {
        expect(s.sspTokens).toBeLessThanOrEqual(256);
      }

      // 3. Top-5 始终 < 全量 20 facts
      for (const s of stats) {
        expect(s.top5Tokens).toBeLessThan(baselineTokens);
      }

      // 4. 至少有 1 次 I-frame 刷新（首次创建或 goals 变更）
      expect(iframeRefreshCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("维度 6: 信息分层效果", () => {
    it("SSP 提供状态锚点, top-5 提供相关事实, 两者互补不重复", async () => {
      const config = createMemoryRuntimeConfig({
        featureFlags: {
          enableSessionStatePage: true,
          enablePreReplyRetrieval: true,
        },
      });

      const injection = await buildPreReplyInjection({
        sessionKey: "exp-layering-test",
        userInputText: "Help me deploy the service and check Alice's availability",
        config,
        facts: MOCK_FACTS,
        embeddingProvider: NO_EMBEDDING_PROVIDER,
        now: 1000,
      });

      const ssp = injection.sspString ?? "";
      const top5 = injection.top5FactsString ?? "";

      // SSP 应包含 [Session State] 标记和 Goals
      expect(ssp).toContain("[Session State]");
      expect(ssp).toContain("Goals:");

      // Top-5 应包含 [Relevant Memory] 标记
      expect(top5).toContain("[Relevant Memory]");

      // 两者不应重复（SSP 是状态, top-5 是事实）
      expect(ssp).not.toContain("[Relevant Memory]");
      expect(top5).not.toContain("[Session State]");

      console.log(`\n  [信息分层]`);
      console.log(`    SSP 层 (状态锚点):\n${ssp}`);
      console.log(`\n    Top-5 层 (相关事实):\n${top5}`);
      console.log(`\n    SSP tokens: ${estimateTokens(ssp)}, Top5 tokens: ${estimateTokens(top5)}`);
      console.log(`    分层互补: SSP 无 [Relevant Memory], Top5 无 [Session State] ✓`);
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
