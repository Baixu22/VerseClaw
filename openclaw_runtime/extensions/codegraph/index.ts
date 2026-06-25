// CodeGraph extension — semantic code intelligence for OpenClaw agents.
// Vendored from @colbymchenry/codegraph v1.0.1 + AgentGraph extensions.
import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Type } from "typebox";

// ── Parameter schemas ──────────────────────────────────────────────

const WorkspaceParam = Type.String({ description: "Absolute workspace root path" });
const FreshnessModeParam = Type.Optional(Type.Union([
  Type.Literal("fast"),
  Type.Literal("balanced"),
  Type.Literal("strict"),
], {
  description: "Freshness policy: fast skips sync, balanced does throttled incremental sync, strict waits for sync before reading.",
}));

const ExploreSchema = Type.Object({
  workspacePath: WorkspaceParam,
  query: Type.String({ description: "Natural language question or comma-separated symbol names" }),
  maxFiles: Type.Optional(Type.Number({ description: "Max source files to return (default: 5)" })),
  freshnessMode: FreshnessModeParam,
});

const SearchSchema = Type.Object({
  workspacePath: WorkspaceParam,
  query: Type.String({ description: "Symbol name or keyword" }),
  kind: Type.Optional(Type.String({ description: "Optional: filter by symbol kind" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
  freshnessMode: FreshnessModeParam,
});

const CallersSchema = Type.Object({
  workspacePath: WorkspaceParam,
  symbol: Type.String({ description: "Symbol name" }),
  depth: Type.Optional(Type.Number({ description: "Caller depth (default: 2)" })),
  freshnessMode: FreshnessModeParam,
});

const CalleesSchema = Type.Object({
  workspacePath: WorkspaceParam,
  symbol: Type.String({ description: "Symbol name" }),
  depth: Type.Optional(Type.Number({ description: "Callee depth (default: 2)" })),
  freshnessMode: FreshnessModeParam,
});

const ImpactSchema = Type.Object({
  workspacePath: WorkspaceParam,
  symbol: Type.String({ description: "Symbol name" }),
  depth: Type.Optional(Type.Number({ description: "Impact depth (default: 3)" })),
  freshnessMode: FreshnessModeParam,
});

const StatusSchema = Type.Object({
  workspacePath: WorkspaceParam,
});

const SyncSchema = Type.Object({
  workspacePath: WorkspaceParam,
  force: Type.Optional(Type.Boolean({ description: "Run incremental sync even when the balanced-mode throttle window has not expired." })),
});

const InitSchema = Type.Object({
  workspacePath: WorkspaceParam,
});

const EntrypointsSchema = Type.Object({
  workspacePath: WorkspaceParam,
  type: Type.Optional(Type.String({ description: "Filter: http_api, cli, scheduled_task, message_queue, websocket, rpc, event_handler" })),
  freshnessMode: FreshnessModeParam,
});

const FindFlowSchema = Type.Object({
  workspacePath: WorkspaceParam,
  flow: Type.String({ description: "Business flow name (e.g. user_login, order_checkout)" }),
  maxSteps: Type.Optional(Type.Number({ description: "Max steps per flow (default: 20)" })),
  freshnessMode: FreshnessModeParam,
});

const MinimalContextSchema = Type.Object({
  workspacePath: WorkspaceParam,
  task: Type.String({ description: "Task description (e.g. 'add email validation to user registration')" }),
  maxTokens: Type.Optional(Type.Number({ description: "Token budget (default: 5000)" })),
  freshnessMode: FreshnessModeParam,
});

const GitStatsSchema = Type.Object({
  workspacePath: WorkspaceParam,
  file: Type.Optional(Type.String({ description: "Optional: focus on a specific file" })),
  maxCommits: Type.Optional(Type.Number({ description: "Max commits (default: 500)" })),
  sinceDays: Type.Optional(Type.Number({ description: "Only analyze last N days" })),
});

const FreshnessSchema = Type.Object({
  workspacePath: WorkspaceParam,
  freshnessMode: FreshnessModeParam,
});

const DecisionSchema = Type.Object({
  workspacePath: Type.Optional(WorkspaceParam),
  userIntent: Type.String({ description: "User request or task intent to classify before selecting code context tools." }),
  operationType: Type.Optional(Type.Union([
    Type.Literal("answer"),
    Type.Literal("locate"),
    Type.Literal("explain"),
    Type.Literal("modify"),
    Type.Literal("debug"),
    Type.Literal("test"),
    Type.Literal("refactor"),
    Type.Literal("review"),
  ], { description: "Optional task type hint." })),
  knownFiles: Type.Optional(Type.Array(Type.String(), { description: "Files already named by the user or upstream planner." })),
  riskLevel: Type.Optional(Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
    Type.Literal("critical"),
  ], { description: "Optional risk hint. High/critical tasks require stricter source reads." })),
});

const ContextPlanSchema = Type.Object({
  workspacePath: WorkspaceParam,
  task: Type.String({ description: "Task description to turn into a source-reading plan." }),
  operationType: Type.Optional(DecisionSchema.properties.operationType),
  knownFiles: Type.Optional(Type.Array(Type.String(), { description: "Files already named by the user or upstream planner." })),
  riskLevel: Type.Optional(DecisionSchema.properties.riskLevel),
  maxFiles: Type.Optional(Type.Number({ description: "Maximum files to include in the source-reading plan (default: 8)." })),
  maxSymbols: Type.Optional(Type.Number({ description: "Maximum symbols to inspect while planning (default: 12)." })),
});

// ── Lazy tool builder ──────────────────────────────────────────────

function createLazyCG(
  descriptor: Pick<AnyAgentTool, "label" | "name" | "description" | "parameters">,
  loadTool: () => Promise<AnyAgentTool>,
): AnyAgentTool {
  let toolPromise: Promise<AnyAgentTool> | undefined;
  const loadOnce = () => {
    toolPromise ??= loadTool();
    return toolPromise;
  };
  return {
    ...descriptor,
    async execute(toolCallId, args, signal, onUpdate) {
      const tool = await loadOnce();
      return await tool.execute(toolCallId, args, signal, onUpdate);
    },
  };
}

// ── CodeGraph singleton ────────────────────────────────────────────

interface CGInstance {
  cg: any;
  status: string;
  workspacePath: string;
  lastSyncAt?: number;
  lastSyncResult?: Record<string, unknown>;
  syncPromise?: Promise<Record<string, unknown>>;
  lastFreshness?: CodeGraphFreshness;
  watcher?: fs.FSWatcher;
  watcherStatus?: "active" | "unavailable" | "error";
  watcherError?: string;
  dirtySince?: number;
  dirtyFilePaths: Set<string>;
  lastWatchEventAt?: number;
}

const cgInstances = new Map<string, CGInstance>();
const BALANCED_SYNC_TTL_MS = 5_000;
const LIVE_FILE_VERIFY_LIMIT = 8;

async function loadCodeGraphMod(): Promise<any> {
  const req = createRequire(import.meta.url);
  return req("./dist/index.js");
}

async function getOrCreateCG(workspacePath: string): Promise<CGInstance> {
  let inst = cgInstances.get(workspacePath);
  if (inst && inst.status === "ready") {
    startWorkspaceWatcher(workspacePath, inst);
    return inst;
  }

  const mod = await loadCodeGraphMod();
  const CG = mod.CodeGraph;

  try {
    const initialized = CG.isInitialized(workspacePath);
    const cg = initialized
      ? await CG.open(workspacePath, { sync: false })
      : await CG.init(workspacePath, { index: true });

    inst = {
      cg,
      status: "ready",
      workspacePath,
      lastSyncAt: initialized ? undefined : Date.now(),
      dirtyFilePaths: new Set<string>(),
    };
    startWorkspaceWatcher(workspacePath, inst);
    cgInstances.set(workspacePath, inst);
    return inst;
  } catch (err: any) {
    throw new Error(`CodeGraph init failed: ${err.message}`);
  }
}

// ── Tool factories ─────────────────────────────────────────────────

type CGParams = Record<string, unknown>;

function wp(args: CGParams) { return String(args.workspacePath ?? ""); }

type FreshnessMode = "fast" | "balanced" | "strict";
type OperationType = "answer" | "locate" | "explain" | "modify" | "debug" | "test" | "refactor" | "review";
type RiskLevel = "low" | "medium" | "high" | "critical";

interface CodeGraphFreshness {
  mode: FreshnessMode;
  status: "unchecked" | "fresh" | "refreshed" | "stale" | "error";
  checkedAt: number;
  lastSyncAt?: number;
  syncAttempted: boolean;
  syncReason: string;
  syncDurationMs?: number;
  changedFileCount?: number;
  changedFilesSample?: string[];
  dirtySince?: number;
  pendingDirtyFileCount?: number;
  pendingDirtyFilesSample?: string[];
  watcher?: {
    status: "active" | "unavailable" | "error";
    error?: string;
    lastEventAt?: number;
  };
  syncResult?: Record<string, unknown>;
  error?: string;
  recommendation: string;
}

function freshnessMode(args: CGParams): FreshnessMode {
  const raw = args.freshnessMode;
  return raw === "fast" || raw === "strict" ? raw : "balanced";
}

function changedFileCount(result: Record<string, unknown> | undefined): number {
  if (!result) return 0;
  return Number(result.filesAdded ?? 0) + Number(result.filesModified ?? 0) + Number(result.filesRemoved ?? 0);
}

function changedFilesSample(result: Record<string, unknown> | undefined): string[] {
  const paths = result?.changedFilePaths;
  return Array.isArray(paths) ? paths.slice(0, 20).map((item) => String(item)) : [];
}

function pendingDirtyFilesSample(inst: CGInstance): string[] {
  return [...inst.dirtyFilePaths].slice(0, 20);
}

function watcherState(inst: CGInstance): CodeGraphFreshness["watcher"] {
  return {
    status: inst.watcherStatus ?? "unavailable",
    error: inst.watcherError,
    lastEventAt: inst.lastWatchEventAt,
  };
}

function isIgnoredWatchPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized === "" ||
    normalized === ".git" ||
    normalized === "node_modules" ||
    normalized === ".codegraph" ||
    normalized === "dist" ||
    normalized.startsWith(".git/") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith(".codegraph/") ||
    normalized.startsWith("dist/") ||
    normalized.endsWith("~") ||
    normalized.includes("/.git/") ||
    normalized.includes("/node_modules/") ||
    normalized.includes("/.codegraph/");
}

