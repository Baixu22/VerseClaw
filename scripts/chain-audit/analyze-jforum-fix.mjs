#!/usr/bin/env node
/**
 * JForum 真实修复链路分析器 — 读 chain-audit 证据，输出：
 *   1. 处理思路质量：短路检测（直接答未动手）/ 循环检测 / 工具适配
 *   2. 修复正确性：目标文件 diff + 预期形态 grep 验证（对基线）
 * 纯只读分析，不改任何框架/配置/源码。
 *
 * 用法：
 *   node scripts/chain-audit/analyze-jforum-fix.mjs [--report <report.json>] [--baseline <dir>]
 * 默认取最新 evidence 目录的最新报告 + jforum-baseline/.latest-ts 基线。
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_ROOT = resolve(__dirname);
const EVIDENCE_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/evidence");
const BASELINE_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/jforum-baseline");
const ACCEPT_ROOT = resolve(AUDIT_ROOT, "../../artifacts/chain-audit/jforum-acceptance");
const JFORUM = "C:/Users/27933/Desktop/shit/JForum-master";

// ── 6 个修复 bug 的验证规格 ──────────────────────────────
const SPECS = [
  {
    id: "fix-download-path",
    name: "附件下载返回错误文件路径",
    file: "src/main/java/net/jforum/controllers/TopicController.java",
    positive: [/return\s+new\s+File\(downloadPath/],
    negative: [/return\s+new\s+File\(attachment\.getRealFilename\(\)\)/],
    hint: "downloadAttachment 应返回 buildDownloadPath 计算出的存储路径",
  },
  {
    id: "fix-hql-typo",
    name: "ForumRepository.findAll() HQL 多余右括号",
    file: "src/main/java/net/jforum/repository/ForumRepository.java",
    positive: [/from\s+Forum\s+as\s+forum"/],
    negative: [/from\s+Forum\s+as\s+forum\)"/],
    hint: "HQL 语句末尾不应有孤儿右括号",
  },
  {
    id: "fix-watch-npe",
    name: "TopicWatchExtension.afterList 空指针",
    file: "src/main/java/net/jforum/actions/extensions/TopicWatchExtension.java",
    positive: [/(?:subscription\s*!=\s*null|isWatching)\s*&&\s*!subscription\.isRead/],
    negative: [/if\s*\(\s*!subscription\.isRead\(\)\s*\)/],
    hint: "未订阅用户 getSubscription 返回 null，isRead 前须判空",
  },
  {
    id: "fix-password-plaintext",
    name: "密码重置明文入库",
    file: "src/main/java/net/jforum/controllers/UserController.java",
    positive: [/MD5\.hash\(newPassword\)/],
    negative: [/setPassword\(newPassword\)/],
    hint: "重置密码应与 UserService.add/validateLogin 一致做 MD5.hash",
  },
  {
    id: "fix-precedence",
    name: "用户名非法字符校验优先级错误",
    file: "src/main/java/net/jforum/controllers/UserController.java",
    positive: [/!error\s*&&\s*\(/],
    negative: [/!error\s*&&\s*user\.getUsername\(\)\.indexOf\('<'\s*\)\s*>\s*-1\s*\|\|/],
    hint: "< > 两字符校验应整体用括号包裹，避免 || 提前短路",
  },
  {
    id: "fix-empty-catch",
    name: "JForumConfig 空 catch 吞异常",
    file: "src/main/java/net/jforum/util/JForumConfig.java",
    positive: [/catch\s*\(Exception\s+e\)\s*\{\s*\r?\n[^}]*logger\.error/],
    negative: [/catch\s*\(Exception\s+e\)\s*\{\s*\}/],
    hint: "session.close() 的 catch 应记日志而非空吞",
  },
];

// ── 工具辅助 ─────────────────────────────────────────────
function latestEvidenceDir() {
  const dirs = readdirSync(EVIDENCE_ROOT).filter((d) => /^\d{4}/.test(d));
  return dirs.sort((a, b) => statSync(join(EVIDENCE_ROOT, b)).mtimeMs - statSync(join(EVIDENCE_ROOT, a)).mtimeMs)[0];
}

function defaultBaselineDir() {
  try {
    const ts = readFileSync(join(BASELINE_ROOT, ".latest-ts"), "utf8").trim();
    const p = join(BASELINE_ROOT, ts);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function readLatestReport() {
  const dir = join(EVIDENCE_ROOT, latestEvidenceDir());
  const reportPath = join(dir, "report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  return { report, reportPath, dir };
}

function loadText(absPath) {
  try {
    return existsSync(absPath) ? readFileSync(absPath, "utf8") : null;
  } catch {
    return null;
  }
}

/** 从 transcript 提取完整工具调用序列（name + 参数概要）。 */
function extractToolSequence(transcriptPath) {
  const raw = loadText(transcriptPath);
  if (!raw) return [];
  const seq = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== "message" || r.message?.role !== "assistant") continue;
    for (const c of r.message.content || []) {
      if (c.type !== "toolCall" || !c.name) continue;
      let args = "";
      try { args = JSON.stringify(c.arguments ?? {}).slice(0, 120); } catch { args = ""; }
      seq.push({ name: c.name, args });
    }
  }
  return seq;
}

