#!/usr/bin/env node
/**
 * Chain Audit -- full-chain integration test / acceptance monitor (v2).
 *
 * Contract:
 *   - Every matrix check name is evaluated from real transcript evidence
 *     (tool call + tool result linkage, final answer text, workspace file state).
 *   - RPC probes distinguish normal / admin-gated / admin-allowed semantics and
 *     never treat a scope denial as the success of a normal probe.
 *   - Reports are bound to HEAD/tree/config/build digests.
 *   - Fail-closed exit codes: --ci, --fail-on-score <n>, --fail-on-rpc-score <n>.
 *
 * Usage:
 *   node scripts/chain-audit/run-chain-audit.mjs [--chain a --chain b] [--rpc-only]
 *     [--skip-start] [--keep-gateway] [--allow-mutations] [--restore-baseline]
 *     [--fail-on-score n] [--fail-on-rpc-score n] [--ci]
 */
import { readFileSync, mkdirSync, readdirSync, statSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { startGateway, waitForReady, tailGatewayLog } from "./lib/gateway.js";
import { RpcClient } from "./lib/rpc-client.js";
import { grade, GRADES } from "./lib/grade.js";
import { writeReport } from "./lib/report.js";
import { analyzeTranscript, analyzeGatewayLog } from "./lib/monitor.js";
import { buildTaskChecks, snapshotTaskFiles } from "./lib/checks.js";
import { collectMatrixErrors, collectRpcErrors } from "./lib/validate.js";
import { collectEnvironment } from "./lib/evidence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_ROOT = resolve(__dirname);
const REPO_ROOT = resolve(AUDIT_ROOT, "../..");
const EVIDENCE_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/evidence");
const FIXTURE_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/fixtures");

// ---- arguments -----------------------------------------------------------
const args = process.argv.slice(2);
const argSet = new Set(args);
const chainFilter = args.includes("--chain")
  ? args.slice(args.indexOf("--chain") + 1)
      .filter((a) => !a.startsWith("--"))
      .flatMap((a) => a.split(","))
      .filter(Boolean)
  : null;
const skipStart = argSet.has("--skip-start");
const keepGateway = argSet.has("--keep-gateway");
const rpcOnly = argSet.has("--rpc-only");
const allowMutations = argSet.has("--allow-mutations");
const restoreBaseline = argSet.has("--restore-baseline");
const ci = argSet.has("--ci");
const numAfter = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : null;
};
const failOnScore = numAfter("--fail-on-score");
const failOnRpcScore = numAfter("--fail-on-rpc-score");

// ---- config ----------------------------------------------------------------
const matrixText = readFileSync(join(AUDIT_ROOT, "config/matrix.json"), "utf8");
const rpcText = readFileSync(join(AUDIT_ROOT, "config/rpc-checks.json"), "utf8");
const matrix = JSON.parse(matrixText);
const rpcConfig = JSON.parse(rpcText);
const port = Number(process.env.CHAIN_AUDIT_PORT ?? 18799);
const token = process.env.CHAIN_AUDIT_TOKEN ?? "chain-audit-token";

const matrixErrors = collectMatrixErrors(matrix);
const rpcErrors = collectRpcErrors(rpcConfig);
if (matrixErrors.length || rpcErrors.length) {
  for (const e of matrixErrors) console.error(`[matrix] ${e}`);
  for (const e of rpcErrors) console.error(`[rpc] ${e}`);
  console.error("Chain Audit aborted: configuration is invalid (fail closed).");
  process.exit(1);
}

// CHAIN_AUDIT_WORKSPACE overrides common.workspace only.
const envWorkspace = process.env.CHAIN_AUDIT_WORKSPACE;
const commonWorkspace = envWorkspace || matrix.common.workspace;