function markDirty(inst: CGInstance, fileName: string | Buffer | null | undefined): void {
  const raw = fileName ? String(fileName) : "";
  const relativePath = raw.length > 0 ? raw.replace(/\\/g, "/") : "<unknown>";
  if (isIgnoredWatchPath(relativePath)) return;
  const now = Date.now();
  inst.dirtySince ??= now;
  inst.lastWatchEventAt = now;
  if (inst.dirtyFilePaths.size < 200) {
    inst.dirtyFilePaths.add(relativePath);
  }
}

function clearDirtyIfCovered(inst: CGInstance, syncStartedAt: number): void {
  const lastDirtyEventAt = inst.lastWatchEventAt ?? inst.dirtySince;
  if (inst.dirtySince !== undefined && lastDirtyEventAt !== undefined && lastDirtyEventAt <= syncStartedAt) {
    inst.dirtySince = undefined;
    inst.dirtyFilePaths.clear();
  }
}

function startWorkspaceWatcher(workspacePath: string, inst: CGInstance): void {
  if (inst.watcher || inst.watcherStatus === "error") return;
  try {
    inst.watcher = fs.watch(workspacePath, { recursive: true }, (_eventType, fileName) => {
      markDirty(inst, fileName);
    });
    inst.watcher.unref?.();
    inst.watcher.on("error", (err) => {
      inst.watcherStatus = "error";
      inst.watcherError = String((err as Error)?.message ?? err);
      try { inst.watcher?.close(); } catch { /* noop */ }
      inst.watcher = undefined;
    });
    inst.watcherStatus = "active";
  } catch (err: any) {
    inst.watcherStatus = "unavailable";
    inst.watcherError = String(err?.message ?? err);
  }
}

async function syncInstance(inst: CGInstance, reason: string): Promise<Record<string, unknown>> {
  if (inst.syncPromise) return inst.syncPromise;
  const started = Date.now();
  inst.syncPromise = Promise.resolve()
    .then(async () => {
      const result = await inst.cg.sync();
      return { ...(result ?? {}), durationMs: Number((result as any)?.durationMs ?? Date.now() - started) };
    })
    .finally(() => {
      inst.syncPromise = undefined;
    });
  const result = await inst.syncPromise;
  inst.lastSyncAt = Date.now();
  inst.lastSyncResult = result;
  clearDirtyIfCovered(inst, started);
  inst.lastFreshness = {
    mode: "balanced",
    status: changedFileCount(result) > 0 ? "refreshed" : "fresh",
    checkedAt: Date.now(),
    lastSyncAt: inst.lastSyncAt,
    syncAttempted: true,
    syncReason: reason,
    syncDurationMs: Number(result.durationMs ?? Date.now() - started),
    changedFileCount: changedFileCount(result),
    changedFilesSample: changedFilesSample(result),
    dirtySince: inst.dirtySince,
    pendingDirtyFileCount: inst.dirtyFilePaths.size,
    pendingDirtyFilesSample: pendingDirtyFilesSample(inst),
    watcher: watcherState(inst),
    syncResult: result,
    recommendation: "Index has been synchronized before serving the result.",
  };
  return result;
}