// ── 诊断 ─────────────────────────────────────────────────
function detectShortCircuit(task, seq) {
  const rounds = task.metrics?.modelRounds ?? 0;
  const hasAnswer = task.checks?.hasAnswer === true;
  const usedTools = new Set(seq.map((t) => t.name));
  const missingExpected = (task.checks ? Object.keys(task.checks) : [])
    .filter((k) => k.startsWith("tools.") && task.checks[k] === false)
    .map((k) => k.slice("tools.".length));
  const answeredWithoutTools = hasAnswer && seq.length === 0;
  const oneRoundNoWork = rounds <= 1 && seq.length === 0;
  return {
    isShortCircuit: oneRoundNoWork || (hasAnswer && missingExpected.length > 0 && seq.length <= 1),
    answeredWithoutTools,
    rounds,
    missingExpected,
  };
}

function detectLoop(seq) {
  const names = seq.map((t) => t.name);
  const counts = {};
  for (const n of names) counts[n] = (counts[n] ?? 0) + 1;
  // 同工具连续 3+ 次，或两个工具交替 6+ 次
  let maxStreak = 1;
  let streak = 1;
  for (let i = 1; i < names.length; i++) {
    streak = names[i] === names[i - 1] ? streak + 1 : 1;
    maxStreak = Math.max(maxStreak, streak);
  }
  const top2 = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const altPair = top2.length >= 2 && top2[0][1] + top2[1][1] >= 6 && names.length >= 6;
  return {
    isLoop: maxStreak >= 3 || altPair,
    maxStreak,
    counts,
  };
}

// ── 主流程 ───────────────────────────────────────────────
const args = process.argv.slice(2);
const reportFlag = args.indexOf("--report");
const baselineFlag = args.indexOf("--baseline");

const { report } = reportFlag >= 0
  ? { report: JSON.parse(readFileSync(args[reportFlag + 1], "utf8")) }
  : readLatestReport();
const baselineDir = baselineFlag >= 0 ? args[baselineFlag + 1] : defaultBaselineDir();
if (!baselineDir) {
  console.error("❌ 未找到基线目录（artifacts/chain-audit/jforum-baseline/.latest-ts）");
  process.exit(1);
}

const jforumTasks = report.tasks.filter((t) => t.chain === "jforum-fix" || t.id?.startsWith("jforum-fix/"));
if (jforumTasks.length === 0) {
  console.error(`❌ report.json 中无 jforum-fix 任务（总任务 ${report.tasks.length}）。检查是否跑了 --chain jforum-fix`);
  process.exit(1);
}

const lines = [];
lines.push(`# JForum 真实修复验收分析`);
lines.push(``);
lines.push(`- 报告: ${report.timestamp}（evidence/${latestEvidenceDir()}）`);
lines.push(`- 基线: ${baselineDir}`);
lines.push(`- 载体: ${JFORUM}`);
lines.push(`- 任务数: ${jforumTasks.length}`);
lines.push(``);

