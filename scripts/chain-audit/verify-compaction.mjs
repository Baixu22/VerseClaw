#!/usr/bin/env node
/**
 * 上下文压缩能力实测 — 对超限会话（agent:main:main，已 >128K 窗口）真实触发一次压缩，
 * 验证 harness 的自动/手动压缩机制是否按预期工作。
 *
 * 步骤：
 *   1. 启动/复用 gateway（--skip-start 复用）
 *   2. 压缩前快照 sessions.compactionStatus + transcript 行数/大小
 *   3. 调 sessions.compact（sessionKey=agent:main:main，超时 120s）
 *   4. 压缩后对比：usedTokens 是否下降、transcript 是否出现 {"type":"compaction"} 事件、token 回收量
 *
 * 用法：
 *   DEEPSEEK_API_KEY=... node scripts/chain-audit/verify-compaction.mjs [--skip-start] [--session agent:main:main]
 *
 * ⚠ 副作用：真实压缩指定会话的历史（summarize 大上下文）。main 会话已 129955 tokens > 128K，压缩属预期修复行为。
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { startGateway, waitForReady } from "./lib/gateway.js";
import { RpcClient } from "./lib/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(__dirname, "../../artifacts/chain-audit/compaction-verify");
const SESSIONS_DIR = () => join(homedir(), ".openclaw", "agents", "main", "sessions");

const args = process.argv.slice(2);
const skipStart = args.includes("--skip-start");
const port = Number(process.env.CHAIN_AUDIT_PORT ?? 18799);
const token = process.env.CHAIN_AUDIT_TOKEN ?? "chain-audit-token";
const sessionIdx = args.indexOf("--session");
const sessionKey = sessionIdx >= 0 ? args[sessionIdx + 1] : "agent:main:main";

function transcriptForSession(key) {
  const dir = SESSIONS_DIR();
  const sid = key.split(":").pop();
  const p = join(dir, `${sid}.jsonl`);
  return existsSync(p) ? p : null;
}

async function compactionStatus(client) {
  // sessions.compactionStatus 参数名固定为 key（与 sessions.compact 一致）
  const res = await client.call("sessions.compactionStatus", { key: sessionKey }, 15_000);
  return { res, params: { key: sessionKey } };
}

async function main() {
  console.log("=== 压缩能力实测 ===");
  console.log(`目标会话: ${sessionKey}`);

  // 1. gateway
  let gateway = null;
  if (!skipStart) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) { console.error("❌ 缺少 DEEPSEEK_API_KEY（压缩 summarize 需要模型）"); process.exit(1); }
    console.log("启动 gateway...");
    gateway = await startGateway({ port, token, env: { DEEPSEEK_API_KEY: apiKey } });
  } else {
    if (!await waitForReady(port, 10_000)) { console.error("❌ --skip-start 但 gateway 未就绪"); process.exit(1); }
  }

  const client = new RpcClient({
    port,
    token,
    scopes: ["operator.read", "operator.write", "operator.admin"],  // sessions.compact 需 operator.admin
  });
  const result = { ts: new Date().toISOString(), sessionKey, steps: [] };
  try {
    await client.connect();

    // 2. 压缩前快照
    const beforeStatus = await compactionStatus(client);
    result.beforeStatus = beforeStatus.res?.ok
      ? { payload: beforeStatus.res.payload, params: beforeStatus.params }
      : { error: beforeStatus.res?.error?.message ?? "compactionStatus 不可用" };
    const tp = transcriptForSession(sessionKey);
    result.transcriptPath = tp;
    const beforeStat = tp ? statSync(tp) : null;
    const beforeLines = tp ? readFileSync(tp, "utf8").split("\n").filter(Boolean).length : 0;
    result.before = tp ? { bytes: beforeStat.size, lines: beforeLines } : { bytes: 0, lines: 0 };
    console.log(`压缩前: ${beforeLines} 行 / ${beforeStat?.size ?? 0} bytes`);
    console.log(`压缩前 compactionStatus:`, JSON.stringify(result.beforeStatus).slice(0, 400));

    // 3. 压缩
    console.log("调用 sessions.compact ...（summarize 大上下文可能较慢，超时 120s）");
    const compactStart = Date.now();
    const compactRes = await client.call("sessions.compact", { key: sessionKey }, 120_000);
    result.compact = {
      ok: compactRes.ok,
      elapsedMs: compactRes.elapsedMs,
      payload: compactRes.ok ? compactRes.payload : undefined,
      error: compactRes.ok ? undefined : compactRes.error?.message,
    };
    result.steps.push({ step: "compact", ok: compactRes.ok, elapsedMs: compactRes.elapsedMs });
    console.log(`sessions.compact: ${compactRes.ok ? "✅ ok" : "❌ " + (compactRes.error?.message ?? "")} (${compactRes.elapsedMs}ms)`);
    console.log("  返回:", JSON.stringify(compactRes.payload ?? {}).slice(0, 500));

    // 4. 压缩后快照
    await new Promise((r) => setTimeout(r, 2000));
    const afterStatus = await compactionStatus(client);
    result.afterStatus = afterStatus.res?.ok
      ? { payload: afterStatus.res.payload, params: afterStatus.params }
      : { error: afterStatus.res?.error?.message ?? "compactionStatus 不可用" };
    const afterStat = tp ? statSync(tp) : null;
    const afterLines = tp ? readFileSync(tp, "utf8").split("\n").filter(Boolean).length : 0;
    result.after = tp ? { bytes: afterStat.size, lines: afterLines } : { bytes: 0, lines: 0 };
    console.log(`压缩后: ${afterLines} 行 / ${afterStat?.size ?? 0} bytes`);
    console.log(`压缩后 compactionStatus:`, JSON.stringify(result.afterStatus).slice(0, 400));

    // 5. transcript 压缩事件检查
    if (tp) {
      const raw = readFileSync(tp, "utf8");
      const compEvents = raw.split("\n").filter((l) => l.includes('"type":"compaction"'));
      result.compactionEvents = compEvents.map((l) => {
        try { return JSON.parse(l); } catch { return l.slice(0, 300); }
      });
      // 检查压缩事件行数（可能被换行分隔，宽松匹配）
      if (compEvents.length === 0) {
        const loose = raw.match(/"compression"\s*:\s*\{[^}]*\}/g) ?? [];
        result.compactionEventsLoose = loose.slice(0, 5).map((s) => s.slice(0, 200));
      }
      console.log(`transcript 压缩事件: ${compEvents.length} 条 ${compEvents.length === 0 ? "(宽松匹配 " + (result.compactionEventsLoose?.length ?? 0) + " 条)" : ""}`);
      if (compEvents.length) console.log("  示例:", JSON.stringify(compEvents[0]).slice(0, 400));
    }

    // 6. 判定
    const payloadOf = (s) => (s?.payload ?? s?.res?.payload) ?? null;
    const usedBefore = payloadOf(result.beforeStatus)?.usedTokens ?? null;
    const usedAfter = payloadOf(result.afterStatus)?.usedTokens ?? null;
    const statusDropped = typeof usedBefore === "number" && typeof usedAfter === "number" && usedAfter < usedBefore;
    const eventSeen = (result.compactionEvents?.length ?? 0) > 0;
    const lastCompactionSeen = Boolean(payloadOf(result.afterStatus)?.lastCompaction);
    result.verdict = {
      compactCallOk: compactRes.ok,
      statusTokensBefore: usedBefore,
      statusTokensAfter: usedAfter,
      statusDropped,
      transcriptEventSeen: eventSeen,
      lastCompactionSeen,
      lineDelta: result.after.lines - result.before.lines,
      pass: compactRes.ok && (statusDropped || lastCompactionSeen),
    };
    console.log(`\n判定: ${result.verdict.pass ? "✅ 压缩机制实测通过" : "❌ 未观察到压缩证据"}`);
    console.log(`  sessions.compact ok=${compactRes.ok} | usedTokens ${usedBefore}→${usedAfter} (回收 ${usedBefore != null && usedAfter != null ? ((1 - usedAfter / usedBefore) * 100).toFixed(1) + "%" : "?"}) | lastCompaction=${lastCompactionSeen} | 行数变化 ${result.after.lines - result.before.lines}`);
  } catch (e) {
    result.fatal = String(e);
    console.error("❌ 失败:", e);
  } finally {
    client.close();
    if (gateway) await gateway.stop();
  }

  // 写报告
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(OUT_ROOT, ts);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`\n报告: ${join(outDir, "report.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