async function ensureFreshness(inst: CGInstance, mode: FreshnessMode, force = false): Promise<CodeGraphFreshness> {
  const checkedAt = Date.now();
  if (mode === "fast" && !force) {
    const hasDirtyFiles = inst.dirtySince !== undefined;
    const freshness: CodeGraphFreshness = {
      mode,
      status: hasDirtyFiles ? "stale" : "unchecked",
      checkedAt,
      lastSyncAt: inst.lastSyncAt,
      syncAttempted: false,
      syncReason: hasDirtyFiles ? "fast_mode_skips_sync_dirty_workspace" : "fast_mode_skips_sync",
      dirtySince: inst.dirtySince,
      pendingDirtyFileCount: inst.dirtyFilePaths.size,
      pendingDirtyFilesSample: pendingDirtyFilesSample(inst),
      watcher: watcherState(inst),
      recommendation: hasDirtyFiles
        ? "Fast mode detected filesystem changes but skipped sync; results may be stale. Use balanced or strict."
        : "Fast mode uses the current index snapshot. Use balanced or strict for stronger freshness.",
    };
    inst.lastFreshness = freshness;
    return freshness;
  }

  const elapsed = inst.lastSyncAt === undefined ? Number.POSITIVE_INFINITY : checkedAt - inst.lastSyncAt;
  const shouldSync = force || mode === "strict" || inst.dirtySince !== undefined || elapsed > BALANCED_SYNC_TTL_MS;
  if (!shouldSync) {
    const freshness: CodeGraphFreshness = {
      mode,
      status: "fresh",
      checkedAt,
      lastSyncAt: inst.lastSyncAt,
      syncAttempted: false,
      syncReason: `balanced_throttle_${BALANCED_SYNC_TTL_MS}ms`,
      changedFileCount: changedFileCount(inst.lastSyncResult),
      changedFilesSample: changedFilesSample(inst.lastSyncResult),
      dirtySince: inst.dirtySince,
      pendingDirtyFileCount: inst.dirtyFilePaths.size,
      pendingDirtyFilesSample: pendingDirtyFilesSample(inst),
      watcher: watcherState(inst),
      recommendation: "Recent sync is still inside the balanced-mode freshness window.",
    };
    inst.lastFreshness = freshness;
    return freshness;
  }

  const reason = force ? "forced_sync" : mode === "strict" ? "strict_mode" : inst.dirtySince !== undefined ? "watcher_dirty_workspace" : "balanced_ttl_expired";
  try {
    const result = await syncInstance(inst, reason);
    const freshness: CodeGraphFreshness = {
      mode,
      status: changedFileCount(result) > 0 ? "refreshed" : "fresh",
      checkedAt: Date.now(),
      lastSyncAt: inst.lastSyncAt,
      syncAttempted: true,
      syncReason: reason,
      syncDurationMs: Number(result.durationMs ?? 0),
      changedFileCount: changedFileCount(result),
      changedFilesSample: changedFilesSample(result),
      dirtySince: inst.dirtySince,
      pendingDirtyFileCount: inst.dirtyFilePaths.size,
      pendingDirtyFilesSample: pendingDirtyFilesSample(inst),
      watcher: watcherState(inst),
      syncResult: result,
      recommendation: "Index has been synchronized before serving the result.",
    };
    inst.lastFreshness = freshness;
    return freshness;
  } catch (err: any) {
    const freshness: CodeGraphFreshness = {
      mode,
      status: "error",
      checkedAt: Date.now(),
      lastSyncAt: inst.lastSyncAt,
      syncAttempted: true,
      syncReason: reason,
      dirtySince: inst.dirtySince,
      pendingDirtyFileCount: inst.dirtyFilePaths.size,
      pendingDirtyFilesSample: pendingDirtyFilesSample(inst),
      watcher: watcherState(inst),
      error: String(err?.message ?? err),
      recommendation: mode === "strict"
        ? "Strict mode cannot continue without a successful sync."
        : "Using the previous index snapshot; consider codegraph_sync or strict mode.",
    };
    inst.lastFreshness = freshness;
    if (mode === "strict") throw new Error(`CodeGraph strict sync failed: ${freshness.error}`);
    return freshness;
  }
}

async function prepareCG(args: CGParams, forceSync = false): Promise<{ cg: any; inst: CGInstance; freshness: CodeGraphFreshness }> {
  const inst = await getOrCreateCG(wp(args));
  const freshness = await ensureFreshness(inst, freshnessMode(args), forceSync);
  return { cg: inst.cg, inst, freshness };
}

function collectFilePaths(value: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || out.size >= LIVE_FILE_VERIFY_LIMIT) return out;
  if (!value || typeof value !== "object") return out;
  if (value instanceof Map) {
    for (const entry of value.values()) collectFilePaths(entry, out, depth + 1);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectFilePaths(entry, out, depth + 1);
    return out;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.filePath === "string" && record.filePath.length > 0) {
    out.add(record.filePath);
  }
  if (record.node) collectFilePaths(record.node, out, depth + 1);
  if (record.nodes) collectFilePaths(record.nodes, out, depth + 1);
  if (record.files) collectFilePaths(record.files, out, depth + 1);
  for (const key of ["caller", "callee", "source", "target", "entryPoint", "steps", "symbols"]) {
    if (record[key]) collectFilePaths(record[key], out, depth + 1);
  }
  return out;
}

function verifyLiveFiles(workspacePath: string, payload: unknown) {
  const workspaceRoot = path.resolve(workspacePath);
  const files = [...collectFilePaths(payload)].slice(0, LIVE_FILE_VERIFY_LIMIT);
  const verified = [];
  const missing = [];
  for (const filePath of files) {
    const fullPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot, filePath);
    if (fullPath !== workspaceRoot && !fullPath.startsWith(`${workspaceRoot}${path.sep}`)) {
      missing.push({ filePath, reason: "outside_workspace" });
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      missing.push({ filePath, reason: "missing_on_disk" });
      continue;
    }
    const stat = fs.statSync(fullPath);
    verified.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return {
    verifiedFileCount: verified.length,
    missingFileCount: missing.length,
    checkedFileCount: files.length,
    verified,
    missing,
  };
}

function confidenceFor(freshness: CodeGraphFreshness, liveFiles: ReturnType<typeof verifyLiveFiles>): number {
  if (freshness.status === "error") return 0.35;
  if (freshness.status === "unchecked") return liveFiles.missingFileCount > 0 ? 0.45 : 0.65;
  if (freshness.status === "stale") return liveFiles.missingFileCount > 0 ? 0.4 : 0.55;
  if (liveFiles.missingFileCount > 0) return 0.65;
  if (freshness.status === "refreshed") return 0.92;
  return 0.96;
}