// ---- main -------------------------------------------------------------------
async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const environment = collectEnvironment(REPO_ROOT, matrixText, rpcText);
  const agentTaskCount = matrix.chains
    .filter((ch) => !chainFilter || chainFilter.includes(ch.id))
    .flatMap((ch) => ch.tasks).length;

  console.log("=== Chain Audit v2 ===");
  console.log(`matrix: ${matrix.chains.length} chains | HEAD=${environment.head ?? "-"} | treeDirty=${environment.treeDirty}`);
  if (!environment.head) console.warn("WARN: could not resolve HEAD; report will lack commit binding.");

  let gateway = null;
  if (!skipStart) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!rpcOnly && !apiKey) {
      console.error("ERROR: DEEPSEEK_API_KEY required for agent chains (--rpc-only does not need one)");
      process.exit(1);
    }
    console.log("starting real gateway...");
    gateway = await startGateway({ port, token, env: apiKey ? { DEEPSEEK_API_KEY: apiKey } : {} });
    console.log(`gateway ready (port=${port})`);
  } else {
    const ok = await waitForReady(port, 10_000);
    if (!ok) { console.error("ERROR: --skip-start but gateway is not ready"); process.exit(1); }
  }

  try {
    console.log("\n-- RPC probes --");
    const rpcResults = await runRpcChecks({ port, token, allowMutations });

    const results = [];
    if (!rpcOnly) {
      for (const chain of matrix.chains) {
        if (chainFilter && !chainFilter.includes(chain.id)) continue;
        console.log(`\n-- chain: ${chain.name} --`);
        let baseline = null;
        try {
          baseline = await prepareChain(chain, { runId });
        } catch (e) {
          if (e.name === "ChainBlockedError") {
            for (const task of chain.tasks) {
              results.push({
                ...base(chain, task, 0, null, commonWorkspace),
                checks: { "baseline.ready": false },
                errors: [{ tool: "runner", text: e.message }],
                blocked: true,
              });
              console.log(`  ${task.id}: F (0/100) - baseline blocked`);
            }
            continue;
          }
          throw e;
        }
        for (const task of chain.tasks) {
          const r = await runTask(chain, task, { port, token, runId, baseline });
          results.push(r);
          console.log(`  ${task.id}: ${r.grade} (${r.score}/100)`);
        }
      }
    }

    const { aggregate } = await import("./lib/grade.js");
    const aggregateResult = aggregate(results);
    const rpcAggregate = aggregateRpc(rpcResults);
    const verdict = computeVerdict({ aggregate: aggregateResult, rpcAggregate, agentTaskCount, rpcOnly });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = join(EVIDENCE_ROOT, ts);
    const gatewayEvents = gateway?.logPath ? analyzeGatewayLog(gateway.logPath) : undefined;
    const { jsonPath, mdPath } = writeReport(outDir, {
      timestamp: new Date().toISOString(),
      matrix: matrix.schemaVersion,
      rpcSchema: rpcConfig.schemaVersion,
      environment,
      aggregate: aggregateResult,
      rpcAggregate,
      tasks: results,
      rpcGroups: rpcResults,
      gatewayLog: gateway?.logPath ? tailGatewayLog(gateway.logPath, 10) : undefined,
      gatewayEvents,
      verdict,
    });

    appendHistory({ environment, aggregate: aggregateResult, rpcAggregate, results, rpcResults, verdict });

    console.log("\n=== summary ===");
    if (aggregateResult.score === null) {
      console.log("agent chains: not executed (--rpc-only)");
    } else {
      console.log(`agent chains: ${aggregateResult.grade} (${aggregateResult.score}/100) | pass ${aggregateResult.passed}/${aggregateResult.taskCount} | critical-fail tasks ${verdict.agentCriticalCount}`);
    }
    console.log(`rpc surface: ${rpcAggregate.grade} (${rpcAggregate.score}/100) | groups ${rpcAggregate.passed}/${rpcAggregate.total} | skipped(mutating) ${rpcAggregate.skippedChecks} | critical ${rpcAggregate.criticalFailed}`);
    console.log(`verdict: ${verdict.ok ? "PASS" : "FAIL"}${verdict.reasons.length ? " | " + verdict.reasons.join("; ") : ""} | exitCode=${verdict.exitCode}`);
    console.log(`report: ${jsonPath}`);
    console.log(`        ${mdPath}`);

    process.exitCode = verdict.exitCode;
  } finally {
    if (gateway && !keepGateway) {
      await gateway.stop();
      console.log("gateway stopped");
    }
  }
}