const rows = [];
for (const spec of SPECS) {
  const task = jforumTasks.find((t) => t.id === spec.id || t.id?.endsWith(`/${spec.id}`));
  if (!task) {
    rows.push({ id: spec.id, name: spec.name, task: null, seq: [] });
    continue;
  }
  const seq = extractToolSequence(task.transcriptPath);
  const short = detectShortCircuit(task, seq);
  const loop = detectLoop(seq);
  const usedNames = [...new Set(seq.map((t) => t.name))];

  // 修复正确性（基线目录用备份时的相对布局：去掉 src/main/java/net/jforum/ 前缀）
  const baselineRel = spec.file.replace(/^src[\\/]main[\\/]java[\\/]net[\\/]jforum[\\/]/, "");
  const baselineText = loadText(join(baselineDir, baselineRel));
  const currentPath = join(JFORUM, spec.file);
  const currentText = loadText(currentPath);
  const changed = currentText !== null && baselineText !== null && currentText !== baselineText;
  const positivePass = currentText ? spec.positive.every((re) => re.test(currentText)) : false;
  const negativePass = currentText ? spec.negative.every((re) => !re.test(currentText)) : false;
  const fixed = changed && positivePass && negativePass;
  const touched = currentText && baselineText
    ? (changed ? (positivePass || negativePass ? "已修复" : "有改动但形态不符") : "未改动")
    : "文件缺失/无法读取";

  const editTools = ["edit", "write", "apply_patch", "exec"].filter((n) => usedNames.includes(n));
  const readTarget = (task.transcriptPath && (seq.some((t) => t.name === "read"))) || usedNames.includes("read");

  rows.push({
    id: spec.id,
    name: spec.name,
    task,
    seq,
    short,
    loop,
    usedNames,
    editTools,
    fixed,
    touched,
    positivePass,
    negativePass,
  });
  // 控制台摘要
  console.log(`== ${spec.id}`);
  console.log(`   分数: ${task.grade} ${task.score}/100 | modelRounds=${task.metrics?.modelRounds ?? "-"} | 工具(${seq.length}): ${seq.map((t) => t.name).join(",") || "(无)"}`);
  console.log(`   修复: ${touched} | 正向=${positivePass} 负向=${negativePass}`);
  console.log(`   短路: ${short.isShortCircuit ? "⚠️ 是" : "否"} | 循环: ${loop.isLoop ? `⚠️ 是 (连续${loop.maxStreak}/总${seq.length})` : "否"}`);
}