function compactRuntimeMetadata(freshness: CodeGraphFreshness, retrieval: Record<string, any>) {
  return {
    codegraphRuntime: {
      freshness: {
        mode: freshness.mode,
        status: freshness.status,
        syncAttempted: freshness.syncAttempted,
        syncReason: freshness.syncReason,
        lastSyncAt: freshness.lastSyncAt,
        changedFileCount: freshness.changedFileCount,
        changedFilesSample: freshness.changedFilesSample,
        dirtySince: freshness.dirtySince,
        pendingDirtyFileCount: freshness.pendingDirtyFileCount,
        pendingDirtyFilesSample: freshness.pendingDirtyFilesSample,
        watcher: freshness.watcher,
        recommendation: freshness.recommendation,
      },
      retrieval: {
        source: retrieval.source,
        confidence: retrieval.confidence,
        tokenStrategy: retrieval.tokenStrategy,
        liveFiles: {
          verifiedFileCount: retrieval.liveFiles.verifiedFileCount,
          missingFileCount: retrieval.liveFiles.missingFileCount,
          checkedFileCount: retrieval.liveFiles.checkedFileCount,
        },
      },
    },
  };
}

function enrichResult<T extends Record<string, any>>(
  result: T,
  params: CGParams,
  freshness: CodeGraphFreshness,
  payload: unknown,
  extraDetails: Record<string, unknown> = {},
) {
  const liveFiles = verifyLiveFiles(wp(params), payload);
  const retrieval = {
    source: freshness.syncAttempted ? "index+sync+live-file-check" : "index+live-file-check",
    confidence: confidenceFor(freshness, liveFiles),
    tokenStrategy: "return indexed candidates and compact JSON; verify top referenced files against disk metadata",
    liveFiles,
  };
  const content = Array.isArray(result.content)
    ? [
        ...result.content,
        { type: "text" as const, text: JSON.stringify(compactRuntimeMetadata(freshness, retrieval)) },
      ]
    : result.content;
  return {
    ...result,
    content,
    details: {
      ...(result.details ?? {}),
      ...extraDetails,
      freshness,
      retrieval,
    },
  };
}

function textIncludesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function arrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function inferOperationType(intent: string, explicit: unknown): OperationType {
  if (typeof explicit === "string" && ["answer", "locate", "explain", "modify", "debug", "test", "refactor", "review"].includes(explicit)) {
    return explicit as OperationType;
  }
  const text = intent.toLowerCase();
  if (textIncludesAny(text, ["refactor", "重构", "迁移", "rename", "extract"])) return "refactor";
  if (textIncludesAny(text, ["fix", "修复", "modify", "修改", "implement", "实现", "add ", "新增", "delete", "删除", "patch"])) return "modify";
  if (textIncludesAny(text, ["debug", "报错", "error", "stack trace", "失败", "崩溃"])) return "debug";
  if (textIncludesAny(text, ["test", "测试", "spec", "验证"])) return "test";
  if (textIncludesAny(text, ["review", "审查", "风险", "漏洞"])) return "review";
  if (textIncludesAny(text, ["where", "在哪", "定位", "find", "查找", "入口", "entrypoint"])) return "locate";
  if (textIncludesAny(text, ["explain", "解释", "理解", "流程", "flow", "调用链", "call chain"])) return "explain";
  return "answer";
}

function inferRiskLevel(intent: string, explicit: unknown): RiskLevel {
  if (typeof explicit === "string" && ["low", "medium", "high", "critical"].includes(explicit)) {
    return explicit as RiskLevel;
  }
  const text = intent.toLowerCase();
  if (textIncludesAny(text, ["delete", "删除", "rm -rf", "payment", "支付", "credential", "secret", "token", "auth", "认证", "权限", "permission", "sandbox", "exec", "执行", "migration", "迁移", "protocol", "协议", "api contract", "schema", "database", "db", "并发", "concurrency", "cache", "缓存", "sync", "watcher", "freshness", "runtime", "gateway", "tool registry"])) {
    return "high";
  }
  if (textIncludesAny(text, ["refactor", "重构", "security", "安全", "impact", "影响面"])) return "medium";
  return "low";
}

