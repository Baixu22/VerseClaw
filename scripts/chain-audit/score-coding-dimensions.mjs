#!/usr/bin/env node
/**
 * Coding 能力 7 维打分器 — 基于 chain-audit jforum-fix 链路证据，纯事后分析。
 * 对 report.json 的每个修复任务，从 metrics + toolSequence + transcript 提取信号，
 * 计算 7 个能力维度分（0-100），输出短板排名与综合 coding index。
 *
 * 维度：
 *   D1 定位能力 locate       — 读目标文件/先搜索/到达首编辑步数
 *   D2 修复正确性 correctness — 基线 diff + 正/负形态验证
 *   D3 自检纪律 verify      — 编辑后是否针对性 grep 确认
 *   D4 跨层推理 crossLayer  — 是否读取了目标文件之外的相关层（service/repository）
 *   D5 效率 efficiency      — modelRounds / cost / 冗余工具调用 / 循环
 *   D6 上下文利用 context   — cacheHitRate ± 精确 offset 读 / 重复抓取惩罚
 *   D7 工具适配 toolFit     — 是否用 edit 精准改、失败工具调用惩罚
 *
 * 用法：
 *   node scripts/chain-audit/score-coding-dimensions.mjs [--report <report.json>] [--baseline <dir>]
 * 默认取最新 evidence 报告 + jforum-baseline/.latest-ts。
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_ROOT = resolve(__dirname);
const EVIDENCE_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/evidence");
const BASELINE_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/jforum-baseline");
const OUT_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/coding-score");
const JFORUM = "C:/Users/27933/Desktop/shit/JForum-master";

const SPECS = [
  { id: "fix-download-path", file: "src/main/java/net/jforum/controllers/TopicController.java", crossLayerNeeded: true,
    positive: [/return\s+new\s+File\(downloadPath/], negative: [/return\s+new\s+File\(attachment\.getRealFilename\(\)\)/] },
  { id: "fix-hql-typo", file: "src/main/java/net/jforum/repository/ForumRepository.java", crossLayerNeeded: false,
    positive: [/from\s+Forum\s+as\s+forum"/], negative: [/from\s+Forum\s+as\s+forum\)"/] },
  { id: "fix-watch-npe", file: "src/main/java/net/jforum/actions/extensions/TopicWatchExtension.java", crossLayerNeeded: true,
    positive: [/(?:subscription\s*!=\s*null|isWatching)\s*&&\s*!subscription\.isRead/], negative: [/if\s*\(\s*!subscription\.isRead\(\)\s*\)/] },
  { id: "fix-password-plaintext", file: "src/main/java/net/jforum/controllers/UserController.java", crossLayerNeeded: true,
    positive: [/MD5\.hash\(newPassword\)/], negative: [/setPassword\(newPassword\)/] },
  { id: "fix-precedence", file: "src/main/java/net/jforum/controllers/UserController.java", crossLayerNeeded: false,
    positive: [/!error\s*&&\s*\(/], negative: [/!error\s*&&\s*user\.getUsername\(\)\.indexOf\('<'\s*\)\s*>\s*-1\s*\|\|/] },
  { id: "fix-empty-catch", file: "src/main/java/net/jforum/util/JForumConfig.java", crossLayerNeeded: false,
    positive: [/catch\s*\(Exception\s+e\)\s*\{\s*\r?\n[^}]*logger\.error/], negative: [/catch\s*\(Exception\s+e\)\s*\{\s*\}/] },
];

function loadText(p) { try { return existsSync(p) ? readFileSync(p, "utf8") : null; } catch { return null; } }

function latestEvidenceDir() {
  return readdirSync(EVIDENCE_ROOT).filter((d) => /^\d{4}/.test(d))
    .sort((a, b) => statSync(join(EVIDENCE_ROOT, b)).mtimeMs - statSync(join(EVIDENCE_ROOT, a)).mtimeMs)[0];
}

function defaultBaseline() {
  try { const ts = readFileSync(join(BASELINE_ROOT, ".latest-ts"), "utf8").trim(); return existsSync(join(BASELINE_ROOT, ts)) ? join(BASELINE_ROOT, ts) : null; } catch { return null; }
}

function extractToolSequence(transcriptPath) {
  const raw = loadText(transcriptPath);
  if (!raw) return [];
  const seq = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== "message" || r.message?.role !== "assistant") continue;
    for (const c of r.message.content || []) {
      if (c.type !== "toolCall" || !c.name) continue;
      let args = "";
      try { args = JSON.stringify(c.arguments ?? {}).slice(0, 200); } catch { args = ""; }
      seq.push({ name: c.name, args });
    }
  }
  return seq;
}

function firstEditIndex(seq) { return seq.findIndex((t) => t.name === "edit"); }

// ── 7 维打分 ─────────────────────────────────────────────
function scoreLocate(seq, spec) {
  const names = seq.map((t) => t.name);
  const readTarget = names.includes("read") || names.includes("ls");
  const searchBefore = (() => {
    const editIdx = firstEditIndex(seq);
    if (editIdx === -1) return false;
    return seq.slice(0, editIdx).some((t) => t.name === "exec" || t.name === "grep" || t.name === "ls");
  })();
  const steps = firstEditIndex(seq) === -1 ? 99 : firstEditIndex(seq) + 1;
  const speed = Math.max(0, 100 - Math.max(0, steps - 1) * 20); // steps1=100, 6步=0
  return Math.round(50 * (readTarget ? 1 : 0) + 30 * (searchBefore ? 1 : 0) + 20 * (speed / 100));
}

function scoreCorrectness(baselineText, currentText, spec) {
  const changed = currentText !== null && baselineText !== null && currentText !== baselineText;
  if (!changed) return 0;
  const pos = spec.positive.every((re) => re.test(currentText));
  const neg = spec.negative.every((re) => !re.test(currentText));
  return pos && neg ? 100 : 60;
}

function scoreVerify(seq, spec) {
  const editIdx = firstEditIndex(seq);
  if (editIdx === -1) return 0;
  const after = seq.slice(editIdx + 1);
  const targetGrep = after.some((t) =>
    t.name === "exec" && spec.positive.some((re) => re.source.length > 0) && /grep/.test(t.args),
  );
  const anyExec = after.some((t) => t.name === "exec");
  return targetGrep ? 100 : anyExec ? 60 : 0;
}

function scoreCrossLayer(seq, spec) {
  const targetDir = spec.file.split("/").slice(0, -1).join("/").replace(/^src[\\/]main[\\/]java[\\/]net[\\/]jforum[\\/]/, "");
  const reads = seq.filter((t) => t.name === "read").map((t) => t.args);
  const other = reads.filter((a) => !a.includes(spec.file.split("/").pop()));
  if (other.length > 0) return 100;            // 主动读了其他层文件
  const lsGrepOther = seq.some((t) => t.name === "ls" || (t.name === "exec" && /services|repository/.test(t.args)));
  return lsGrepOther ? 60 : 0;                  // 只列出/搜索了其他层
}

function scoreEfficiency(task, seq) {
  const rounds = task.metrics?.modelRounds ?? 0;
  const cost = task.metrics?.totalCost ?? 0;
  const names = seq.map((t) => t.name);
  let maxStreak = 1, s = 1;
  for (let i = 1; i < names.length; i++) { s = names[i] === names[i - 1] ? s + 1 : 1; maxStreak = Math.max(maxStreak, s); }
  const loop = maxStreak >= 3;
  // 冗余：重复的 git add/commit、高度重叠的 grep
  let redundant = 0;
  const execs = seq.filter((t) => t.name === "exec").map((t) => t.args);
  const gitCount = execs.filter((a) => /git (add|commit)/.test(a)).length;
  if (gitCount >= 2) redundant += Math.min(gitCount - 1, 2);
  const greps = execs.filter((a) => /grep/.test(a)).map((a) => a.replace(/\d+/g, ""));
  for (let i = 0; i < greps.length; i++) for (let j = i + 1; j < greps.length; j++) if (greps[i] === greps[j]) redundant++;
  let score = 100;
  if (loop) score -= 10;
  score -= Math.max(0, rounds - 4) * 5;
  score -= redundant * 6;
  score -= (cost / 0.01) * 8;
  return Math.max(0, Math.round(score));
}

function scoreContext(task, seq) {
  const cache = task.metrics?.cacheHitRate ?? 0;
  let adj = 0;
  const readArgs = seq.filter((t) => t.name === "read").map((t) => t.args);
  if (readArgs.some((a) => /offset/.test(a) || /limit/.test(a))) adj += 2;  // 精确 offset 读=复用上下文
  const execs = seq.filter((t) => t.name === "exec").map((t) => t.args);
  const reGrep = execs.filter((a) => /import|\.java/.test(a) && /grep/.test(a)).length;
  if (reGrep > 1) adj -= 2;  // 重复 grep 已读内容
  return Math.max(0, Math.min(100, Math.round(cache + adj)));
}

function scoreToolFit(seq) {
  let score = 100;
  const names = seq.map((t) => t.name);
  if (names.includes("write") || names.includes("apply_patch")) score -= 10; // 小修复用 edit 更精准
  if (seq.some((t) => /Tool .* not found|not found/.test(t.args))) score -= 10; // 失败工具调用
  return Math.max(0, score);
}

// ── 主流程 ───────────────────────────────────────────────
const args = process.argv.slice(2);
const reportIdx = args.indexOf("--report");
const baselineIdx = args.indexOf("--baseline");
const report = reportIdx >= 0
  ? JSON.parse(readFileSync(args[reportIdx + 1], "utf8"))
  : JSON.parse(readFileSync(join(EVIDENCE_ROOT, latestEvidenceDir(), "report.json"), "utf8"));
const baselineDir = baselineIdx >= 0 ? args[baselineIdx + 1] : defaultBaseline();
if (!baselineDir) { console.error("❌ 无基线目录"); process.exit(1); }

const tasks = report.tasks.filter((t) => t.chain === "jforum-fix" || t.id?.startsWith("jforum-fix/"));
if (!tasks.length) { console.error("❌ 报告无 jforum-fix 任务"); process.exit(1); }

const DIMENSIONS = ["locate", "correctness", "verify", "crossLayer", "efficiency", "context", "toolFit"];
const rows = [];

for (const spec of SPECS) {
  const task = tasks.find((t) => t.id === spec.id || t.id?.endsWith(`/${spec.id}`));
  if (!task) continue;
  const seq = extractToolSequence(task.transcriptPath);
  const baselineText = loadText(join(baselineDir, spec.file.replace(/^src[\\/]main[\\/]java[\\/]net[\\/]jforum[\\/]/, "")));
  const currentText = loadText(join(JFORUM, spec.file));
  const scores = {
    locate: scoreLocate(seq, spec),
    correctness: scoreCorrectness(baselineText, currentText, spec),
    verify: scoreVerify(seq, spec),
    crossLayer: scoreCrossLayer(seq, spec),
    efficiency: scoreEfficiency(task, seq),
    context: scoreContext(task, seq),
    toolFit: scoreToolFit(seq),
  };
  rows.push({ id: spec.id, task, seq, scores, crossLayerNeeded: spec.crossLayerNeeded });
  console.log(`== ${spec.id}`);
  for (const d of DIMENSIONS) console.log(`   ${d.padEnd(12)}: ${scores[d]}`);
}

// 汇总
const dimAvgs = {};
for (const d of DIMENSIONS) {
  dimAvgs[d] = Math.round(rows.reduce((a, r) => a + r.scores[d], 0) / rows.length);
}
const rawIndex = Math.round(DIMENSIONS.reduce((a, d) => a + dimAvgs[d], 0) / DIMENSIONS.length);
// 调整：跨层只在需要跨层的任务上计
const applicableCross = rows.filter((r) => r.crossLayerNeeded).map((r) => r.scores.crossLayer);
const adjCross = applicableCross.length ? Math.round(applicableCross.reduce((a, b) => a + b, 0) / applicableCross.length) : dimAvgs.crossLayer;
const others = ["locate", "correctness", "verify", "efficiency", "context", "toolFit"];
const adjIndex = Math.round((others.reduce((a, d) => a + dimAvgs[d], 0) + adjCross) / 7);

const ranked = Object.entries(dimAvgs).sort((a, b) => a[1] - b[1]);
console.log(`\n=== 维度平均 ===`);
for (const [d, v] of ranked) console.log(`   ${d.padEnd(12)}: ${v}`);
console.log(`\nCoding index: raw=${rawIndex} adjusted(跨层仅按需)=${adjIndex}`);
console.log(`短板: ${ranked.slice(0, 2).map(([d, v]) => `${d}(${v})`).join(", ")}`);

// 写报告
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(OUT_ROOT, ts);
mkdirSync(outDir, { recursive: true });
const lines = [];
lines.push(`# Coding 能力 7 维打分（jforum-fix 链路）`);
lines.push(``);
lines.push(`- 报告: ${report.timestamp}`);
lines.push(`- 基线: ${baselineDir}`);
lines.push(``);
lines.push(`| 任务 | 定位 | 正确性 | 自检 | 跨层 | 效率 | 上下文 | 工具适配 | task分 |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  lines.push(`| ${r.id} | ${r.scores.locate} | ${r.scores.correctness} | ${r.scores.verify} | ${r.scores.crossLayer} | ${r.scores.efficiency} | ${r.scores.context} | ${r.scores.toolFit} | ${r.task.score} |`);
}
lines.push(``);
lines.push(`| **平均** | **${dimAvgs.locate}** | **${dimAvgs.correctness}** | **${dimAvgs.verify}** | **${dimAvgs.crossLayer}** | **${dimAvgs.efficiency}** | **${dimAvgs.context}** | **${dimAvgs.toolFit}** | |`);
lines.push(``);
lines.push(`## 维度短板排名`);
lines.push(``);
for (const [d, v] of ranked) lines.push(`${d.padEnd(12)} ${v}`);
lines.push(``);
lines.push(`## 综合`);
lines.push(``);
lines.push(`- Coding index: **${rawIndex}**（等权原始）/ **${adjIndex}**（跨层仅按需计）`);
lines.push(`- 注意：cacheHitRate 在 97-99% 区间导致 context 维度无区分度（测量天花板）；正确性/自检由提示词强制 grep 确认，偏高。`);
const mdPath = join(outDir, "report.md");
writeFileSync(mdPath, lines.join("\n"), "utf8");
writeFileSync(join(outDir, "report.json"), JSON.stringify({ ts, reportTimestamp: report.timestamp, baseline: baselineDir, dimAvgs, rawIndex, adjIndex, ranked, rows: rows.map((r) => ({ id: r.id, scores: r.scores })) }, null, 2), "utf8");
console.log(`\n报告: ${mdPath}`);
