/**
 * 抄写自 browser-ai-assistant-master/src/background/automationPlaybookSelector.ts。
 *
 * 适配点（ClawX 无 main 端模型调用基础设施）：
 * 1. 删除 `createModelRequestPayload`/`withModelRequestRetry`/`shouldRetryModelResponse`/
 *    `normalizeModelRequestRetryCount`/`extractAssistantResponseData`/`ModelConfig`/`Fetcher` 依赖。
 * 2. `selectAutomationPlaybook` 改造为接受注入的 `AutomationPlaybookModelInvoker` 回调，
 *    由调用方负责实际模型协议（payload 构造、HTTP、重试、响应解析）。
 * 3. 本地定义最小消息类型 `AutomationPlaybookSelectionMessage`，不依赖外部模型类型。
 * 4. `createAutomationPlaybookSelectionPrompt`/`parseSelectionJson`/`extractJsonObjectText`/
 *    `warnPlaybookSelectionSkipped` 原样抄写。
 *
 * 逻辑结构、提示词、JSON 解析、归一化语义原样保留。
 */

import type { AutomationPlaybookSelection } from "./types";
import {
  normalizeAutomationPlaybookSelection,
  type AutomationPlaybook,
} from "./automation-playbooks";

/**
 * 最小消息类型。仅用于 Playbook 预选提示构造，不耦合任何模型协议。
 */
export interface AutomationPlaybookSelectionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * 模型调用注入器。调用方负责把 messages 发给实际模型并返回 assistant 文本内容。
 * 重试、超时、协议细节由调用方实现；selector 只关注业务结果。
 */
export type AutomationPlaybookModelInvoker = (input: {
  messages: AutomationPlaybookSelectionMessage[];
  signal?: AbortSignal;
}) => Promise<string>;

export function createAutomationPlaybookSelectionPrompt(input: {
  userContent: string;
  pageContextSummary?: string;
  playbooks: AutomationPlaybook[];
}): AutomationPlaybookSelectionMessage[] {
  const candidates = input.playbooks.map((playbook) => ({
    id: playbook.id,
    title: playbook.title,
    description: playbook.description,
    tags: playbook.tags,
    risk: playbook.risk,
    recommendedCapabilities: playbook.recommendedCapabilities,
  }));

  return [
    {
      role: "system",
      content: [
        "你是浏览器自动化任务策略预选器。只返回 JSON，不要输出 Markdown、解释或额外文本。",
        "你只能从候选 Playbook 中选择一个最适合本次用户需求的策略；如果不需要浏览器自动化策略，playbookId 返回 null。",
        '返回格式必须是：{"playbookId": string | null, "confidence": "low" | "medium" | "high", "reason": string}。',
        "不要请求工具，不要生成最终回答，不要把候选策略全文复制到 reason。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `用户需求：${input.userContent}`,
        input.pageContextSummary?.trim() ? `页面摘要：\n${input.pageContextSummary.trim()}` : "页面摘要：无",
        `候选 Playbook：\n${JSON.stringify(candidates, null, 2)}`,
      ].join("\n\n"),
    },
  ];
}

export async function selectAutomationPlaybook(input: {
  userContent: string;
  pageContextSummary?: string;
  playbooks: AutomationPlaybook[];
  invokeModel: AutomationPlaybookModelInvoker;
  signal?: AbortSignal;
}): Promise<AutomationPlaybookSelection | undefined> {
  if (input.playbooks.length === 0) {
    return undefined;
  }
  const messages = createAutomationPlaybookSelectionPrompt({
    userContent: input.userContent,
    pageContextSummary: input.pageContextSummary,
    playbooks: input.playbooks,
  });
  try {
    const content = await input.invokeModel({ messages, signal: input.signal });
    const parsed = parseSelectionJson(content);
    if (!parsed || parsed.playbookId === null) {
      warnPlaybookSelectionSkipped(parsed?.playbookId === null ? "模型未选择策略" : "模型响应 JSON 无效");
      return undefined;
    }
    const selection = normalizeAutomationPlaybookSelection(parsed, input.playbooks);
    if (!selection) {
      warnPlaybookSelectionSkipped("模型返回未知或禁用策略");
    }
    return selection;
  } catch (error) {
    warnPlaybookSelectionSkipped("预选请求异常", { errorName: error instanceof Error ? error.name : typeof error });
    return undefined;
  }
}

function warnPlaybookSelectionSkipped(reason: string, details: Record<string, unknown> = {}): void {
  console.warn("[automation-playbook] 已跳过任务策略预选：", {
    reason,
    ...details,
  });
}

function parseSelectionJson(content: string): { playbookId: string | null; confidence?: unknown; reason?: unknown } | undefined {
  const text = content.trim();
  if (!text) {
    return undefined;
  }
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== "object" || !("playbookId" in parsed)) {
      return undefined;
    }
    const source = parsed as { playbookId?: unknown; confidence?: unknown; reason?: unknown };
    if (source.playbookId !== null && typeof source.playbookId !== "string") {
      return undefined;
    }
    return {
      playbookId: source.playbookId,
      confidence: source.confidence,
      reason: source.reason,
    };
  } catch {
    return undefined;
  }
}

function extractJsonObjectText(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  return source.slice(start, end + 1);
}