function hasExplicitSourceFile(intent: string, knownFiles: string[]): boolean {
  if (knownFiles.length > 0) return true;
  return /(?:^|\s|[`'"])(?:[A-Za-z]:[\\/])?[\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|yml|yaml|toml|rs|go|py|java|kt|swift|c|cc|cpp|h|hpp|cs|php|rb|sql|css|scss|html|vue|svelte)(?:\b|[`'"])/i.test(intent);
}

function isMostlyNonCodeTask(intent: string, operationType: OperationType): boolean {
  const text = intent.toLowerCase();
  if (["modify", "debug", "refactor", "review", "locate", "explain"].includes(operationType)) return false;
  return textIncludesAny(text, ["readme", "文档", "docs", "copywriting", "文案", "i18n", "翻译", "package.json script", "配置说明"]) &&
    !textIncludesAny(text, ["调用", "call", "impact", "入口", "runtime", "api", "schema"]);
}

function decideCodeGraphBoundary(params: CGParams) {
  const userIntent = String(params.userIntent ?? "");
  const intent = userIntent.toLowerCase();
  const knownFiles = arrayFromUnknown(params.knownFiles);
  const operationType = inferOperationType(userIntent, params.operationType);
  const riskLevel = inferRiskLevel(userIntent, params.riskLevel);
  const explicitSource = hasExplicitSourceFile(userIntent, knownFiles);
  const nonCodeTask = isMostlyNonCodeTask(userIntent, operationType);
  const structuralNeed = textIncludesAny(intent, [
    "where", "在哪", "定位", "入口", "entrypoint", "call", "caller", "callee", "调用", "调用链",
    "impact", "影响", "blast radius", "flow", "流程", "architecture", "架构", "symbol", "符号",
    "minimal context", "上下文", "hotspot", "co-change",
  ]);
  const broadChange = operationType === "refactor" || textIncludesAny(intent, ["跨模块", "multi-module", "全局", "global", "rename", "重命名", "迁移"]);
  const modification = ["modify", "debug", "test", "refactor", "review"].includes(operationType);
  const highRisk = riskLevel === "high" || riskLevel === "critical";

  let shouldUseCodeGraph = !nonCodeTask && (structuralNeed || broadChange || highRisk || (!explicitSource && ["locate", "explain", "debug", "refactor", "review"].includes(operationType)));
  if (explicitSource && !structuralNeed && !broadChange && !highRisk && operationType !== "review") {
    shouldUseCodeGraph = false;
  }

  const mustReadSource = modification || highRisk || explicitSource || shouldUseCodeGraph;
  const requiredFreshnessMode: FreshnessMode = highRisk || operationType === "refactor" || operationType === "review"
    ? "strict"
    : shouldUseCodeGraph
      ? "balanced"
      : "fast";

  const codegraphRole = !shouldUseCodeGraph
    ? "skip"
    : broadChange || highRisk || operationType === "review"
      ? "impact"
      : operationType === "locate"
        ? "navigate"
        : operationType === "explain"
          ? "flow"
          : "context_filter";

  const sourceReadPolicy = !mustReadSource
    ? "none"
    : explicitSource
      ? "read_named_files_before_edit_or_claim"
      : highRisk
        ? "read_entrypoints_call_chain_and_all_edit_targets"
        : shouldUseCodeGraph
          ? "read_top_codegraph_candidates_before_edit_or_claim"
          : "read_target_files_before_edit";

  const recommendedTools = shouldUseCodeGraph
    ? [
        operationType === "locate" ? "codegraph_search" : undefined,
        operationType === "explain" ? "codegraph_find_flow/codegraph_explore" : undefined,
        codegraphRole === "impact" ? "codegraph_impact" : undefined,
        "file_read",
      ].filter(Boolean)
    : mustReadSource
      ? ["file_read", explicitSource ? undefined : "grep/search"].filter(Boolean)
      : ["none"];

  const fallbackStrategy = shouldUseCodeGraph
    ? "If CodeGraph returns no results, low confidence, stale freshness, or missing live files, fall back to grep/search and direct file reads."
    : explicitSource
      ? "Read the named files directly; use CodeGraph only if impact or call-chain questions emerge."
      : "Skip CodeGraph; use direct reasoning, shell, docs, or file reads as needed.";

  const reasons = [
    explicitSource ? "User or planner already named source files, so direct file read is the primary fact source." : undefined,
    structuralNeed ? "Intent asks for structure, location, flow, call graph, or impact; CodeGraph can reduce context cost." : undefined,
    broadChange ? "Broad/refactor-like change benefits from impact analysis before editing." : undefined,
    highRisk ? "High-risk runtime/security/protocol/state task requires strict freshness and source verification." : undefined,
    nonCodeTask ? "Task appears documentation/config/text-oriented, so CodeGraph would add unnecessary overhead." : undefined,
    modification ? "Code modification/debug/review/test work must read real source before editing or making behavior claims." : undefined,
  ].filter(Boolean);

  return {
    decisionVersion: "codegraph-boundary-v1",
    operationType,
    riskLevel,
    shouldUseCodeGraph,
    codegraphRole,
    requiredFreshnessMode,
    mustReadSource,
    sourceReadPolicy,
    sourceReadTargets: knownFiles,
    recommendedTools,
    fallbackStrategy,
    reasons,
    hardBoundaries: {
      codegraphIsNavigationNotTruth: true,
      editRequiresReadingEditedFiles: true,
      behaviorClaimRequiresReadingEntryAndCriticalCallChain: true,
      highRiskRequiresStrictFreshness: true,
      staleOrLowConfidenceRequiresFallbackToSourceRead: true,
    },
  };
}

interface ContextPlanFile {
  filePath: string;
  priority: number;
  readDepth: "skim" | "deep";
  reasons: string[];
  symbols: string[];
  lineHints: Array<{ startLine?: number; endLine?: number; symbol?: string }>;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function nodeFilePath(node: any): string {
  return String(node?.filePath ?? node?.file_path ?? "");
}

function nodeLineHint(node: any) {
  const startLine = typeof node?.startLine === "number" ? node.startLine : typeof node?.start_line === "number" ? node.start_line : undefined;
  const endLine = typeof node?.endLine === "number" ? node.endLine : typeof node?.end_line === "number" ? node.end_line : undefined;
  const symbol = typeof node?.name === "string" ? node.name : undefined;
  return { startLine, endLine, symbol };
}

function addPlanCandidate(
  candidates: Map<string, ContextPlanFile>,
  filePath: string,
  reason: string,
  priority: number,
  readDepth: "skim" | "deep",
  symbol?: string,
  lineHint?: { startLine?: number; endLine?: number; symbol?: string },
) {
  if (!filePath) return;
  const current = candidates.get(filePath) ?? {
    filePath,
    priority: 0,
    readDepth: "skim" as const,
    reasons: [],
    symbols: [],
    lineHints: [],
  };
  current.priority = Math.max(current.priority, priority);
  if (readDepth === "deep") current.readDepth = "deep";
  if (!current.reasons.includes(reason)) current.reasons.push(reason);
  if (symbol && !current.symbols.includes(symbol)) current.symbols.push(symbol);
  if (lineHint && (lineHint.startLine !== undefined || lineHint.endLine !== undefined || lineHint.symbol)) {
    const key = `${lineHint.symbol ?? ""}:${lineHint.startLine ?? ""}:${lineHint.endLine ?? ""}`;
    const exists = current.lineHints.some((item) => `${item.symbol ?? ""}:${item.startLine ?? ""}:${item.endLine ?? ""}` === key);
    if (!exists && current.lineHints.length < 12) current.lineHints.push(lineHint);
  }
  candidates.set(filePath, current);
}

function sortedPlanFiles(candidates: Map<string, ContextPlanFile>, maxFiles: number): ContextPlanFile[] {
  return [...candidates.values()]
    .sort((a, b) => b.priority - a.priority || a.filePath.localeCompare(b.filePath))
    .slice(0, maxFiles)
    .map((file, index) => ({
      ...file,
      priority: Math.max(1, Math.min(100, file.priority - index)),
      symbols: file.symbols.slice(0, 12),
      lineHints: file.lineHints.slice(0, 12),
    }));
}

function nodesFromSubgraph(subgraph: any): any[] {
  const nodes = subgraph?.nodes;
  if (nodes instanceof Map) return [...nodes.values()];
  if (Array.isArray(nodes)) return nodes;
  return [];
}

async function buildContextPlan(params: CGParams) {
  const task = String(params.task ?? params.userIntent ?? "");
  const maxFiles = boundedNumber(params.maxFiles, 8, 1, 30);
  const maxSymbols = boundedNumber(params.maxSymbols, 12, 1, 50);
  const knownFiles = arrayFromUnknown(params.knownFiles);
  const decision = decideCodeGraphBoundary({
    ...params,
    userIntent: task,
    knownFiles,
  });

  const candidates = new Map<string, ContextPlanFile>();
  for (const filePath of knownFiles) {
    addPlanCandidate(
      candidates,
      filePath,
      "Named by the user or upstream planner; direct source read is the primary fact source.",
      100,
      decision.mustReadSource ? "deep" : "skim",
    );
  }

  if (!decision.shouldUseCodeGraph) {
    const plan = {
      planVersion: "codegraph-context-plan-v1",
      task,
      decision,
      source: "decision-only",
      filesToRead: sortedPlanFiles(candidates, maxFiles),
      symbolsToInspect: [],
      impactAreas: [],
      recommendedSequence: decision.mustReadSource
        ? ["Read named/target files", "Verify behavior from source", "Edit only after source read", "Run focused validation"]
        : ["Skip CodeGraph", "Use direct answer/docs/config workflow"],
      fallbackTriggers: ["If the task expands to call-chain, impact, or architecture questions, run codegraph_decide again."],
    };
    return { plan, freshness: undefined as CodeGraphFreshness | undefined, payloadForVerification: plan.filesToRead };
  }

  const requiredFreshnessMode = decision.requiredFreshnessMode;
  const { cg, freshness } = await prepareCG({ ...params, freshnessMode: requiredFreshnessMode });
  const deepForCandidates = decision.mustReadSource || decision.requiredFreshnessMode === "strict";
  const symbolsToInspect: Array<{ name: string; kind?: string; filePath: string; startLine?: number; endLine?: number; reason: string }> = [];
  const impactAreas = new Set<string>();

  const relevant = await cg.findRelevantContext(task, {
    searchLimit: Math.min(maxSymbols, 12),
    traversalDepth: decision.codegraphRole === "impact" ? 2 : 1,
    maxNodes: Math.min(maxSymbols * 4, 80),
  });
  for (const node of nodesFromSubgraph(relevant)) {
    const filePath = nodeFilePath(node);
    const symbol = typeof node?.name === "string" ? node.name : undefined;
    const lineHint = nodeLineHint(node);
    addPlanCandidate(
      candidates,
      filePath,
      "Matched CodeGraph relevant-context search for this task.",
      85,
      deepForCandidates ? "deep" : "skim",
      symbol,
      lineHint,
    );
    if (symbol && symbolsToInspect.length < maxSymbols) {
      symbolsToInspect.push({ name: symbol, kind: node?.kind, filePath, ...lineHint, reason: "relevant_context" });
    }
  }

  const searchResults = cg.searchNodes(task, { limit: Math.min(maxSymbols, 12) });
  for (const result of searchResults) {
    const node = result?.node ?? result;
    const filePath = nodeFilePath(node);
    const symbol = typeof node?.name === "string" ? node.name : undefined;
    const lineHint = nodeLineHint(node);
    addPlanCandidate(
      candidates,
      filePath,
      "Matched direct symbol search; inspect definition before relying on indexed metadata.",
      78,
      deepForCandidates ? "deep" : "skim",
      symbol,
      lineHint,
    );
    if (symbol && symbolsToInspect.length < maxSymbols) {
      symbolsToInspect.push({ name: symbol, kind: node?.kind, filePath, ...lineHint, reason: "symbol_search" });
    }
  }

  const topRouteFile = cg.getTopRouteFile?.();
  if (topRouteFile && (decision.operationType === "locate" || decision.operationType === "explain" || decision.codegraphRole === "impact")) {
    addPlanCandidate(
      candidates,
      topRouteFile.filePath,
      `Primary route file (${topRouteFile.routeCount}/${topRouteFile.totalRoutes} indexed routes); read when tracing entrypoints.`,
      72,
      "deep",
    );
    impactAreas.add(topRouteFile.filePath);
  }

  if (decision.codegraphRole === "impact" || decision.operationType === "refactor" || decision.riskLevel === "high" || decision.riskLevel === "critical") {
    for (const item of symbolsToInspect.slice(0, 3)) {
      const matches = cg.searchNodes(item.name, { limit: 1 });
      const node = matches?.[0]?.node;
      if (!node?.id) continue;
      const impact = cg.getImpactRadius(node.id, 2);
      for (const impactNode of nodesFromSubgraph(impact)) {
        const filePath = nodeFilePath(impactNode);
        if (!filePath) continue;
        impactAreas.add(filePath);
        addPlanCandidate(
          candidates,
          filePath,
          `Within impact radius of ${item.name}; inspect before high-risk/refactor changes.`,
          65,
          "skim",
          typeof impactNode?.name === "string" ? impactNode.name : undefined,
          nodeLineHint(impactNode),
        );
      }
    }
  }

  const filesToRead = sortedPlanFiles(candidates, maxFiles);
  const plan = {
    planVersion: "codegraph-context-plan-v1",
    task,
    decision,
    source: "decision+codegraph",
    freshness,
    filesToRead,
    symbolsToInspect: symbolsToInspect.slice(0, maxSymbols),
    impactAreas: [...impactAreas].slice(0, maxFiles),
    recommendedSequence: [
      decision.requiredFreshnessMode === "strict" ? "Use strict CodeGraph freshness before planning" : "Use balanced CodeGraph freshness for navigation",
      "Read filesToRead in priority order",
      "Deep-read every edit target before patching",
      "For behavior claims, read the entrypoint and critical call chain",
      "Run focused validation after changes",
    ],
    fallbackTriggers: [
      "CodeGraph freshness is stale/error/unchecked for a critical task",
      "Retrieval confidence is below 0.8",
      "Live-file verification reports missing files",
      "The planned files do not explain the behavior after source read",
      "Search results are empty or dominated by generated/vendor files",
    ],
  };
  return { plan, freshness, payloadForVerification: filesToRead };
}

async function createExploreTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Explore", name: "codegraph_explore",
    description: "Deep-explore a code area by natural-language query or symbol names. Returns verbatim source code with line numbers, call relationships, and a flow summary.",
    parameters: ExploreSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const relevant = await cg.findRelevantContext(String(p.query ?? ""), { searchLimit: 5, traversalDepth: 2, maxNodes: 50 });
      const nodeMap = relevant.nodes as Map<string, any>;
      const mf = Number(p.maxFiles ?? 5);
      const files: { filePath: string; symbols: string[] }[] = [];
      for (const [, node] of nodeMap) {
        const fp = String(node.filePath ?? "");
        const ex = files.find((f) => f.filePath === fp);
        if (ex) ex.symbols.push(String(node.name ?? ""));
        else if (files.length < mf) files.push({ filePath: fp, symbols: [String(node.name ?? "")] });
      }
      return enrichResult({
        content: [{ type: "text" as const, text: JSON.stringify({ files, nodeCount: nodeMap.size }, null, 2) }],
        details: { fileCount: files.length, nodeCount: nodeMap.size },
      }, p, freshness, { files, nodeCount: nodeMap.size });
    },
  };
}

