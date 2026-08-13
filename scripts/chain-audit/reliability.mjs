#!/usr/bin/env node
/**
 * chain-audit cross-run reliability report.
 * Reads artifacts/chain-audit/evidence/history.json and summarizes per-task
 * score spread / pass-rate / stability over the last N runs, so a single green
 * run can never masquerade as stable acceptance.
 *
 * Usage: node scripts/chain-audit/reliability.mjs [--runs N] [--ci]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HISTORY = join(ROOT, "artifacts/chain-audit/evidence/history.json");
const OUT_ROOT = join(ROOT, "artifacts/chain-audit/reliability");

const args = process.argv.slice(2);
const ci = args.includes("--ci");
const runsFlag = args.indexOf("--runs");
const N = runsFlag >= 0 ? Math.max(1, Number(args[runsFlag + 1]) || 5) : 5;

const history = JSON.parse(readFileSync(HISTORY, "utf8"));
const runs = (history.runs ?? []).slice(-N);
if (!runs.length) {
  console.error("no runs in history.json");
  process.exit(1);
}

function summarize(key, getScore) {
  const byKey = new Map();
  for (const r of runs) {
    for (const item of r[key] ?? []) {
      const score = getScore(item);
      if (score === null || score === undefined) continue;
      const id = item.id ?? "?";
      if (!byKey.has(id)) byKey.set(id, []);
      byKey.get(id).push(score);
    }
  }
  const out = [];
  for (const [id, vals] of byKey) {
    const mean = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const passRate = vals.filter((v) => v >= 75).length / vals.length;
    out.push({
      id,
      samples: vals.length,
      mean,
      min,
      max,
      spread: max - min,
      passRate: Math.round(passRate * 100),
      stable: min === max,
    });
  }
  out.sort((a, b) => b.spread - a.spread || a.id.localeCompare(b.id));
  return out;
}

const tasks = summarize("taskResults", (i) => i.score);
const rpc = summarize("rpcGroups", (i) => i.score);

const stableTasks = tasks.filter((t) => t.stable).length;
const volatileTasks = tasks.filter((t) => !t.stable).length;
const lowReliability = tasks.filter((t) => t.passRate > 0 && t.passRate < 100);

const report = {
  ts: new Date().toISOString(),
  runsAnalyzed: runs.length,
  firstRun: runs[0].ts,
  lastRun: runs[runs.length - 1].ts,
  tasks: { total: tasks.length, stable: stableTasks, volatile: volatileTasks, rows: tasks },
  rpc: { rows: rpc },
};

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(OUT_ROOT, ts);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");

const lines = [];
lines.push(`# Chain Audit reliability (${runs.length} runs)`);
lines.push("");
lines.push(`- window: ${runs[0].ts} .. ${runs[runs.length - 1].ts}`);
lines.push(`- tasks: ${tasks.length} total | stable ${stableTasks} | volatile ${volatileTasks}`);
lines.push("");
lines.push(`## Most volatile tasks`);
lines.push("");
lines.push(`| task | n | mean | min | max | pass% |`);
lines.push(`|---|---|---|---|---|---|`);
for (const t of tasks.slice(0, 20)) {
  lines.push(`| ${t.id} | ${t.samples} | ${t.mean} | ${t.min} | ${t.max} | ${t.passRate} |`);
}
lines.push("");
lines.push(`## RPC groups`);
lines.push("");
lines.push(`| group | n | mean | min | max | pass% |`);
lines.push(`|---|---|---|---|---|---|`);
for (const r of rpc) {
  lines.push(`| ${r.id} | ${r.samples} | ${r.mean} | ${r.min} | ${r.max} | ${r.passRate} |`);
}
writeFileSync(join(outDir, "report.md"), lines.join("\n"), "utf8");

console.log(`reliability over ${runs.length} runs: tasks ${tasks.length} (stable ${stableTasks}, volatile ${volatileTasks})`);
for (const t of tasks.slice(0, 8)) {
  console.log(`  ${t.id.padEnd(36)} mean=${t.mean} spread=${t.spread} pass=${t.passRate}% (n=${t.samples})`);
}
console.log(`report: ${outDir}`);

const unstableBlockers = lowReliability.length;
if (ci && unstableBlockers > 0) {
  console.error(`CI reliability gate: ${unstableBlockers} tasks are not 0%/100% pass over ${runs.length} runs.`);
  process.exitCode = 7;
}
