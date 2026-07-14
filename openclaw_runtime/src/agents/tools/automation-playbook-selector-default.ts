/**
 * Default automation playbook selector factory for the OpenClaw runtime.
 *
 * Bridges the shared/agent-browser selector (which the runtime cannot import
 * directly due to package boundaries) with the runtime's simple-completion LLM
 * API. Inlines the 6 builtin playbook candidates and the selector pure logic
 * (prompt construction, JSON parsing, normalization) to avoid cross-package
 * imports; keeps them in sync with shared/agent-browser/automation-playbooks.ts
 * and automation-playbook-selector.ts.
 *
 * Used by createOpenClawTools to provide a default automationPlaybookSelector
 * when the caller does not inject one explicitly.
 */
import {
  prepareSimpleCompletionModelForAgent,
  completeWithPreparedSimpleCompletionModel,
} from "../simple-completion-runtime.js";
import { extractAssistantText } from "../embedded-agent-utils.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type {
  AutomationPlaybookCandidate,
  AutomationPlaybookSelectionResult,
  AutomationPlaybookSelectorFn,
} from "./automation-playbook-selector-tool.js";

// --- Builtin playbook candidates (synced with shared/agent-browser/automation-playbooks.ts) ---

const BUILTIN_CANDIDATES: AutomationPlaybookCandidate[] = [
  {
    id: "page_reading",
    title: "页面阅读",
    description: "阅读当前页面、提炼重点、抽取用户指定信息，并在证据不足时说明缺口。",
    tags: ["页面", "阅读", "总结", "信息提取"],
    risk: "low",
    recommendedCapabilities: ["observe_page", "deliver_result"],
  },
  {
    id: "multi_page_synthesis",
    title: "多页面汇总",
    description: "在多个已打开页面或按需新开页面之间收集信息，汇总差异、共性和证据来源。",
    tags: ["多页面", "汇总", "对比", "资料整合"],
    risk: "medium",
    recommendedCapabilities: ["observe_page", "operate_page", "deliver_result"],
  },
  {
    id: "form_interaction",
    title: "表单/交互",
    description: "填写表单、点击页面控件、检查提交前状态，并处理可见交互阻塞原因。",
    tags: ["表单", "填写", "点击", "交互"],
    risk: "high",
    recommendedCapabilities: ["observe_page", "operate_page", "confirm_boundary"],
  },
  {
    id: "site_diagnostics",
    title: "现场诊断",
    description: "诊断页面错误、Console、资源加载、性能慢点和 Network 错误/慢请求现场。",
    tags: ["诊断", "Console", "性能", "错误", "Network"],
    risk: "medium",
    recommendedCapabilities: ["observe_page", "analyze_site", "deliver_result"],
  },
  {
    id: "network_api_analysis",
    title: "Network/API 分析",
    description: "观察 Network 请求，分析接口参数、请求/响应结构，并在受控边界内做重放沙箱分析。",
    tags: ["Network", "API", "接口", "参数", "重放"],
    risk: "high",
    recommendedCapabilities: ["observe_page", "analyze_site", "confirm_boundary"],
  },
  {
    id: "source_runtime_analysis",
    title: "源码/运行时分析",
    description: "结合 JS 资源、Source Map 和运行时只读摘要定位源码线索、函数来源和页面运行态信息。",
    tags: ["源码", "运行时", "Source Map", "JS", "定位"],
    risk: "medium",
    recommendedCapabilities: ["observe_page", "analyze_site"],
  },
];

export function getBuiltinAutomationPlaybookCandidates(): AutomationPlaybookCandidate[] {
  return BUILTIN_CANDIDATES.map((candidate) => ({
    ...candidate,
    tags: [...candidate.tags],
    ...(candidate.recommendedCapabilities
      ? { recommendedCapabilities: [...candidate.recommendedCapabilities] }
      : {}),
  }));
}

// --- Selector pure logic (synced with shared/agent-browser/automation-playbook-selector.ts) ---

const PLAYBOOK_SELECTION_REASON_LIMIT = 200;

function createSelectionPrompt(input: {
  userContent: string;
  pageContextSummary?: string;
  playbooks: AutomationPlaybookCandidate[];
}): Array<{ role: "system" | "user"; content: string }> {
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
        input.pageContextSummary?.trim()
          ? `页面摘要：\n${input.pageContextSummary.trim()}`
          : "页面摘要：无",
        `候选 Playbook：\n${JSON.stringify(candidates, null, 2)}`,
      ].join("\n\n"),
    },
  ];
}

function parseSelectionJson(
  content: string,
): { playbookId: string | null; confidence?: unknown; reason?: unknown } | undefined {
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

function normalizeSelection(
  value: { playbookId: string | null; confidence?: unknown; reason?: unknown } | undefined,
  playbooks: AutomationPlaybookCandidate[],
): AutomationPlaybookSelectionResult | undefined {
  if (!value || value.playbookId === null) {
    return undefined;
  }
  const playbook = playbooks.find((item) => item.id === value.playbookId);
  if (!playbook) {
    return undefined;
  }
  const confidence =
    value.confidence === "high" || value.confidence === "medium" || value.confidence === "low"
      ? value.confidence
      : "low";
  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, PLAYBOOK_SELECTION_REASON_LIMIT)
      : "模型未提供选择理由";
  return {
    playbookId: playbook.id,
    title: playbook.title,
    source: "builtin",
    confidence,
    reason,
  };
}

// --- Default factory: wires selector to runtime LLM ---

export function createDefaultAutomationPlaybookSelector(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): AutomationPlaybookSelectorFn | undefined {
  if (!params.cfg || !params.agentId) {
    console.warn("[automation-playbook] selector 未就绪，工具将不注册", {
      hasCfg: Boolean(params.cfg),
      hasAgentId: Boolean(params.agentId),
    });
    return undefined;
  }
  const playbooks = getBuiltinAutomationPlaybookCandidates();
  return async ({ userContent, pageContextSummary, signal }) => {
    const messages = createSelectionPrompt({ userContent, pageContextSummary, playbooks });
    let assistantText: string;
    try {
      const prepared = await prepareSimpleCompletionModelForAgent({
        cfg: params.cfg!,
        agentId: params.agentId!,
        allowMissingApiKeyModes: ["aws-sdk"],
      });
      if ("error" in prepared) {
        console.warn("[automation-playbook] 跳过预选：模型未就绪", {
          error: prepared.error,
        });
        return undefined;
      }
      const result = await completeWithPreparedSimpleCompletionModel({
        model: prepared.model,
        auth: prepared.auth,
        cfg: params.cfg!,
        context: {
          systemPrompt: messages[0].content,
          messages: [
            {
              role: "user",
              content: messages[1].content,
              timestamp: Date.now(),
            },
          ],
        },
        options: { maxTokens: 512, temperature: 0.2, signal },
      });
      assistantText = extractAssistantText(result);
    } catch (error) {
      console.warn("[automation-playbook] 跳过预选：请求异常", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return undefined;
    }
    const parsed = parseSelectionJson(assistantText);
    return normalizeSelection(parsed, playbooks);
  };
}