// ---- single task execution ------------------------------------------------
async function runTask(chain, task, { port, token, runId }) {
  const client = new RpcClient({ port, token });
  const startedAt = Date.now();
  const stamp = Date.now();
  const sessionKey = `agent:main:audit-${chain.id}-${task.id}-${stamp}`;
  const workspace = await resolveTaskWorkspace(chain, task, { runId });
  const sessionDir = join(homedir(), ".openclaw", "agents", "main", "sessions");
  const sessionSnapshot = new Set(
    existsSync(sessionDir)
      ? readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl") && !f.includes("trajectory"))
      : [],
  );
  const beforeFiles = snapshotTaskFiles(task, workspace);
  const message = substitutePlaceholders(task.message, { workspace });

  try {
    await client.connect();
    const res = await client.call("agent", {
      agentId: matrix.common.agentId,
      sessionKey,
      workspaceDir: workspace,
      message,
      timeout: task.timeoutMs ?? matrix.common.defaultTimeoutMs,
      idempotencyKey: `audit-${chain.id}-${task.id}-${stamp}`,
    }, task.timeoutMs ?? matrix.common.defaultTimeoutMs);

    const elapsedMs = Date.now() - startedAt;
    if (!res.ok) {
      return {
        ...base(chain, task, elapsedMs, sessionKey, workspace),
        checks: { accepted: false },
        errors: [{ tool: "agent", text: JSON.stringify(res.error).slice(0, 200) }],
        message,
      };
    }

    const transcriptPath = await waitForSessionComplete(
      sessionKey,
      task.timeoutMs ?? matrix.common.defaultTimeoutMs,
      message,
      sessionSnapshot,
      sessionDir,
    );
    const stats = analyzeTranscript(transcriptPath);
    const transcriptRaw = transcriptPath ? readFileSync(transcriptPath, "utf8") : "";
    const matched = transcriptPath
      ? firstUserMessageText(transcriptPath).includes(message.slice(0, 40))
      : false;
    const afterFiles = snapshotTaskFiles(task, workspace);
    const built = buildTaskChecks({ task, stats, transcriptRaw, workspace });
    const checks = {
      accepted: true,
      "evidence.matched": matched,
      "evidence.complete": Boolean(stats?.complete),
      ...built.checks,
    };

    const metrics = {
      elapsedMs: {
        value: elapsedMs,
        good: task.metrics?.elapsedMs?.good ?? 120_000,
        bad: task.metrics?.elapsedMs?.bad ?? 300_000,
      },
    };
    if (task.metrics?.cacheHitRate && stats) {
      metrics.cacheHitRate = {
        value: stats.cacheHitRate,
        good: task.metrics.cacheHitRate.good ?? 80,
        bad: task.metrics.cacheHitRate.bad ?? 50,
      };
    }

    const critical = [...(task.critical ?? []), "evidence.matched", "evidence.complete"];
    const criticalFailed = critical.filter((n) => checks[n] === false);
    const gradeResult = grade({ checks, criticalChecks: criticalFailed, metrics });

    return {
      ...base(chain, task, elapsedMs, sessionKey, workspace),
      ...gradeResult,
      checks,
      criticalFailed,
      metrics: {
        elapsedMs,
        modelRounds: stats?.modelRounds ?? 0,
        totalCost: stats ? +stats.totalCost.toFixed(5) : 0,
        cacheHitRate: stats?.cacheHitRate ?? 0,
      },
      toolSequence: stats?.toolCalls ?? [],
      toolResults: (stats?.toolCalls ?? []).map((c) => ({
        name: c.name,
        ok: c.ok,
        isError: c.isError,
        preview: c.resultPreview,
      })),
      errors: stats?.errors ?? [],
      answerExcerpt: (stats?.answerText ?? "").slice(0, 500),
      transcriptPath,
      complete: stats?.complete ?? false,
      matched,
      fileSnapshots: { before: beforeFiles, after: afterFiles },
      message,
    };
  } catch (e) {
    return {
      ...base(chain, task, Date.now() - startedAt, sessionKey, workspace),
      checks: { crashed: false },
      errors: [{ tool: "runner", text: String(e).slice(0, 200) }],
      message,
    };
  } finally {
    client.close();
  }
}

