#!/usr/bin/env node
/**
 * chain-audit 报告生成库
 * 将测试结果渲染为 JSON（机器可读）+ Markdown（人可读）双格式证据。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** 写出 JSON + Markdown 报告，返回路径。 */
export function writeReport(outDir, report) {
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, "report.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const mdPath = join(outDir, "report.md");
  writeFileSync(mdPath, renderMarkdown(report), "utf8");

  return { jsonPath, mdPath };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Chain Audit Report — ${report.timestamp}`);
  lines.push("");
  lines.push(`**Agent 链路分级**: ${report.aggregate.grade}（${report.aggregate.score}/100）`);
  lines.push(`**RPC 服务面分级**: ${report.rpcAggregate?.grade ?? "-"}（${report.rpcAggregate?.score ?? "-"}/100）`);
  lines.push(`**任务数**: ${report.aggregate.taskCount} | **通过**: ${report.aggregate.passed} | **失败**: ${report.aggregate.failed}`);
  lines.push("");

  if (report.rpcGroups?.length) {
    lines.push("## RPC 服务面（直测）");
    lines.push("");
    lines.push("| 服务组 | 分级 | 通过率 |");
    lines.push("|--------|------|--------|");
    for (const g of report.rpcGroups) {
      lines.push(`| ${g.name} | ${g.grade} | ${g.passed}/${g.total}${g.skipped ? ` (skip ${g.skipped})` : ""} |`);
    }
    lines.push("");
    for (const g of report.rpcGroups) {
      const failed = g.checks.filter((c) => !c.passed);
      if (failed.length) {
        lines.push(`**${g.name} 失败项**:`);
        for (const f of failed) lines.push(`- \`${f.method}\`: ${f.error}`);
        lines.push("");
      }
    }
  }

  lines.push("| 链路 | 分级 | 分数 | 关键指标 |");
  lines.push("|------|------|------|----------|");
  for (const t of report.tasks) {
    const metrics = Object.entries(t.metrics ?? {})
      .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(1) : v}`)
      .join(", ");
    lines.push(`| ${t.id} | ${t.grade} | ${t.score} | ${metrics} |`);
  }
  lines.push("");

  for (const t of report.tasks) {
    lines.push(`## ${t.id} — ${t.grade} (${t.score}/100)`);
    lines.push("");
    if (t.description) lines.push(`${t.description}`);
    lines.push("");
    if (t.checks && Object.keys(t.checks).length) {
      lines.push("| 检查项 | 结果 |");
      lines.push("|--------|------|");
      for (const [k, v] of Object.entries(t.checks)) {
        lines.push(`| ${k} | ${v ? "✅" : "❌"} |`);
      }
      lines.push("");
    }
    if (t.warnings?.length) {
      lines.push(`**警告**: ${t.warnings.join("; ")}`);
      lines.push("");
    }
    if (t.toolSequence?.length) {
      lines.push("**工具序列**:");
      lines.push("```");
      for (const tc of t.toolSequence) lines.push(`  ${tc.name} ${tc.args ? "| " + tc.args : ""}`);
      lines.push("```");
      lines.push("");
    }
    if (t.errors?.length) {
      lines.push("**错误**:");
      for (const e of t.errors.slice(0, 5)) {
        lines.push(`- \`${e.tool}\`: ${e.text.slice(0, 120)}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