async function createSearchTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Search", name: "codegraph_search",
    description: "Search symbols (functions, classes, components, routes) by name. Returns matching nodes with file paths, line numbers, and relevance scores.",
    parameters: SearchSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const results = cg.searchNodes(String(p.query ?? ""), { kinds: p.kind ? [String(p.kind)] : undefined, limit: Number(p.limit ?? 10) });
      return enrichResult(
        { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }], details: { totalCount: results.length } },
        p,
        freshness,
        results,
      );
    },
  };
}

async function createCallersTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Callers", name: "codegraph_callers",
    description: "List functions/methods that call a given symbol. Traces incoming call edges.",
    parameters: CallersSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const sym = String(p.symbol ?? "");
      const depth = Number(p.depth ?? 2);
      const results = cg.searchNodes(sym, { limit: 1 });
      if (!results.length) return enrichResult({ content: [{ type: "text" as const, text: `Symbol not found: ${sym}` }] }, p, freshness, results, { totalCount: 0 });
      const chain = cg.getCallers(results[0].node.id, depth);
      return enrichResult({ content: [{ type: "text" as const, text: JSON.stringify(chain, null, 2) }], details: { totalCount: chain.length } }, p, freshness, chain);
    },
  };
}

async function createCalleesTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Callees", name: "codegraph_callees",
    description: "List functions/methods called by a given symbol. Traces outgoing call edges.",
    parameters: CalleesSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const sym = String(p.symbol ?? "");
      const depth = Number(p.depth ?? 2);
      const results = cg.searchNodes(sym, { limit: 1 });
      if (!results.length) return enrichResult({ content: [{ type: "text" as const, text: `Symbol not found: ${sym}` }] }, p, freshness, results, { totalCount: 0 });
      const chain = cg.getCallees(results[0].node.id, depth);
      return enrichResult({ content: [{ type: "text" as const, text: JSON.stringify(chain, null, 2) }], details: { totalCount: chain.length } }, p, freshness, chain);
    },
  };
}

