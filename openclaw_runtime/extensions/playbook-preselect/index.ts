/**
 * Playbook Preselect plugin entry (B1).
 *
 * Registers a before_prompt_build hook that deterministically runs the
 * automation playbook selector on each chat turn. The selected playbook's
 * guidance is injected via prependContext so the agent follows the playbook
 * strategy for the current browser-automation task.
 *
 * Complements B2 (select_automation_playbook tool) which lets the agent
 * autonomously re-select mid-turn; B1 guarantees every turn starts with a
 * playbook pre-selection.
 *
 * Plugin structure follows extensions/diffs (manifest + index.ts + api.ts).
 * Hook registration follows api.on("before_prompt_build", handler, {timeoutMs}).
 *
 * Selector 逻辑内联在本插件中（builtin candidates + prompt 构造 + JSON 解析
 * + 规范化），LLM 调用通过 api.runtime.llm.complete 完成，避免跨边界 import
 * src/** 违反 extension 边界规则。保持与
 * src/agents/tools/automation-playbook-selector-default.ts 同步。
 */
import {
  definePluginEntry,
  type OpenClawConfig,
  type OpenClawPluginApi,
} from "./api.js";

// --- 本地类型定义（与 automation-playbook-selector-tool.ts 保持一致） ---

interface AutomationPlaybookCandidate {
  id: string;
  title: string;
  description: string;
  tags: string[];
  risk: string;
  recommendedCapabilities?: string[];
}

interface AutomationPlaybookSelectionResult {
  playbookId: string;
  title: string;
  source: string;
  confidence: "low" | "medium" | "high";
  reason: string;
}

// --- Builtin playbook candidates（与 automation-playbook-selector-default.ts 同步） ---

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

// --- Selector 纯逻辑（与 automation-playbook-selector-default.ts 同步） ---

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

// --- 本地 selector：通过 api.runtime.llm.complete 调用 LLM ---

