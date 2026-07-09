// COMPASS 2.0 L-1 SSP (Session State Page) — 256 tokens 有界内部状态.
//
// 设计目标 (COMPASS 2.0 × ClawX 融合):
//   - 256 tokens 硬上限, O(1) 每轮更新
//   - 跨轮持久化 (extraSystemPromptParts 是 per-run 重建, SSP 必须落盘)
//   - 确定性文本生成 (非 LLM)
//   - Projection Cache invariant: consolidation 后 version++, pre-reply 检测变化强制 I-frame 刷新
//
// 落盘路径: ~/.openclaw/memory/memory-session-state.json
// 模式参考: commitments/store.ts (privateFileStore + resolveStateDir)

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { privateFileStore } from "../infra/private-file-store.js";

// === Schema ===

const SSP_SCHEMA_VERSION = 1 as const;
const SSP_MAX_TOKENS = 256;
const SSP_TOKEN_CHARS_RATIO = 4; // 1 token ≈ 4 chars 近似
const SSP_MAX_CHARS = SSP_MAX_TOKENS * SSP_TOKEN_CHARS_RATIO;

const SSP_MAX_ACTIVE_GOALS = 4;
const SSP_MAX_RESOLVED_CONSTRAINTS = 3;
const SSP_MAX_OPEN_QUESTIONS = 2;
const SSP_MAX_DECISION_HISTORY = 4;
const SSP_MAX_GOAL_LENGTH_CHARS = 80; // ~20 tokens

/**
 * SSP sessions 存储上限. 超出时按 updatedAt 淘汰最旧的 sessions.
 * 防止 memory-session-state.json 无界增长.
 *
 * 128 的选择依据:
 *   - 每个 SSP ≤ 256 tokens ≈ 1024 chars ≈ 1KB
 *   - 128 sessions × 1KB = 128KB, 在可接受范围内
 *   - 超过 128 个并发活跃 session 的场景需要重新评估此值
 */
const MAX_SSP_SESSIONS = 128;

/**
 * Session 非活跃 TTL (毫秒). 超过此时间未更新的 session 在下次写入时被淘汰.
 * 默认 30 天.
 */
const SSP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Session State Page — COMPASS 2.0 L-1 有界内部状态.
 *
 * 256 tokens 硬上限, 每轮 O(1) 更新. 落盘到 memory-session-state.json.
 */
export interface SessionStatePage {
  schemaVersion: typeof SSP_SCHEMA_VERSION;
  sessionId: string;
  /** Projection Cache invariant: consolidation 后 ++, pre-reply 检测变化强制 I-frame 刷新 */
  version: number;
  /** ≤4 项, 每项 ≤20 tokens */
  activeGoals: string[];
  /** ≤3 项 */
  resolvedConstraints: string[];
  /** ≤2 项 */
  openQuestions: string[];
  /** ≤4 项, 记录最近决策 */
  decisionHistory: Array<{ turn: number; decision: string; at: number }>;
  /** 0-1, 来自 governance.driftScore */
  driftSignal: number;
  updatedAt: number;
}

/**
 * 当前 SSP schema 版本号.
 * 修改 SessionStatePage 结构时必须递增此值, 并在 SSP_MIGRATIONS 中注册对应 migration.
 */
export const CURRENT_SSP_SCHEMA_VERSION = SSP_SCHEMA_VERSION;

/**
 * Intent 提取结果 (轻量正则, 非 LLM).
 */
export interface SessionIntent {
  goals: string[];
  negations: string[];
  /**
   * Goal 演进分类 (P2): 判断本轮输入是延续现有 goal、完成 goal、还是新目标.
   * - "new_goal" (默认): append 新 goal (当前行为)
   * - "continuation": 细化现有 goal, 不添加新 goal
   * - "completion": 完成 goal, 将匹配的 existingGoal 移到 resolvedConstraints
   */
  evolution?: GoalEvolution;
}

export type GoalEvolution = "new_goal" | "continuation" | "completion";

// 完成/延续模式 (中英双语, P2 goal 演进检测)
const COMPLETION_PATTERNS = [
  /\b(done|finished|completed|accomplished|wrapped up|done with)\b/i,
  /完成了/, /搞定了/, /做完了/, /完毕/, /结束了/,
];

