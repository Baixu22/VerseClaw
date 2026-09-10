#!/usr/bin/env node
/**
 * Chain Audit 主入口 — 全链路集成测试审计系统（持久化工具）
 *
 * 用法（推荐通过 npm scripts 调用）：
 *   pnpm chain-audit                     # 跑全部矩阵（26 链路 + 31 RPC 组）
 *   pnpm chain-audit -- --chain coding   # 只跑指定链路（支持多个：--chain a --chain b）
 *   pnpm chain-audit -- --skip-start     # 复用已运行的 gateway
 *   pnpm chain-audit -- --keep-gateway   # 跑完不关闭 gateway
 *   直接：node scripts/chain-audit/run-chain-audit.mjs [--chain ...]
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY      真实模型 key（必须，agent 会话需要）
 *   CHAIN_AUDIT_PORT      覆盖端口（默认 18799）
 *   CHAIN_AUDIT_TOKEN     覆盖 token
 *
 * 产出：artifacts/chain-audit/evidence/<ts>/ 下 JSON + Markdown 报告 + gateway 日志
 * 趋势：artifacts/chain-audit/evidence/history.json
 * 配置：scripts/chain-audit/config/matrix.json + rpc-checks.json（可扩展）
 */
import { readFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { startGateway, waitForReady, tailGatewayLog } from "./lib/gateway.js";
import { RpcClient } from "./lib/rpc-client.js";
import { grade, GRADES } from "./lib/grade.js";
import {
  evaluateRpcCheck,
  isAdminGatedMethod,
  validateRpcChecksConfig,
} from "./lib/rpc-check.js";
import { writeReport } from "./lib/report.js";
import { analyzeTranscript, latestTranscript, analyzeGatewayLog } from "./lib/monitor.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_ROOT = resolve(__dirname);
// 证据输出到 artifacts/chain-audit/evidence（gitignore 的产物区，不污染工具代码）
const EVIDENCE_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/evidence");

// ── 参数解析 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const argSet = new Set(args);
// 支持多个 --chain（如 --chain skills --chain cron）或逗号分隔
const chainFilter = args.includes("--chain")
  ? args.slice(args.indexOf("--chain") + 1)
      .filter((a) => !a.startsWith("--"))
      .flatMap((a) => a.split(","))
      .filter(Boolean)
  : null;
const skipStart = argSet.has("--skip-start");
const keepGateway = argSet.has("--keep-gateway");

// ── 配置 ──────────────────────────────────────────────────
const matrix = JSON.parse(readFileSync(join(AUDIT_ROOT, "config/matrix.json"), "utf8"));
const port = Number(process.env.CHAIN_AUDIT_PORT ?? 18799);
const token = process.env.CHAIN_AUDIT_TOKEN ?? "chain-audit-token";

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  console.log("=== Chain Audit ===");
  console.log(`矩阵: ${matrix.chains.length} 条链路`);

  // 1. 启动 gateway（或复用）
  let gateway = null;
  if (!skipStart) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error("❌ 缺少 DEEPSEEK_API_KEY 环境变量（agent 会话需要真实模型 key）");
      process.exit(1);
    }
    console.log("启动真实 gateway...");
    gateway = await startGateway({ port, token, env: { DEEPSEEK_API_KEY: apiKey } });
    console.log(`✅ gateway 就绪 (port=${port})`);
  } else {
    const ok = await waitForReady(port, 10_000);
    if (!ok) { console.error("❌ --skip-start 但 gateway 未就绪"); process.exit(1); }
  }

  try {
  // 2. RPC 直接检查（服务可用性，不经模型）
  console.log("\n── RPC 直测 ──");
  const rpcResults = await runRpcChecks({ port, token });

  // 3. 逐链路执行任务
  const results = [];
    for (const chain of matrix.chains) {
      if (chainFilter && !chainFilter.includes(chain.id)) continue;
      console.log(`\n── 链路: ${chain.name} ──`);
      for (const task of chain.tasks) {
        const r = await runTask(chain, task, { port, token });
        results.push(r);
        console.log(`  ${task.id}: ${r.grade} (${r.score}/100)`);
      }
    }

    // 3. 汇总分级
    const { aggregate } = await import("./lib/grade.js");
    const aggregateResult = aggregate(results);
    // RPC 服务面分级（所有组分组内全部 OK 才计通过）
    const rpcAggregate = aggregateRpc(rpcResults);

    // 4. 写报告（含 gateway 日志结构化事件：压缩/重载/错误，替代纯 raw tail）
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = join(EVIDENCE_ROOT, ts);
    const gatewayEvents = gateway?.logPath ? analyzeGatewayLog(gateway.logPath) : undefined;
    const { jsonPath, mdPath } = writeReport(outDir, {
      timestamp: new Date().toISOString(),
      matrix: matrix.schemaVersion,
      aggregate: aggregateResult,
      rpcAggregate,
      tasks: results,
      rpcGroups: rpcResults,
      gatewayLog: gateway?.logPath ? tailGatewayLog(gateway.logPath, 10) : undefined,
      gatewayEvents,
    });

    // 5. 趋势追踪（history.json — 跨运行对比看退化）
    const history = appendHistory(aggregateResult, rpcAggregate, results, rpcResults);

    console.log("\n=== 汇总 ===");
    console.log(`Agent 链路: ${aggregateResult.grade} (${aggregateResult.score}/100) | 通过 ${aggregateResult.passed}/${aggregateResult.taskCount}`);
    console.log(`RPC 服务面: ${rpcAggregate.grade} (${rpcAggregate.score}/100) | ${rpcAggregate.passed}/${rpcAggregate.total} 组`);
    console.log(`趋势: ${history.runs} 次运行 | 最近: ${history.recentScores.join(" → ")}`);
    console.log(`报告: ${jsonPath}`);
    console.log(`     ${mdPath}`);
  } finally {
    if (gateway && !keepGateway) {
      await gateway.stop();
      console.log("gateway 已关闭");
    }
  }
}