async function selectPlaybook(params: {
  api: OpenClawPluginApi;
  agentId: string;
  userContent: string;
  pageContextSummary?: string;
  signal?: AbortSignal;
}): Promise<AutomationPlaybookSelectionResult | undefined> {
  const messages = createSelectionPrompt({
    userContent: params.userContent,
    pageContextSummary: params.pageContextSummary,
    playbooks: BUILTIN_CANDIDATES,
  });
  let assistantText: string;
  try {
    const result = await params.api.runtime.llm.complete({
      agentId: params.agentId,
      systemPrompt: messages[0].content,
      messages: [{ role: "user", content: messages[1].content }],
      maxTokens: 512,
      temperature: 0.2,
      signal: params.signal,
      purpose: "playbook-preselect",
    });
    assistantText = result.text;
  } catch (error) {
    params.api.logger.warn?.(
      `${PRESELECT_LABEL} LLM 调用失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  const parsed = parseSelectionJson(assistantText);
  return normalizeSelection(parsed, BUILTIN_CANDIDATES);
}

// --- Playbook guidance prompts（与 shared/agent-browser/automation-playbooks.ts 同步） ---

const PLAYBOOK_PROMPTS: Record<string, string> = {
  page_reading: [
    "任务策略：页面阅读",
    "优先使用当前受控页面作为事实来源，先观察页面标题、URL、正文结构和关键可见文本；需要完整正文、全文 HTML 或按 CSS/XPath 抽取局部内容时，优先使用 browser.extract_content。",
    "需要结构化提取时，先确认页面内容范围，再按用户要求输出字段；不要把未观察到的信息当作事实。",
    "如果页面内容不足、被截断或需要登录态以外的信息，明确标注未验证假设和需要补充的证据。",
  ].join("\n"),
  multi_page_synthesis: [
    "任务策略：多页面汇总",
    "先使用可用标签页列表确认已有页面，不要跳过用户已经打开的页面直接新开页面。",
    "跨页面收集信息时为每个页面保留标题、URL 和核心证据摘要；需要正文或 HTML 证据时可在对应受控页面使用 browser.extract_content，结论必须能追溯到对应页面。",
    "需要新开页面时只打开普通 http/https 页面；切换页面后旧 UID 失效，继续操作前必须重新观察。",
  ].join("\n"),
  form_interaction: [
    "任务策略：表单/交互",
    "先观察页面结构并定位候选元素，操作前确认目标元素、字段含义和用户给出的输入值。",
    "提交、发布、删除、付款、发送消息、上传下载或跨站授权前必须遵守现有边界确认要求，不能把策略当作用户授权。",
    "交互失败时先诊断禁用、遮挡、必填项、校验文案和焦点状态，再决定是否继续尝试或请求用户确认。",
  ].join("\n"),
  site_diagnostics: [
    "任务策略：现场诊断",
    "按页面状态、Console、性能摘要、Network 错误/慢请求的顺序收集现场证据，避免只凭单一信号下结论。",
    "区分事实证据、模型推断和未验证假设；对错误堆栈、状态码、资源类型和可复现步骤分别记录。",
    "诊断工具只读时不得声称已经修复页面；如果需要操作或更高权限，必须遵守现有工具边界和用户确认。",
  ].join("\n"),
  network_api_analysis: [
    "任务策略：Network/API 分析",
    "先列出相关请求并按 URL、方法、状态码、资源类型和时间线筛选候选接口，再读取必要的脱敏详情。",
    "请求体、Header、Cookie、Token 和响应体都按现有脱敏与权限边界处理；策略不能要求工具暴露未授权原文。",
    "请求重放、同源读取或完全访问能力必须经过现有运行态过滤和边界确认，不得由 Playbook 自动开启。",
  ].join("\n"),
  source_runtime_analysis: [
    "任务策略：源码/运行时分析",
    "先从 Network/JS 资源和页面运行态只读摘要中定位候选线索，再按证据链说明来源与不确定性。",
    "Source Map 可用时优先映射到原始源码位置；不可用时保留生成代码资源、关键词和上下文片段。",
    "运行时读取只用于分析线索，不得执行任意脚本或绕过现有完全访问授权边界。",
  ].join("\n"),
};

const DEFAULT_TIMEOUT_MS = 10_000;
const UPPER_BOUND_TIMEOUT_MS = 30_000;
const PRESELECT_LABEL = "[playbook-preselect]";

function resolvePluginConfig(raw: unknown): { enabled: boolean; timeoutMs: number } {
  if (!raw || typeof raw !== "object") {
    return { enabled: true, timeoutMs: DEFAULT_TIMEOUT_MS };
  }
  const cfg = raw as { enabled?: unknown; timeoutMs?: unknown };
  return {
    enabled: cfg.enabled !== false,
    timeoutMs:
      typeof cfg.timeoutMs === "number" && cfg.timeoutMs >= 1000 && cfg.timeoutMs <= 30000
        ? cfg.timeoutMs
        : DEFAULT_TIMEOUT_MS,
  };
}

function buildGuidanceText(playbookId: string, title: string, reason: string): string {
  const prompt = PLAYBOOK_PROMPTS[playbookId];
  if (!prompt) {
    return "";
  }
  return [
    `${PRESELECT_LABEL} 已为本次任务预选策略：${title}（${playbookId}）`,
    `选择理由：${reason}`,
    "请按以下策略指导执行：",
    prompt,
  ].join("\n");
}

export function registerPlaybookPreselectPlugin(api: OpenClawPluginApi): void {
  const readCurrentConfig = (): OpenClawConfig | undefined => {
    try {
      // api.runtime.config.current() returns DeepReadonly<OpenClawConfig>;
      // bridge to OpenClawConfig to match the convention used by all bundled
      // plugins (active-memory, diffs, codex, etc.). api.config is already
      // typed as OpenClawConfig, so no cast is needed on the fallback path.
      const live = api.runtime.config?.current?.() as OpenClawConfig | undefined;
      return live ?? api.config;
    } catch {
      return api.config;
    }
  };

  const resolveLivePluginConfig = () => {
    const cfg = readCurrentConfig();
    const plugins = cfg?.plugins;
    if (plugins?.enabled === false) {
      return { enabled: false, timeoutMs: DEFAULT_TIMEOUT_MS };
    }
    // cfg.plugins.config is typed as Record<string, unknown> | undefined
    // (see config/types.plugins.ts), so no narrow cast is needed here.
    const pluginConfig = plugins?.config?.["playbook-preselect"];
    return resolvePluginConfig(pluginConfig);
  };

  api.on(
    "before_prompt_build",
    async (event, ctx) => {
      const pluginConfig = resolveLivePluginConfig();
      if (!pluginConfig.enabled) {
        return undefined;
      }
      const agentId = ctx.agentId?.trim();
      if (!agentId) {
        return undefined;
      }
      const userPrompt = event.prompt?.trim();
      if (!userPrompt) {
        return undefined;
      }

      // 动态 timeout：用 live config 的 timeoutMs 控制 LLM 调用，
      // hook 框架的 timeout 注册为上限，避免注册时固定不可调整。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), pluginConfig.timeoutMs);
      try {
        const selection = await selectPlaybook({
          api,
          agentId,
          userContent: userPrompt,
          signal: controller.signal,
        });
        if (!selection) {
          return undefined;
        }
        const guidance = buildGuidanceText(selection.playbookId, selection.title, selection.reason);
        if (!guidance) {
          return undefined;
        }
        return { prependContext: guidance };
      } catch (error) {
        api.logger.warn?.(
          `${PRESELECT_LABEL} before_prompt_build failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
    { timeoutMs: UPPER_BOUND_TIMEOUT_MS },
  );
}

export default definePluginEntry({
  id: "playbook-preselect",
  name: "Playbook Preselect",
  description:
    "Deterministic automation playbook pre-selection before prompt build (B1).",
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        timeoutMs: { type: "number", minimum: 1000, maximum: 30000, default: 10000 },
      },
    },
  },
  register: registerPlaybookPreselectPlugin,
});