// ── 汇总表格 ─────────────────────────────────────────────
lines.push(`## 逐任务结果`);
lines.push(``);
lines.push(`| 任务 | 现象 | 分数 | 模型轮次 | 工具序列(简) | 用了编辑工具 | 修复状态 | 短路 | 循环 |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  const t = r.task;
  if (!t) {
    lines.push(`| ${r.id} | ${r.name} | - | - | - | - | 报告中无此任务 | - | - |`);
    continue;
  }
  const seqShort = r.seq.length ? r.seq.slice(0, 6).map((s) => s.name).join(",") + (r.seq.length > 6 ? `…(${r.seq.length})` : "") : "(无)";
  const edit = r.editTools.length ? r.editTools.join(",") : "✗";
  const status = r.fixed ? "✅ 修复正确" : (r.touched.startsWith("已修复") || r.touched.startsWith("有改动") ? `⚠️ ${r.touched}` : `❌ ${r.touched}`);
  lines.push(`| ${r.id} | ${r.name} | ${t.score}/100 ${t.grade} | ${t.metrics?.modelRounds ?? "-"} | ${seqShort} | ${edit} | ${status} | ${r.short.isShortCircuit ? "⚠️" : "✓"} | ${r.loop.isLoop ? "⚠️" : "✓"} |`);
}
lines.push(``);

// ── 诊断明细 ─────────────────────────────────────────────
lines.push(`## 处理思路诊断`);
lines.push(``);
for (const r of rows) {
  const t = r.task;
  if (!t) continue;
  lines.push(`### ${r.id} — ${r.name}`);
  lines.push(``);
  lines.push(`- 分数: ${t.grade} (${t.score}/100) | modelRounds=${t.metrics?.modelRounds ?? 0} | 耗时=${(t.elapsedMs / 1000).toFixed(1)}s | 成本=$${(t.metrics?.totalCost ?? 0).toFixed(5)} | 缓存命中=${t.metrics?.cacheHitRate ?? 0}%`);
  lines.push(`- 工具序列(${r.seq.length}): ${r.seq.map((s) => `${s.name}(${s.args})`).join(" → ") || "(无工具调用)"}`);
  lines.push(`- 短路: ${r.short.isShortCircuit ? "⚠️ **是** — " + (r.short.answeredWithoutTools ? "直接答复未调用任何工具" : `modelRounds=${r.short.rounds} 且缺工具 [${r.short.missingExpected.join(",")}]`) : "否（有实际工具工作）"}`);
  lines.push(`- 循环: ${r.loop.isLoop ? `⚠️ **是** — 单工具最长连续 ${r.loop.maxStreak} 次，频次 ${JSON.stringify(r.loop.counts)}` : `否（${JSON.stringify(r.loop.counts)}）`}`);
  lines.push(`- 修复判定: ${r.fixed ? "✅ 正确" : r.touched} — ${r.positivePass ? "正向形态✓" : "正向形态✗"} ${r.negativePass ? "| 负向消除✓" : "| 负向未消除✗"}`);
  if (t.errors?.length) lines.push(`- 工具错误: ${t.errors.map((e) => (e.text || "").slice(0, 100)).join("; ")}`);
  lines.push(``);
}

// ── 汇总 ─────────────────────────────────────────────────
const fixedCount = rows.filter((r) => r.fixed).length;
const changedCount = rows.filter((r) => r.touched.startsWith("已修复") || r.touched.startsWith("有改动")).length;
const shortCount = rows.filter((r) => r.short.isShortCircuit).length;
const loopCount = rows.filter((r) => r.loop.isLoop).length;
const avgScore = Math.round(rows.filter((r) => r.task).reduce((a, r) => a + (r.task?.score ?? 0), 0) / Math.max(1, rows.filter((r) => r.task).length));
const totalCost = rows.filter((r) => r.task).reduce((a, r) => a + (r.task?.metrics?.totalCost ?? 0), 0);

lines.push(`## 总体分析`);
lines.push(``);
lines.push(`- **修复成功率**: ${fixedCount}/${SPECS.length} 个 bug 修复正确（${changedCount} 个有改动）`);
lines.push(`- **短路出现**: ${shortCount} 次（直接答复未真正动手）`);
lines.push(`- **工具循环**: ${loopCount} 次（重复调用无进展）`);
lines.push(`- **平均分数**: ${avgScore}/100`);
lines.push(`- **总成本**: $${totalCost.toFixed(4)}`);
lines.push(``);
lines.push(`### 按子系统归类`);
lines.push(``);
const byLayer = {};
for (const r of rows) {
  const layer = r.id.replace("fix-", "").split("-")[0];
  byLayer[layer] = byLayer[layer] ?? { ok: 0, total: 0, names: [] };
  byLayer[layer].total++;
  if (r.fixed) byLayer[layer].ok++;
  byLayer[layer].names.push(`${r.id}:${r.fixed ? "✅" : "❌"}`);
}
for (const [layer, v] of Object.entries(byLayer)) {
  lines.push(`- **${layer}**: ${v.ok}/${v.total} 修复 (${v.names.join(", ")})`);
}
lines.push(``);

// ── 写文件 ───────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(ACCEPT_ROOT, ts);
mkdirSync(outDir, { recursive: true });
const mdPath = join(outDir, "report.md");
writeFileSync(mdPath, lines.join("\n"), "utf8");

// 机器可读
const summary = {
  ts: new Date().toISOString(),
  reportTimestamp: report.timestamp,
  baseline: baselineDir,
  tasks: rows.map((r) => ({
    id: r.id,
    name: r.name,
    score: r.task?.score ?? null,
    grade: r.task?.grade ?? null,
    modelRounds: r.task?.metrics?.modelRounds ?? null,
    elapsedMs: r.task?.elapsedMs ?? null,
    totalCost: r.task?.metrics?.totalCost ?? null,
    toolSequence: r.seq.map((s) => s.name),
    editTools: r.editTools,
    fixed: r.fixed,
    shortCircuit: r.short.isShortCircuit,
    loop: r.loop.isLoop,
    positivePass: r.positivePass,
    negativePass: r.negativePass,
  })),
  summary: { fixed: fixedCount, total: SPECS.length, shortCircuits: shortCount, loops: loopCount, avgScore, totalCost },
};
writeFileSync(join(outDir, "report.json"), JSON.stringify(summary, null, 2), "utf8");

console.log(``);
console.log(`=== 汇总: ${fixedCount}/${SPECS.length} 修复 | 短路 ${shortCount} | 循环 ${loopCount} | 平均 ${avgScore}/100 | 成本 $${totalCost.toFixed(4)}`);
console.log(`报告: ${mdPath}`);