async function createImpactTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Impact", name: "codegraph_impact",
    description: "Analyze the blast radius of changing a symbol. Returns all affected nodes and edges.",
    parameters: ImpactSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const sym = String(p.symbol ?? "");
      const depth = Number(p.depth ?? 3);
      const results = cg.searchNodes(sym, { limit: 1 });
      if (!results.length) return enrichResult({ content: [{ type: "text" as const, text: `Symbol not found: ${sym}` }] }, p, freshness, results, { totalCount: 0 });
      const subgraph = cg.getImpactRadius(results[0].node.id, depth);
      return enrichResult({ content: [{ type: "text" as const, text: JSON.stringify(subgraph, null, 2) }], details: { totalCount: subgraph.nodes?.size ?? 0 } }, p, freshness, subgraph);
    },
  };
}

async function createStatusTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Status", name: "codegraph_status",
    description: "Check the CodeGraph index status.",
    parameters: StatusSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const inst = cgInstances.get(wp(p));
      if (!inst) return { content: [{ type: "text" as const, text: JSON.stringify({ status: "not_initialized" }) }], details: { status: "not_initialized" } };
      const stats = inst.cg?.getStats?.() ?? {};
      const runtime = {
        watcher: watcherState(inst),
        dirtySince: inst.dirtySince,
        pendingDirtyFileCount: inst.dirtyFilePaths.size,
        pendingDirtyFilesSample: pendingDirtyFilesSample(inst),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify({ status: inst.status, stats, runtime, freshness: inst.lastFreshness ?? null }, null, 2) }], details: { runtime, freshness: inst.lastFreshness ?? null } };
    },
  };
}

async function createSyncTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Sync", name: "codegraph_sync",
    description: "Incrementally synchronize the CodeGraph index with current files and report freshness metadata.",
    parameters: SyncSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const inst = await getOrCreateCG(wp(p));
      const freshness = await ensureFreshness(inst, "balanced", p.force === true);
      const stats = inst.cg?.getStats?.() ?? {};
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ status: inst.status, stats, freshness }, null, 2) }],
        details: { stats, freshness },
      };
    },
  };
}

async function createInitTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Init", name: "codegraph_init",
    description: "Force a full re-index of the workspace.",
    parameters: InitSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const w = wp(p);
      const inst = cgInstances.get(w);
      let active = inst;
      if (active) {
        const result = await active.cg.indexAll();
        active.lastSyncAt = Date.now();
        active.lastSyncResult = result;
        active.dirtySince = undefined;
        active.dirtyFilePaths.clear();
        active.lastFreshness = {
          mode: "strict",
          status: "refreshed",
          checkedAt: Date.now(),
          lastSyncAt: active.lastSyncAt,
          syncAttempted: true,
          syncReason: "full_reindex",
          syncDurationMs: Number(result?.durationMs ?? 0),
          changedFileCount: Number(result?.filesIndexed ?? 0),
          watcher: watcherState(active),
          syncResult: result,
          recommendation: "Full re-index completed.",
        };
      } else {
        active = await getOrCreateCG(w);
      }
      const stats = active.cg?.getStats?.() ?? {};
      return { content: [{ type: "text" as const, text: JSON.stringify({ status: "ready", stats, freshness: active.lastFreshness ?? null }, null, 2) }], details: { stats, freshness: active.lastFreshness ?? null } };
    },
  };
}

async function createEntrypointsTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Entrypoints", name: "codegraph_entrypoints",
    description: "Detect all application entry points: HTTP API routes, CLI commands, scheduled tasks, message queue consumers, WebSocket handlers, RPC services.",
    parameters: EntrypointsSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const mod = await loadCodeGraphMod();
      const detector = new mod.EntryPointDetector(cg.queries);
      const epType = typeof p.type === "string" ? p.type : undefined;
      const result = epType ? { entryPoints: detector.getEntryPointsByType(epType) } : detector.detectAll();
      const entryPoints = (result as any).entryPoints ?? result;
      return enrichResult({ content: [{ type: "text" as const, text: JSON.stringify(entryPoints, null, 2) }], details: { totalCount: (result as any).totalCount ?? entryPoints.length } }, p, freshness, entryPoints);
    },
  };
}

async function createFindFlowTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Find Flow", name: "codegraph_find_flow",
    description: "Trace a business flow by name. Returns entry point, service chain, repositories, validators, and controllers.",
    parameters: FindFlowSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const mod = await loadCodeGraphMod();
      const epDetector = new mod.EntryPointDetector(cg.queries);
      const flowDetector = new mod.FlowDetector(cg.queries, epDetector);
      const result = mod.findBusinessFlow(cg.queries, epDetector, flowDetector, { flow: String(p.flow ?? ""), maxSteps: Number(p.maxSteps ?? 20) });
      return enrichResult({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }, p, freshness, result);
    },
  };
}

