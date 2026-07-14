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
 */
import {
  definePluginEntry,
  type OpenClawConfig,
  type OpenClawPluginApi,
} from "./api.js";
import {
  createDefaultAutomationPlaybookSelector,
} from "../../src/agents/tools/automation-playbook-selector-default.js";

// --- Playbook guidance prompts (synced with shared/agent-browser/automation-playbooks.ts) ---

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
      return (api.runtime.config?.current?.() as OpenClawConfig | undefined) ??
        (api.config as OpenClawConfig | undefined);
    } catch {
      return api.config as OpenClawConfig | undefined;
    }
  };

  const resolveLivePluginConfig = () => {
    const cfg = readCurrentConfig();
    const plugins = cfg?.plugins;
    if (plugins?.enabled === false) {
      return { enabled: false, timeoutMs: DEFAULT_TIMEOUT_MS };
    }
    const pluginConfig = (cfg as { plugins?: { config?: Record<string, unknown> } } | undefined)
      ?.plugins?.config?.["playbook-preselect"];
    return resolvePluginConfig(pluginConfig);
  };

  api.on(
    "before_prompt_build",
    async (event, ctx) => {
      const pluginConfig = resolveLivePluginConfig();
      if (!pluginConfig.enabled) {
        return undefined;
      }
      const cfg = readCurrentConfig();
      if (!cfg) {
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

      const selector = createDefaultAutomationPlaybookSelector({ cfg, agentId });
      if (!selector) {
        return undefined;
      }

      try {
        const selection = await selector({ userContent: userPrompt });
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
      }
    },
    { timeoutMs: resolveLivePluginConfig().timeoutMs },
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
