/**
 * 抄写自 browser-ai-assistant-master/src/shared/webSearch/tavily.ts。
 *
 * 适配点（仅 import 路径）：
 * 1. `../types` → `../types`（ChatWebSearchPayload 已抄入 shared/agent-browser/types.ts）
 *
 * 仅保留 tool-artifacts.ts 需要的两个格式化函数；searchTavily 等运行时函数未抄入。
 * 这两个函数不使用 truncateText，因此未引入 ../text。
 */

import type { ChatWebSearchPayload } from "../types";

export function createTavilySearchContextPrompt(attachment: ChatWebSearchPayload): string {
  const sections = [
    "网络搜索上下文：",
    `搜索渠道：${attachment.provider}`,
    `搜索问题：${attachment.query}`,
  ];

  if (attachment.answer?.trim()) {
    sections.push("", "综合答案：", attachment.answer.trim());
  }

  sections.push("", "搜索结果：");
  if (attachment.results.length === 0) {
    sections.push("未返回可用搜索结果");
  } else {
    sections.push(
      attachment.results
        .map((result, index) =>
          [
            `${index + 1}. ${result.title || "未命名结果"}`,
            `URL：${result.url}`,
            result.publishedDate ? `发布时间：${result.publishedDate}` : "",
            typeof result.score === "number" ? `相关度：${result.score}` : "",
            `摘要：${result.content}`,
            result.rawContent ? `原始内容：${result.rawContent}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n"),
    );
  }

  if (attachment.truncated) {
    sections.push("", "提示：部分搜索内容已截断。");
  }

  return sections.join("\n").trim();
}

export function formatTavilySearchAttachmentSummary(attachment: ChatWebSearchPayload): string {
  const first = attachment.results[0];
  if (!first) {
    return `已搜索：${attachment.query}，未返回结果`;
  }

  return `已搜索：${attachment.query}，返回 ${attachment.results.length} 条结果，首条：${first.title || first.url}`;
}