// ── 单任务执行 ────────────────────────────────────────────
// 每个任务用独立 sessionKey（agent:main:audit-<id>）→ 独立 transcript，彻底隔离
async function runTask(chain, task, { port, token }) {
  const client = new RpcClient({ port, token });
  const startedAt = Date.now();
  // sessionKey 每次运行唯一（时间戳），避免复用旧 session → transcript 追加历史、跨运行串扰
  const stamp = Date.now();
  const sessionKey = `agent:main:audit-${chain.id}-${task.id}-${stamp}`;
  // 任务开始前快照 sessions 目录（gateway 可能在接受请求时即创建文件，快照须早于 call）
  const sessionDir = join(homedir(), ".openclaw", "agents", "main", "sessions");
  const sessionSnapshot = new Set(
    readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl") && !f.includes("trajectory")),
  );
  try {
    await client.connect();
    const res = await client.call("agent", {
      agentId: matrix.common.agentId,
      sessionKey,
      workspaceDir: matrix.common.workspace,
      message: task.message,
      timeout: task.timeoutMs ?? matrix.common.defaultTimeoutMs,
      idempotencyKey: `audit-${chain.id}-${task.id}-${stamp}`,
    }, task.timeoutMs ?? matrix.common.defaultTimeoutMs);

    const elapsedMs = Date.now() - startedAt;
    if (!res.ok) {
      return { ...base(chain, task, elapsedMs, sessionKey), checks: { accepted: false }, errors: [{ tool: "agent", text: JSON.stringify(res.error).slice(0, 200) }] };
    }

    // 异步执行：等待该 session 的 transcript 出现并稳定（连续 5s 不增长 = 完成）
    const transcriptPath = await waitForSessionComplete(
      sessionKey,
      task.timeoutMs ?? matrix.common.defaultTimeoutMs,
      task.message,
      sessionSnapshot,
      sessionDir,
    );

    // 分析 transcript（独立 session，全量）
    const stats = analyzeTranscript(transcriptPath);
    const checks = {
      accepted: res.ok,
      ...buildToolChecks(stats, task.expectTools ?? []),
      hasAnswer: stats && stats.modelRounds > 0,
    };

    // 链路特定检查
    if (chain.id === "memory") {
      // memory_search 结果含 "disabled"/"metadata is missing" 即视为不可用（可能不在 errors 里）
      const raw = transcriptPath ? readFileSync(transcriptPath, "utf8") : "";
      checks["memory.available"] = !/disabled|metadata is missing/i.test(raw);
    }

    const gradeResult = grade({
      checks,
      // 关键检查：链路可用性类，失败直接判 F
      criticalChecks: chain.id === "memory" ? ["memory.available"] : [],
      metrics: {
        elapsedMs: { value: elapsedMs, good: task.metrics?.elapsedMs?.good ?? 120_000, bad: task.metrics?.elapsedMs?.bad ?? 300_000 },
        ...(stats ? {
          cacheHitRate: { value: stats.cacheHitRate, good: 80, bad: 50 },
        } : {}),
      },
    });

    return {
      ...base(chain, task, elapsedMs),
      ...gradeResult,
      checks,
      metrics: {
        elapsedMs,
        modelRounds: stats?.modelRounds ?? 0,
        totalCost: stats ? +stats.totalCost.toFixed(5) : 0,
        cacheHitRate: stats?.cacheHitRate ?? 0,
      },
      toolSequence: stats?.toolCalls ?? [],
      errors: stats?.errors ?? [],
      transcriptPath,
    };
  } catch (e) {
    return { ...base(chain, task, Date.now() - startedAt), checks: { crashed: false }, errors: [{ tool: "runner", text: String(e).slice(0, 200) }] };
  } finally {
    client.close();
  }
}