const CONTINUATION_PATTERNS = [
  /\b(continue|keep going|move on|proceed|next step)\b/i,
  /\bafter that\b/i, /\bfrom where we left off\b/i,
  /\bthen (let|let's|we|I)\b/i,
  /继续/, /接下来/, /然后/, /下一步/, /接着/, /继续上面/,
];

function detectGoalEvolution(userInput: string): GoalEvolution {
  if (COMPLETION_PATTERNS.some((p) => p.test(userInput))) return "completion";
  if (CONTINUATION_PATTERNS.some((p) => p.test(userInput))) return "continuation";
  return "new_goal";
}

// === Intent 提取 ===

/**
 * 否定检测模式 (13 个中英双语).
 *
 * ── 已知漏网场景 (不修复, 文档化) ────────────────────────────────────────
 *
 * 1. 反问句误判:
 *    "难道不应该部署吗?" → 匹配「不」→ 误判为否定「应该部署吗」
 *    根因: 正则无法区分否定陈述与否定反问.
 *    影响: 低频, 反问句通常不含明确 goal, 误提取的否定内容也不会匹配到有效 goal.
 *
 * 2. 条件否定漏检:
 *    "如果不是这个问题的话就继续" → 「不是」被检测为否定
 *    根因: 条件从句中的否定不表达用户意图变更.
 *    影响: 低频, 「不是」通常不会有前缀匹配的 existingGoal.
 *
 * 3. 嵌套否定漏检:
 *    "我不是不想做, 而是..." → 双重否定, 语义为肯定
 *    根因: 正则单次扫描, 无法处理双重否定.
 *    影响: 极低频, 双重否定在中文任务指令中罕见.
 *
 * 4. 中文分词边界:
 *    "别具一格" → 匹配「别」→ 误判为否定「具一格」
 *    缓解: `keywordsOverlapByPrefix` 的最小 4 chars 要求会过滤掉「具一格」.
 *
 * 迁移路径: 如果误判率在生产中超过 5%, 升级为基于分词的否定检测 (jieba/nodejieba).
 */
const NEGATION_PATTERNS = [
  /\bdon't\b/i,
  /\bdo not\b/i,
  /\bnot\b/i,
  /\bno longer\b/i,
  /\bstop\b/i,
  /\bnever\b/i,
  /不要/,
  /别/,
  /不再/,
  /停止/,
  /无需/,
  /不用/,
];

/**
 * 查询性输入过滤前缀 (14 个中英双语).
 * 匹配这些前缀的输入不提取为 goal, 因为查询是信息请求而非意图表达.
 *
 * ── 已知漏网场景 (不修复, 文档化) ────────────────────────────────────────
 *
 * 1. 隐式查询漏过滤:
 *    "给我看看现在的配置" → 不匹配任何前缀 → 被提取为 goal「给我看看现在的配置」
 *    根因: 祈使句形式的查询 (「给我看看」「告诉我」) 未列入过滤前缀.
 *    缓解建议: 追加「给我」「告诉我」「帮我查」「show me」「tell me」到过滤列表.
 *
 * 2. 查询+指令混合:
 *    "查一下然后帮我修复" → 前半段匹配「查」过滤, 但「帮我修复」被忽略
 *    根因: 当前实现是整句过滤, 不处理句内的查询+指令混合结构.
 *    影响: 低频, 通常多句指令会在下一轮补充提取.
 *
 * 迁移路径: 对祈使句形式的查询进行语义分类 (需要轻量分类模型或规则扩展).
 */
const QUERY_PREFIX_PATTERNS = [
  /^(what|where|when|who|how|why|is|are|can|could|would|do|does|did|has|have|will|shall|may|might|should)\b/i,
  /^(哪个|哪里|什么|怎么|为什么|是否|可以|谁|何时|多少|能不能|是不是|有没有|为啥|如何)/,
  /^(tell me about|check if|show me|what's|whats)\b/i,
];

// 停用词 (匹配否定时过滤掉这些常见词, 避免误匹配)
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "are",
  "was", "were", "been", "being", "will", "would", "could", "should", "may",
  "might", "must", "shall", "can", "need", "any", "all", "some", "now",
  "use", "using", "used", "get", "got", "put", "set", "try", "let",
  "的", "了", "是", "在", "和", "与", "及", "或", "用", "把", "让", "使",
  "too", "very", "just", "also", "only", "more", "much", "many", "any",
  "it", "its", "they", "them", "their", "we", "you", "your", "our",
  "anymore", "anymore", "really", "actually", "basically", "simply",
]);