async function createMinimalContextTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Minimal Context", name: "codegraph_minimal_context",
    description: "Given a task description, returns the minimal set of files and symbols needed. Targets 80%+ token reduction.",
    parameters: MinimalContextSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, freshness } = await prepareCG(p);
      const mod = await loadCodeGraphMod();
      const scorer = new mod.SymbolScorer(cg.queries);
      const moduleScorer = new mod.ModuleScorer(cg.queries, scorer);
      const epDetector = new mod.EntryPointDetector(cg.queries);
      const tagger = new mod.SemanticTagger(cg.queries);
      const compressor = new mod.ContextCompressor(cg.queries, scorer, moduleScorer, epDetector, tagger);
      const result = compressor.getMinimalContext({ task: String(p.task ?? ""), maxTokens: Number(p.maxTokens ?? 5000) });
      return enrichResult({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { estimatedTokens: (result as any).estimatedTokens } }, p, freshness, result);
    },
  };
}

async function createGitStatsTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Git Stats", name: "codegraph_git_stats",
    description: "Analyze git history: file modification frequency, hotspots, co-change patterns, author stats.",
    parameters: GitStatsSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const w = wp(p);
      const mod = await loadCodeGraphMod();
      const analyzer = new mod.GitHistoryAnalyzer(w);
      if (!analyzer.isGitRepo()) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Not a git repository" }) }], details: { error: "Not a git repository" } };
      const file = typeof p.file === "string" ? p.file : undefined;
      if (file) {
        const statsMap = analyzer.getFileStats([file]);
        const coChanged = analyzer.getCoChangedFiles(file, 30);
        const freq = analyzer.getModificationFrequency(file);
        const stats = statsMap.get(file);
        return { content: [{ type: "text" as const, text: JSON.stringify({ file, stats, modificationFrequency: freq, coChangedFiles: coChanged }, null, 2) }], details: { file, stats, modificationFrequency: freq, coChangedFiles: coChanged } };
      }
      const result = analyzer.getRepoStats({ maxCommits: Number(p.maxCommits ?? 500), sinceDays: typeof p.sinceDays === "number" ? p.sinceDays as number : undefined });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { totalCommits: (result as any).totalCommits } };
    },
  };
}

async function createFreshnessTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Freshness", name: "codegraph_freshness",
    description: "Check if AgentGraph analysis data is fresh or stale.",
    parameters: FreshnessSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { cg, inst, freshness } = await prepareCG(p);
      const isFresh = cg.isAnalysisFresh?.() ?? false;
      const analysisFreshness = cg.getFreshnessState?.() ?? {};
      const payload = {
        fresh: isFresh && freshness.status !== "error" && freshness.status !== "unchecked",
        recommendation: freshness.recommendation,
        runtimeFreshness: freshness,
        analysisFreshness,
        lastSyncResult: inst.lastSyncResult ?? null,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], details: payload };
    },
  };
}

async function createDecisionTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Decision Boundary", name: "codegraph_decide",
    description: "Decide whether CodeGraph should be used for a task, what freshness mode is required, and when direct source reads are mandatory.",
    parameters: DecisionSchema,
    execute: async (_id, args) => {
      const decision = decideCodeGraphBoundary(args as CGParams);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(decision, null, 2) }],
        details: decision,
      };
    },
  };
}

async function createContextPlanTool(): Promise<AnyAgentTool> {
  return {
    label: "CodeGraph Context Plan", name: "codegraph_context_plan",
    description: "Turn a task into a prioritized source-reading plan: which files/symbols to inspect, how deeply, and where CodeGraph must fall back to direct source reads.",
    parameters: ContextPlanSchema,
    execute: async (_id, args) => {
      const p = args as CGParams;
      const { plan, freshness, payloadForVerification } = await buildContextPlan(p);
      const result = {
        content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
        details: plan,
      };
      if (!freshness) return result;
      return enrichResult(result, p, freshness, payloadForVerification);
    },
  };
}

// ── Plugin entry ───────────────────────────────────────────────────

export default definePluginEntry({
  id: "codegraph",
  name: "CodeGraph",
  description: "Semantic code intelligence: auto-indexes codebase, provides decision boundaries, symbol search, call graph traversal, entry point detection, business flow tracing, minimal context generation, git history analysis, sync, and freshness checks.",
  register(api) {
    api.registerTool(createLazyCG({ label: "CodeGraph Decision Boundary", name: "codegraph_decide", description: "Decide when to use CodeGraph vs direct source reads.", parameters: DecisionSchema }, createDecisionTool), { names: ["codegraph_decide"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Context Plan", name: "codegraph_context_plan", description: "Create a prioritized source-reading plan for a task.", parameters: ContextPlanSchema }, createContextPlanTool), { names: ["codegraph_context_plan"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Explore", name: "codegraph_explore", description: "Deep-explore a code area.", parameters: ExploreSchema }, createExploreTool), { names: ["codegraph_explore"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Search", name: "codegraph_search", description: "Search symbols by name.", parameters: SearchSchema }, createSearchTool), { names: ["codegraph_search"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Callers", name: "codegraph_callers", description: "Find callers of a symbol.", parameters: CallersSchema }, createCallersTool), { names: ["codegraph_callers"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Callees", name: "codegraph_callees", description: "Find callees of a symbol.", parameters: CalleesSchema }, createCalleesTool), { names: ["codegraph_callees"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Impact", name: "codegraph_impact", description: "Analyze blast radius.", parameters: ImpactSchema }, createImpactTool), { names: ["codegraph_impact"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Status", name: "codegraph_status", description: "Check index status.", parameters: StatusSchema }, createStatusTool), { names: ["codegraph_status"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Sync", name: "codegraph_sync", description: "Incrementally synchronize the index.", parameters: SyncSchema }, createSyncTool), { names: ["codegraph_sync"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Init", name: "codegraph_init", description: "Force re-index.", parameters: InitSchema }, createInitTool), { names: ["codegraph_init"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Entrypoints", name: "codegraph_entrypoints", description: "Detect entry points.", parameters: EntrypointsSchema }, createEntrypointsTool), { names: ["codegraph_entrypoints"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Find Flow", name: "codegraph_find_flow", description: "Trace business flow.", parameters: FindFlowSchema }, createFindFlowTool), { names: ["codegraph_find_flow"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Minimal Context", name: "codegraph_minimal_context", description: "Get minimal context for task.", parameters: MinimalContextSchema }, createMinimalContextTool), { names: ["codegraph_minimal_context"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Git Stats", name: "codegraph_git_stats", description: "Analyze git history.", parameters: GitStatsSchema }, createGitStatsTool), { names: ["codegraph_git_stats"] });
    api.registerTool(createLazyCG({ label: "CodeGraph Freshness", name: "codegraph_freshness", description: "Check analysis freshness.", parameters: FreshnessSchema }, createFreshnessTool), { names: ["codegraph_freshness"] });
  },
});