function base(chain, task, elapsedMs, sessionKey) {
  return {
    id: `${chain.id}/${task.id}`,
    chain: chain.id,
    description: task.description ?? task.message.slice(0, 60),
    score: 0,
    grade: "F",
    startedAt: new Date().toISOString(),
    elapsedMs,
    sessionKey,
  };
}

function buildToolChecks(stats, expectTools) {
  const used = new Set((stats?.toolCalls ?? []).map((t) => t.name));
  const checks = {};
  for (const tool of expectTools) {
    checks[`tools.${tool}`] = used.has(tool);
  }
  return checks;
}

/** 读取 transcript 的首条 user 消息文本（用于识别文件归属，杜绝跨会话串扰）。 */
function firstUserMessageText(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const r = JSON.parse(line);
      if (r.type !== "message" || r.message?.role !== "user") continue;
      const c = r.message.content;
      if (typeof c === "string" && c.trim()) return c.trim();
      if (Array.isArray(c)) {
        const text = c.map((x) => (typeof x === "string" ? x : x?.text ?? x?.content ?? "")).join("").trim();
        if (text) return text;
      }
    }
  } catch { /* ignore */ }
  return "";
}

/** 等待本任务（sessionKey 唯一）的 transcript 出现并稳定（连续 5s 不增长 = 完成）。
 *  只考虑任务开始后**新增**的文件（独立 sessionKey 必然新建 transcript），
 *  再用任务 user 消息原文匹配归属，彻底隔离各链路（不再取全局最新文件）。
 */