// 技术名词词典 (goal 冲突检测)
const TECH_TERM_DICTIONARY = [
  "rust",
  "go",
  "python",
  "typescript",
  "javascript",
  "java",
  "c++",
  "c#",
  "react",
  "vue",
  "angular",
  "svelte",
  "node",
  "deno",
  "bun",
  "sqlite",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "docker",
  "kubernetes",
  "k8s",
];

const TECH_TERM_PATTERN = new RegExp(
  `\\b(${TECH_TERM_DICTIONARY.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);

/**
 * 从用户输入提取 intent (轻量正则, 非 LLM).
 * - 检测否定模式 (don't/不要/别/...), 提取否定词后的关键词
 * - 提取 goal (仅指令性输入, 查询性输入不提取)
 */
export function extractIntent(userInput: string): SessionIntent {
  const trimmed = userInput.trim();
  if (!trimmed) {
    return { goals: [], negations: [] };
  }

  // 否定检测: 提取否定词之后的内容 (不含否定词本身)
  const negations: string[] = [];
  for (const pattern of NEGATION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // 取否定词之后的内容, 而非从否定词开始
      const afterNegation = trimmed.slice((match.index ?? 0) + match[0].length).trim();
      if (afterNegation) {
        negations.push(afterNegation.slice(0, SSP_MAX_GOAL_LENGTH_CHARS));
      }
    }
  }

  // Goal 提取: 查询性输入不提取为 goal (避免 "What is Alice's role?" 被误认为目标)
  const isQuery = QUERY_PREFIX_PATTERNS.some((p) => p.test(trimmed));
  let goals: string[] = [];
  let evolution: GoalEvolution | undefined;
  if (!isQuery) {
    const firstSentence = trimmed.split(/[.。!！?？\n]/)[0]?.trim() ?? trimmed;
    const goal = firstSentence.slice(0, SSP_MAX_GOAL_LENGTH_CHARS);
    if (goal) goals = [goal];
    // P2: goal 演进分类 (仅在非查询性输入时检测)
    evolution = detectGoalEvolution(trimmed);
  }

  return { goals, negations, evolution };
}

/**
 * 检测 goal 冲突 (固定技术名词词典).
 * 同名词典冲突 (如 "用 Rust" vs "用 Go") 返回 true.
 */
export function detectGoalConflict(newGoals: string[], existingGoals: string[]): boolean {
  if (newGoals.length === 0 || existingGoals.length === 0) return false;

  const extractTechTerms = (text: string): Set<string> => {
    const terms = new Set<string>();
    const pattern = new RegExp(TECH_TERM_PATTERN.source, "gi");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      terms.add(match[1].toLowerCase());
    }
    return terms;
  };

  const existingTerms = new Set<string>();
  for (const g of existingGoals) {
    for (const t of extractTechTerms(g)) existingTerms.add(t);
  }
  if (existingTerms.size === 0) return false;

  for (const g of newGoals) {
    const newTerms = extractTechTerms(g);
    for (const t of newTerms) {
      if (existingTerms.has(t)) {
        // 同名术语, 检查是否为否定 (避免 "用 Rust" vs "不用 Rust" 误判)
        const hasNegation = NEGATION_PATTERNS.some((p) => p.test(g));
        if (!hasNegation) return true;
      }
    }
  }
  return false;
}

// === SSP 更新 ===

/**
 * 判断 goal 是否被 negation 否定 (基于关键词交集).
 *
 * 提取 goal 和 negation 中的关键词 (长度 ≥3, 过滤停用词),
 * 若存在交集则认为 goal 被否定.
 *
 * 示例:
 *   goal="Set up the Rust development environment"
 *   negation="use Rust anymore, it's too complex"
 *   → goalWords={rust, development, environment}, negWords={rust, complex}
 *   → 交集 {rust} → true (被否定)
 */
function isGoalNegatedBy(goal: string, negation: string): boolean {
  const goalWords = extractKeywordsForMatching(goal);
  const negWords = extractKeywordsForMatching(negation);
  if (goalWords.size === 0 || negWords.size === 0) return false;

  for (const word of negWords) {
    if (goalWords.has(word)) return true;
  }
  return false;
}

/**
 * 提取文本关键词用于 goal 匹配 (≥3 chars, 过滤停用词).
 * 用于否定检测 (isGoalNegatedBy) 和完成检测 (P2 goal 演进).
 */
function extractKeywordsForMatching(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * 检查两组关键词是否有前缀重叠 (用于 completion 检测).
 * 前缀匹配处理词形变体: deploy/deployment, test/testing 等.
 * 要求较短的关键词 ≥4 chars 以避免误匹配 (如 "pro"/"production").
 */
function keywordsOverlapByPrefix(a: Set<string>, b: Set<string>): boolean {
  for (const wa of a) {
    for (const wb of b) {
      const shorter = wa.length <= wb.length ? wa : wb;
      const longer = wa.length <= wb.length ? wb : wa;
      if (shorter.length >= 4 && longer.startsWith(shorter)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 创建初始 SSP.
 */
export function createInitialSSP(
  sessionId: string,
  intent: SessionIntent,
  now: number = Date.now(),
): SessionStatePage {
  return {
    schemaVersion: SSP_SCHEMA_VERSION,
    sessionId,
    version: 1,
    activeGoals: intent.goals.slice(0, SSP_MAX_ACTIVE_GOALS),
    resolvedConstraints: [],
    openQuestions: [],
    decisionHistory: [],
    driftSignal: 0,
    updatedAt: now,
  };
}

/**
 * 更新 SSP (O(1) 每轮更新).
 * - 移除被否定 goals
 * - P2 goal 演进: completion (移到 resolvedConstraints) / continuation (不添加) / new_goal (append)
 * - 更新 decisionHistory
 * - 触发 version++ 当 activeGoals 集合变化
 */
export function updateSSP(
  current: SessionStatePage,
  intent: SessionIntent,
  driftScore: number,
  turn: number = current.decisionHistory.length + 1,
  decision: string = "",
  now: number = Date.now(),
): SessionStatePage {
  // 1. 移除被否定 goals (基于关键词交集匹配, 而非子串包含)
  let activeGoals = current.activeGoals.filter((g) => {
    return !intent.negations.some((n) => isGoalNegatedBy(g, n));
  });

  // 2. P2 goal 演进分类
  const evolution = intent.evolution ?? "new_goal";
  let resolvedConstraints = current.resolvedConstraints.slice();

  if (evolution === "completion" && intent.goals.length > 0) {
    // 完成检测: intent.goals 关键词与 existingGoals 匹配 → 移到 resolvedConstraints
    // 使用前缀匹配 (deploy/deployment, test/testing 等词形变体)
    const completionKeywords = extractKeywordsForMatching(intent.goals.join(" "));
    if (completionKeywords.size > 0) {
      const resolved: string[] = [];
      activeGoals = activeGoals.filter((g) => {
        const gKeywords = extractKeywordsForMatching(g);
        const matched = keywordsOverlapByPrefix(gKeywords, completionKeywords);
        if (matched) {
          resolved.push(g);
          return false;
        }
        return true;
      });
      for (const r of resolved) {
        if (!resolvedConstraints.includes(r)) {
          resolvedConstraints.push(r);
        }
      }
    }
    // completion: 不添加 intent.goals 为新 goal
  } else if (evolution === "continuation") {
    // 延续: 不添加新 goal (是对现有 goal 的细化, activeGoals 保持不变)
  } else {
    // new_goal: append + FIFO 淘汰 (默认行为)
    for (const newGoal of intent.goals) {
      if (!activeGoals.includes(newGoal)) {
        activeGoals.push(newGoal);
      }
    }
  }

  // 截断到上限
  if (activeGoals.length > SSP_MAX_ACTIVE_GOALS) {
    activeGoals = activeGoals.slice(activeGoals.length - SSP_MAX_ACTIVE_GOALS);
  }
  if (resolvedConstraints.length > SSP_MAX_RESOLVED_CONSTRAINTS) {
    resolvedConstraints = resolvedConstraints.slice(
      resolvedConstraints.length - SSP_MAX_RESOLVED_CONSTRAINTS,
    );
  }

  // 3. 检测 activeGoals 集合变化 → version++
  const goalsChanged =
    activeGoals.length !== current.activeGoals.length ||
    activeGoals.some((g, i) => g !== current.activeGoals[i]);

  // 4. 更新 decisionHistory (FIFO)
  const newDecisionEntry = turn > 0 && decision ? { turn, decision, at: now } : null;
  let decisionHistory = current.decisionHistory;
  if (newDecisionEntry) {
    decisionHistory = [...current.decisionHistory, newDecisionEntry];
    if (decisionHistory.length > SSP_MAX_DECISION_HISTORY) {
      decisionHistory = decisionHistory.slice(decisionHistory.length - SSP_MAX_DECISION_HISTORY);
    }
  }

  return {
    schemaVersion: SSP_SCHEMA_VERSION,
    sessionId: current.sessionId,
    version: goalsChanged ? current.version + 1 : current.version,
    activeGoals,
    resolvedConstraints,
    openQuestions: current.openQuestions.slice(0, SSP_MAX_OPEN_QUESTIONS),
    decisionHistory,
    driftSignal: Math.max(0, Math.min(1, driftScore)),
    updatedAt: now,
  };
}

/**
 * Bump SSP version (Projection Cache invariant: consolidation 后触发).
 * 用于强制 pre-reply 检测变化时 I-frame 刷新.
 */
export function bumpSSPVersion(
  current: SessionStatePage,
  now: number = Date.now(),
): SessionStatePage {
  return {
    ...current,
    version: current.version + 1,
    updatedAt: now,
  };
}

// === 序列化 (确定性, 256 tokens 硬上限) ===

const NATURAL_BREAK_CHARS = new Set([" ", ",", ";", "，", "；", "、", "和", "与", "及", "\t"]);

/**
 * 在自然断点处截断文本.
 * 从末尾向前找自然断点 (介词/连词/逗号), 找不到则硬截断.
 */
function truncateAtNaturalBreak(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  // 从末尾向前找自然断点 (保留 70% 长度)
  const minKeep = Math.floor(maxChars * 0.7);
  for (let i = slice.length - 1; i >= minKeep; i--) {
    if (NATURAL_BREAK_CHARS.has(slice[i])) {
      return slice.slice(0, i).trimEnd();
    }
  }
  return slice.trimEnd();
}

/**
 * 序列化 SSP 为 prompt 文本 (确定性, 非 LLM).
 *
 * 硬上限 256 tokens (~1024 chars). 超限时按 activeGoals→resolvedConstraints→openQuestions 优先级截断.
 * 截断点选自然断点 (介词/连词/逗号).
 */
export function serializeSSPForPrompt(ssp: SessionStatePage): string {
  const header = "[Session State]";
  const parts: string[] = [header];

  if (ssp.activeGoals.length > 0) {
    parts.push(`Goals: ${ssp.activeGoals.join("; ")}`);
  }
  if (ssp.resolvedConstraints.length > 0) {
    parts.push(`Resolved: ${ssp.resolvedConstraints.join("; ")}`);
  }
  if (ssp.openQuestions.length > 0) {
    parts.push(`Open: ${ssp.openQuestions.join("; ")}`);
  }
  parts.push(`Drift: ${ssp.driftSignal.toFixed(2)}`);

  let result = parts.join("\n");

  // 硬上限截断
  if (result.length > SSP_MAX_CHARS) {
    result = truncateAtNaturalBreak(result, SSP_MAX_CHARS);
  }

  return result;
}

// === 落盘 (参考 commitments/store.ts 模式) ===

const SSP_STORE_FILE = "memory-session-state.json";

function resolveSSPStorePath(): string {
  return path.join(resolveStateDir(), "memory", SSP_STORE_FILE);
}

interface SSPStoreFile {
  version: typeof SSP_SCHEMA_VERSION;
  sessions: Record<string, SessionStatePage>;
}

function emptySSPStore(): SSPStoreFile {
  return { version: SSP_SCHEMA_VERSION, sessions: {} };
}

// 写入串行化: 防并发写冲突 (参考 runExclusiveCommitmentsStoreWrite)
const writeLocks = new Map<string, Promise<void>>();

async function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  let releaseLock: () => void;
  const next = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  writeLocks.set(key, prev.then(() => next));
  try {
    return await fn();
  } finally {
    releaseLock!();
    if (writeLocks.get(key) === next) {
      writeLocks.delete(key);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// === SSP Schema Migration ===

/**
 * 单条 schema migration 描述符.
 * 深度设计阶段修改 SessionStatePage 结构时, 在 SSP_MIGRATIONS 数组中追加
 * 对应的 migration, 而不是修改 coerceSSP 的防御性解析逻辑.
 *
 * 执行顺序: SSP_MIGRATIONS 按 from 版本号升序排列, runSSPMigrations 逐步执行.
 */
export interface SSPMigration {
  /** 源 schema 版本号 */
  from: number;
  /** 目标 schema 版本号 */
  to: number;
  /**
   * 迁移函数. 接受旧格式的原始 JSON 对象, 返回新格式对象.
   * 不应抛出异常; 如果无法迁移, 返回 null (调用方降级为空 SSP).
   */
  migrate: (old: Record<string, unknown>) => Record<string, unknown> | null;
}

/**
 * 已注册的 SSP migrations.
 * 当前为空 (schemaVersion=1 是初始版本, 无需迁移).
 * 未来修改 SessionStatePage 时, 在此追加 migration 而非修改 coerceSSP.
 */
export const SSP_MIGRATIONS: SSPMigration[] = [];

/**
 * 对原始 JSON 对象执行所有适用的 migrations, 使其达到最新 schema 版本.
 * 如果任何一步 migration 返回 null, 整体返回 null (调用方降级为空 SSP).
 */
export function runSSPMigrations(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const rawVersion =
    typeof raw["schemaVersion"] === "number" ? raw["schemaVersion"] : 1;

  let current: Record<string, unknown> = raw;

  // 按升序执行所有适用的 migrations
  const applicable = SSP_MIGRATIONS.filter((m) => m.from >= rawVersion).sort(
    (a, b) => a.from - b.from,
  );

  for (const migration of applicable) {
    const result = migration.migrate(current);
    if (result === null) return null;
    current = result;
  }

  return current;
}

function coerceSSP(sessionId: string, raw: unknown): SessionStatePage | undefined {
  if (!isRecord(raw)) return undefined;

  // 执行 schema migrations (当前为空操作, 为未来版本升级预留)
  const migrated = runSSPMigrations(raw);
  if (migrated === null) return undefined;
  const data = migrated;

  if (data["schemaVersion"] !== SSP_SCHEMA_VERSION) return undefined;
  const activeGoals = Array.isArray(data["activeGoals"])
    ? data["activeGoals"].filter((g): g is string => typeof g === "string")
    : [];
  const resolvedConstraints = Array.isArray(data["resolvedConstraints"])
    ? data["resolvedConstraints"].filter((g): g is string => typeof g === "string")
    : [];
  const openQuestions = Array.isArray(data["openQuestions"])
    ? data["openQuestions"].filter((g): g is string => typeof g === "string")
    : [];
  const decisionHistory = Array.isArray(data["decisionHistory"])
    ? data["decisionHistory"]
        .filter(isRecord)
        .map((d) => ({
          turn: typeof d["turn"] === "number" ? d["turn"] : 0,
          decision: typeof d["decision"] === "string" ? d["decision"] : "",
          at: typeof d["at"] === "number" ? d["at"] : 0,
        }))
    : [];
  const version = typeof data["version"] === "number" ? data["version"] : 1;
  const driftSignal =
    typeof data["driftSignal"] === "number"
      ? Math.max(0, Math.min(1, data["driftSignal"]))
      : 0;
  const updatedAt = typeof data["updatedAt"] === "number" ? data["updatedAt"] : Date.now();
  return {
    schemaVersion: SSP_SCHEMA_VERSION,
    sessionId,
    version,
    activeGoals,
    resolvedConstraints,
    openQuestions,
    decisionHistory,
    driftSignal,
    updatedAt,
  };
}

async function loadSSPStore(): Promise<SSPStoreFile> {
  const resolved = resolveSSPStorePath();
  try {
    const parsed = await privateFileStore(path.dirname(resolved)).readJsonIfExists(
      path.basename(resolved),
    );
    if (!isRecord(parsed) || parsed.version !== SSP_SCHEMA_VERSION || !isRecord(parsed.sessions)) {
      return emptySSPStore();
    }
    const sessions: Record<string, SessionStatePage> = {};
    for (const [sid, raw] of Object.entries(parsed.sessions)) {
      const coerced = coerceSSP(sid, raw);
      if (coerced) sessions[sid] = coerced;
    }
    return { version: SSP_SCHEMA_VERSION, sessions };
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return emptySSPStore();
    }
    throw err;
  }
}

async function saveSSPStore(store: SSPStoreFile): Promise<void> {
  const resolved = resolveSSPStorePath();
  await privateFileStore(path.dirname(resolved)).writeJson(path.basename(resolved), store);
}

/**
 * 加载指定 session 的 SSP.
 * 不存在时返回 null (ENOENT 降级).
 */
export async function loadSessionState(sessionId: string): Promise<SessionStatePage | null> {
  const store = await loadSSPStore();
  return store.sessions[sessionId] ?? null;
}

/**
 * 对 sessions store 执行 LRU + TTL eviction.
 * 调用时机: 每次 saveSessionState 写入前.
 *
 * 淘汰策略 (按优先级):
 *   1. TTL 过期: updatedAt < now - SSP_SESSION_TTL_MS
 *   2. LRU 超容: 按 updatedAt 升序排列, 淘汰最旧的直到 count ≤ MAX_SSP_SESSIONS
 *
 * 注意: 当前写入的 session 不参与淘汰 (先淘汰再写入).
 */
function evictStaleSessions(
  sessions: Record<string, SessionStatePage>,
  currentSessionId: string,
  now: number,
): Record<string, SessionStatePage> {
  // Step 1: 移除 TTL 过期的 sessions (当前 session 豁免)
  const afterTTL = Object.fromEntries(
    Object.entries(sessions).filter(
      ([id, ssp]) =>
        id === currentSessionId || now - ssp.updatedAt < SSP_SESSION_TTL_MS,
    ),
  );

  // Step 2: 如果超过 MAX_SSP_SESSIONS, 淘汰最旧的 (当前 session 豁免)
  const entries = Object.entries(afterTTL);
  if (entries.length <= MAX_SSP_SESSIONS) {
    return afterTTL;
  }

  // 按 updatedAt 升序排列 (最旧的在前), 豁免当前 session
  const sorted = entries
    .filter(([id]) => id !== currentSessionId)
    .sort(([, a], [, b]) => a.updatedAt - b.updatedAt);

  const toRemove = sorted.length - (MAX_SSP_SESSIONS - 1); // -1 为当前 session 预留
  const evicted = new Set(
    sorted.slice(0, Math.max(0, toRemove)).map(([id]) => id),
  );

  return Object.fromEntries(entries.filter(([id]) => !evicted.has(id)));
}

/**
 * 保存 SSP (串行化写入, 防并发).
 */
export async function saveSessionState(ssp: SessionStatePage): Promise<void> {
  await withWriteLock(ssp.sessionId, async () => {
    const store = await loadSSPStore();
    // 写入前执行 LRU + TTL eviction (当前 session 豁免)
    const evictedSessions = evictStaleSessions(
      store.sessions,
      ssp.sessionId,
      Date.now(),
    );
    const newStore: SSPStoreFile = {
      version: SSP_SCHEMA_VERSION,
      sessions: {
        ...evictedSessions,
        [ssp.sessionId]: ssp,
      },
    };
    await saveSSPStore(newStore);
  });
}