function base(chain, task, elapsedMs, sessionKey, workspace) {
  return {
    id: `${chain.id}/${task.id}`,
    chain: chain.id,
    description: task.description ?? task.message.slice(0, 60),
    score: 0,
    grade: GRADES.F.label,
    startedAt: new Date().toISOString(),
    elapsedMs,
    sessionKey,
    workspace,
  };
}

function substitutePlaceholders(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

async function resolveTaskWorkspace(chain, task, { runId }) {
  const explicit = task.workspaceDir ?? chain.workspaceDir;
  if (explicit) return substitutePlaceholders(explicit, { runId });
  const fixtureDir = prepareFixture(chain, task, runId);
  if (fixtureDir) return fixtureDir;
  if (!existsSync(commonWorkspace)) {
    throw new Error(
      `audit workspace missing: ${commonWorkspace}. Set CHAIN_AUDIT_WORKSPACE or update matrix.common.workspace (fail closed).`,
    );
  }
  return commonWorkspace;
}

/** scratch-git fixture for destructive probes (never touches the real project). */
function prepareFixture(chain, task, runId) {
  const spec = task.fixture ?? chain.fixture;
  if (!spec) return null;
  if (spec.type === "scratch-git") {
    const dir = join(FIXTURE_ROOT, runId, `${chain.id}-${task.id}`);
    mkdirSync(dir, { recursive: true });
    for (const f of spec.files ?? []) {
      const fp = join(dir, f.path);
      mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, f.content ?? "", "utf8");
    }
    const run = (args) => spawnSync("git", args, { cwd: dir, windowsHide: true });
    run(["init", "-q"]);
    run(["add", "-A"]);
    run(["-c", "user.name=chain-audit", "-c", "user.email=chain-audit@local", "commit", "-q", "-m", "baseline"]);
    // Files created after the commit stay untracked, so `git clean -fd` removal is observable.
    for (const f of spec.untrackedAfter ?? []) {
      const fp = join(dir, f.path);
      mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, f.content ?? "", "utf8");
    }
    return dir;
  }
  throw new Error(`unknown fixture type '${spec.type}' on ${chain.id}/${task.id}`);
}

/**
 * jforum-style baseline handling: refuse to score a workspace that is already
 * diverged (fail closed) unless --restore-baseline was passed, in which case
 * current files are backed up first and then restored.
 */
async function prepareChain(chain, { runId }) {
  if (!chain.baseline) return null;
  const spec = chain.baseline;
  let baselineDir;
  if (spec.pointer) {
    const pointerPath = join(REPO_ROOT, spec.pointer);
    const ts = readFileSync(pointerPath, "utf8").trim();
    baselineDir = join(dirname(pointerPath), ts);
  } else {
    baselineDir = join(REPO_ROOT, spec.dir);
  }
  if (!existsSync(baselineDir)) throw new Error(`chain '${chain.id}' baseline missing: ${baselineDir}`);

  const workspace = commonWorkspace;
  const diverged = [];
  for (const rel of spec.files) {
    const target = join(workspace, spec.targetPrefix ? join(spec.targetPrefix, rel) : rel);
    const src = join(baselineDir, rel);
    if (!existsSync(target) || !existsSync(src) || hashFile(target) !== hashFile(src)) diverged.push(rel);
  }

  if (diverged.length === 0) return { restored: [] };

  const err = new Error(
    `chain '${chain.id}' workspace diverged from baseline: ${diverged.join(", ")}. ` +
    `Re-run with --restore-baseline to back up current files and restore the baseline.`,
  );
  err.name = "ChainBlockedError";
  if (!restoreBaseline) throw err;

  const backupDir = join(FIXTURE_ROOT, runId, `backups-${chain.id}`);
  mkdirSync(backupDir, { recursive: true });
  for (const rel of spec.files) {
    const target = join(workspace, spec.targetPrefix ? join(spec.targetPrefix, rel) : rel);
    const src = join(baselineDir, rel);
    if (existsSync(target)) copyFileSync(target, join(backupDir, rel.replace(/[\\/]/g, "_")));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(src, target);
  }
  console.log(`  backed up and restored ${diverged.length} baseline files -> ${backupDir}`);
  return { restored: diverged, backupDir };
}