async function waitForSessionComplete(sessionKey, timeoutMs, message, snapshot, sessionDir) {
  const deadline = Date.now() + timeoutMs;
  const dir = sessionDir ?? join(homedir(), ".openclaw", "agents", "main", "sessions");
  const isTranscript = (f) => f.endsWith(".jsonl") && !f.includes("trajectory");
  const knownFiles = snapshot ?? new Set(readdirSync(dir).filter(isTranscript));
  const needle = String(message ?? "").trim();
  let lastSize = -1;
  let stableSince = 0;
  let current = null;

  while (Date.now() < deadline) {
    const files = readdirSync(dir).filter(isTranscript);
    const candidates = files.filter((f) => !knownFiles.has(f));
    if (candidates.length > 0) {
      const newest = candidates
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      // 优先按任务消息匹配归属（前几个新增文件），避免 subagent/并发会话干扰
      const match = needle
        ? newest.slice(0, 3).find((p) => firstUserMessageText(p).includes(needle.slice(0, 40)))
        : undefined;
      const target = match ?? newest[0];
      const size = readFileSync(target, "utf8").length;
      if (size > 0) {
        if (size === lastSize && current === target) {
          if (stableSince === 0) stableSince = Date.now();
          if (Date.now() - stableSince > 5000) return target;
        } else {
          lastSize = size;
          current = target;
          stableSince = Date.now();
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // 超时：返回新增文件中匹配任务消息的 transcript（可能不完整）
  const files = readdirSync(dir).filter(isTranscript);
  const candidates = files.filter((f) => !knownFiles.has(f));
  if (candidates.length === 0) return null;
  const newest = candidates.map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const match = needle ? newest.slice(0, 3).find((p) => firstUserMessageText(p).includes(needle.slice(0, 40))) : undefined;
  return match ?? newest[0];
}

/** RPC 直接检查：逐方法调用，按组汇总分级。 */
async function runRpcChecks({ port, token }) {
  const rpcConfig = JSON.parse(readFileSync(join(AUDIT_ROOT, "config/rpc-checks.json"), "utf8"));
  // 配置写错要在这里炸掉，而不是跑完 31 组后让人对着一堆红灯猜原因。
  const configProblems = validateRpcChecksConfig(rpcConfig);
  if (configProblems.length > 0) {
    throw new Error(`rpc-checks.json 配置非法:\n  - ${configProblems.join("\n  - ")}`);
  }
  const client = new RpcClient({ port, token });
  const results = [];
  try {
    await client.connect();
    for (const group of rpcConfig.groups) {
      const checkResults = [];
      for (const c of [...(group.checks ?? []), ...(group.adminOnly ?? [])]) {
        const res = await client.call(c.method, c.params, 10_000);
        // 判定规则集中在 lib/rpc-check.js：预期错误 / admin gate / 成功 三条通过路径。
        const verdict = evaluateRpcCheck({
          result: res,
          check: c,
          adminGated: isAdminGatedMethod(group, c.method),
        });
        checkResults.push({
          method: c.method,
          elapsedMs: res.elapsedMs,
          ...verdict,
        });
      }
      const passed = checkResults.filter((r) => r.passed).length;
      const total = checkResults.length;
      const g = grade({
        checks: Object.fromEntries(checkResults.map((r) => [r.method, r.passed])),
        criticalChecks: group.critical ? ["health"] : [],
        metrics: {},
      });
      results.push({
        id: group.id,
        name: group.name,
        grade: g.grade,
        score: total > 0 ? Math.round((passed / total) * 100) : 0,
        passed,
        total,
        checks: checkResults,
      });
      console.log(`  [${group.id}] ${g.grade} (${passed}/${total})`);
      for (const c of checkResults.filter((r) => !r.passed)) {
        console.log(`    ✗ ${c.method}: ${c.error}`);
      }
    }
  } finally {
    client.close();
  }
  return results;
}

/** RPC 组汇总：每组按通过率算分，整体取平均。 */
function aggregateRpc(groups) {
  const scores = groups.map((g) => g.score);
  const total = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const grade = Object.values(GRADES).find((g) => total >= g.min) ?? GRADES.F;
  return {
    grade: grade.label,
    score: total,
    passed: groups.filter((g) => g.score >= 75).length,
    total: groups.length,
  };
}

/** 追加趋势记录到 history.json，返回 {runs, recentScores}。 */
function appendHistory(aggregate, rpcAggregate, results, rpcResults) {
  const historyPath = join(EVIDENCE_ROOT, "history.json");
  let history = { runs: [], recentScores: [] };
  try { history = JSON.parse(readFileSync(historyPath, "utf8")); } catch { /* 首次运行 */ }

  history.runs.push({
    ts: new Date().toISOString(),
    agentScore: aggregate.score,
    agentGrade: aggregate.grade,
    rpcScore: rpcAggregate.score,
    rpcGrade: rpcAggregate.grade,
    taskResults: results.map((r) => ({ id: r.id, score: r.score, grade: r.grade })),
    rpcGroups: rpcResults.map((r) => ({ id: r.id, score: r.score })),
  });
  // 只保留最近 50 次
  if (history.runs.length > 50) history.runs = history.runs.slice(-50);
  history.recentScores = history.runs.slice(-5).map((r) => `${r.agentScore}/${r.rpcScore}`);

  try { writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8"); } catch { /* 只读场景 */ }
  return { runs: history.runs.length, recentScores: history.recentScores };
}

main().catch((e) => {
  console.error("Chain Audit 失败:", e);
  process.exit(1);
});