function hashFile(p) {
  try {
    return fnv1a(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

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

/**
 * Wait for this task's transcript to appear, stop growing, and end with an
 * assistant message. Only files created after the snapshot are considered and
 * the file must contain this task's user message -- no silent fallback to a
 * concurrent session's transcript.
 */
async function waitForSessionComplete(sessionKey, timeoutMs, message, snapshot, sessionDir) {
  const deadline = Date.now() + timeoutMs;
  const dir = sessionDir ?? join(homedir(), ".openclaw", "agents", "main", "sessions");
  const isTranscript = (f) => f.endsWith(".jsonl") && !f.includes("trajectory");
  const knownFiles = snapshot ?? new Set(existsSync(dir) ? readdirSync(dir).filter(isTranscript) : []);
  const needle = String(message ?? "").trim();
  let lastSize = -1;
  let stableSince = 0;
  let current = null;

  while (Date.now() < deadline) {
    const files = existsSync(dir) ? readdirSync(dir).filter(isTranscript) : [];
    const candidates = files.filter((f) => !knownFiles.has(f));
    if (candidates.length > 0) {
      const sorted = candidates
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      const match = needle
        ? sorted.find((p) => firstUserMessageText(p).includes(needle.slice(0, 40)))
        : undefined;
      const target = match ?? (needle ? null : sorted[0]);
      if (target) {
        const size = readFileSync(target, "utf8").length;
        if (size > 0) {
          if (size === lastSize && current === target) {
            if (stableSince === 0) stableSince = Date.now();
            if (Date.now() - stableSince > 5000 && transcriptEndsWithAssistant(target)) return target;
          } else {
            lastSize = size;
            current = target;
            stableSince = Date.now();
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Timeout: fail closed -- only return a transcript that provably belongs to this task.
  const files = existsSync(dir) ? readdirSync(dir).filter(isTranscript) : [];
  const candidates = files.filter((f) => !knownFiles.has(f));
  if (candidates.length === 0 || !needle) return null;
  const sorted = candidates.map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return sorted.find((p) => firstUserMessageText(p).includes(needle.slice(0, 40))) ?? null;
}

function transcriptEndsWithAssistant(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    return last.type === "message" && last.message?.role === "assistant";
  } catch {
    return false;
  }
}

// ---- RPC direct probes -------------------------------------------------------
async function runRpcChecks({ port, token, allowMutations }) {
  const client = new RpcClient({ port, token });
  const adminClients = new Map();
  const results = [];
  try {
    await client.connect();
    const getScopedClient = async (scopes) => {
      const key = JSON.stringify(scopes);
      if (!adminClients.has(key)) {
        const c = new RpcClient({ port, token, scopes });
        await c.connect();
        adminClients.set(key, c);
      }
      return adminClients.get(key);
    };

    for (const group of rpcConfig.groups) {
      const entries = [];
      for (const c of group.checks ?? []) entries.push({ mode: "normal", ...c });
      for (const c of group.adminOnly ?? []) entries.push({ mode: "deny", ...c });
      for (const c of group.adminOk ?? []) entries.push({ mode: "allow", ...c });

      const checkResults = [];
      for (const c of entries) {
        if ((c.mutating || group.mutating) && !allowMutations) {
          checkResults.push({
            method: c.method, mode: c.mode, skipped: true, passed: false, ok: null,
            note: "mutating probe skipped (use --allow-mutations)",
          });
          continue;
        }
        let scopedClient = client;
        try {
          if (c.mode === "allow") scopedClient = await getScopedClient(c.scopes ?? ["operator.admin"]);
        } catch (e) {
          checkResults.push({ method: c.method, mode: c.mode, ok: false, passed: false, skipped: false, error: `scope client failed: ${String(e).slice(0, 80)}` });
          continue;
        }
        const timeout = c.timeoutMs ?? 20_000;
        let res = await scopedClient.call(c.method, c.params, timeout);
        if (!res.ok && /^timeout after/.test(res.error?.message ?? "")) {
          res = await scopedClient.call(c.method, c.params, timeout); // one retry for cold-start
        }
        const errorText = res.error?.message ?? "";
        const expectErr = typeof c.expectError === "string" && c.expectError.length > 0;
        let ok = false;
        let note;
        if (expectErr) {
          if (res.ok) {
            ok = false;
            note = `expected error '${c.expectError}' but call succeeded (error path no longer exercised)`;
          } else {
            ok = new RegExp(c.expectError, "i").test(errorText);
          }
        } else if (c.mode === "deny") {
          if (res.ok) {
            ok = false;
            note = "security gate missing: call succeeded without the required scope";
          } else {
            ok = /missing scope/i.test(errorText);
            if (!ok) note = `unexpected error for gated method: ${errorText.slice(0, 80)}`;
          }
        } else {
          ok = res.ok;
          if (!ok && /missing scope/i.test(errorText)) note = "unexpected scope denial";
        }
        if (ok && c.expect && !payloadMatches(res.payload, c.expect)) {
          ok = false;
          note = "payload assertion failed";
        }
        checkResults.push({
          method: c.method,
          mode: c.mode,
          ok,
          passed: ok,
          skipped: false,
          adminGated: c.mode === "deny",
          expectErrorMatched: expectErr && !res.ok && ok,
          elapsedMs: res.elapsedMs,
          error: res.ok ? note : (errorText || note || "").slice(0, 120),
          payloadKeys: res.ok && res.payload && typeof res.payload === "object" ? Object.keys(res.payload).slice(0, 10) : undefined,
        });
      }

      const executed = checkResults.filter((r) => !r.skipped);
      const passed = executed.filter((r) => r.passed).length;
      const total = executed.length;
      const allSkipped = total === 0;
      const criticalFailed = group.critical === true && executed.some((r) => !r.passed);
      const failedKeys = executed
        .map((r, i) => ({ r, key: `${r.method}#${i}` }))
        .filter((x) => !x.r.passed)
        .map((x) => x.key);
      const g = grade({
        checks: Object.fromEntries(executed.map((r, i) => [`${r.method}#${i}`, r.passed])),
        criticalChecks: criticalFailed ? failedKeys : [],
        metrics: {},
      });
      const score = allSkipped ? null : criticalFailed ? Math.min(Math.round((passed / total) * 100), 39) : Math.round((passed / total) * 100);
      results.push({
        id: group.id,
        name: group.name,
        grade: allSkipped ? "skipped" : g.grade,
        score,
        passed,
        total,
        skipped: checkResults.length - total,
        criticalFailed,
        checks: checkResults,
      });
      console.log(`  [${group.id}] ${allSkipped ? "skipped" : g.grade} (${passed}/${total})${group.critical && criticalFailed ? " CRITICAL" : ""}`);
      for (const c of executed.filter((r) => !r.passed)) {
        console.log(`    X ${c.method} [${c.mode}]: ${c.error ?? c.note ?? ""}`);
      }
    }
  } finally {
    client.close();
    for (const c of adminClients.values()) c.close();
  }
  return results;
}

function payloadMatches(payload, expect) {
  for (const [key, expected] of Object.entries(expect)) {
    const actual = getPath(payload, key);
    if (expected === "array") {
      if (!Array.isArray(actual)) return false;
    } else if (expected === "object") {
      if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    } else if (expected === "nonEmpty") {
      if (actual === null || actual === undefined || actual === "") return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function getPath(obj, dotted) {
  return dotted.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/** RPC aggregate: average group scores; any critical group failure -> F. */
function aggregateRpc(groups) {
  const scored = groups.filter((g) => g.score !== null);
  const avg = scored.length
    ? Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length)
    : null;
  const criticalFailed = groups.some((g) => g.criticalFailed);
  const grade = avg === null
    ? "no checks"
    : criticalFailed
      ? GRADES.F.label
      : (Object.values(GRADES).find((g) => avg >= g.min) ?? GRADES.F).label;
  return {
    grade,
    score: avg === null ? null : criticalFailed ? Math.min(avg, 39) : avg,
    passed: scored.filter((g) => g.score >= 75).length,
    total: groups.length,
    skippedGroups: groups.filter((g) => g.score === null).length,
    skippedChecks: groups.reduce((a, g) => a + (g.skipped ?? 0), 0),
    criticalFailed,
  };
}

// ---- verdict / exit codes ---------------------------------------------------
function computeVerdict({ aggregate, rpcAggregate, agentTaskCount, rpcOnly }) {
  const reasons = [];
  let exitCode = 0;
  const agentScore = aggregate.score ?? null;
  const rpcScore = rpcAggregate.score ?? null;

  const agentCriticalCount = aggregate.breakdown.reduce((a, b) => a + (b.criticalFailed ?? 0), 0);
  const agentCritical = agentCriticalCount > 0;

  if (rpcOnly) {
    if (rpcScore === null) { reasons.push("rpc: no executable checks"); exitCode = 5; }
  } else if (agentTaskCount === 0) {
    reasons.push("agent: no matching chains (chain filter had no hits)");
    exitCode = 6;
  }

  const agentThreshold = failOnScore ?? (ci ? 75 : null);
  const rpcThreshold = failOnRpcScore ?? (ci ? 75 : null);
  if (agentThreshold !== null && agentScore !== null && agentScore < agentThreshold) {
    reasons.push(`agent score ${agentScore} < ${agentThreshold}`);
    exitCode = Math.max(exitCode, 2);
  }
  if (rpcThreshold !== null && rpcScore !== null && rpcScore < rpcThreshold) {
    reasons.push(`rpc score ${rpcScore} < ${rpcThreshold}`);
    exitCode = Math.max(exitCode, 3);
  }
  if (ci && rpcAggregate.passed + (rpcAggregate.skippedGroups ?? 0) < rpcAggregate.total) {
    reasons.push(`rpc groups failed: ${rpcAggregate.passed}/${rpcAggregate.total - (rpcAggregate.skippedGroups ?? 0)}`);
    exitCode = Math.max(exitCode, 3);
  }
  if (ci && (agentCritical || rpcAggregate.criticalFailed)) {
    reasons.push("critical checks failed");
    exitCode = Math.max(exitCode, 4);
  }
  return {
    ok: exitCode === 0,
    exitCode,
    reasons,
    agentCritical,
    agentCriticalCount,
    agentScore,
    rpcScore,
  };
}

// ---- history ------------------------------------------------------------------
function appendHistory({ environment, aggregate, rpcAggregate, results, rpcResults, verdict }) {
  const historyPath = join(EVIDENCE_ROOT, "history.json");
  let history = { runs: [], recentScores: [] };
  try { history = JSON.parse(readFileSync(historyPath, "utf8")); } catch { /* first run */ }
  history.runs.push({
    ts: new Date().toISOString(),
    head: environment.head,
    matrixDigest: environment.matrixDigest,
    rpcDigest: environment.rpcDigest,
    agentScore: aggregate.score,
    agentGrade: aggregate.grade,
    rpcScore: rpcAggregate.score,
    rpcGrade: rpcAggregate.grade,
    verdict: verdict.ok ? "PASS" : "FAIL",
    exitCode: verdict.exitCode,
    taskResults: results.map((r) => ({ id: r.id, score: r.score, grade: r.grade })),
    rpcGroups: rpcResults.map((r) => ({ id: r.id, score: r.score, skipped: r.skipped })),
  });
  if (history.runs.length > 50) history.runs = history.runs.slice(-50);
  history.recentScores = history.runs.slice(-5).map((r) => `${r.agentScore ?? "-"}/${r.rpcScore ?? "-"}`);
  try { writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8"); } catch { /* read-only */ }
}

main().catch((e) => {
  console.error("Chain Audit failed:", e);
  process.exit(1);
});
