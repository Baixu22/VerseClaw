/**
 * P1-4：工具分类矩阵与四层拦截链路静态常量表。
 *
 * 来源：browser-ai-assistant-master/AGENTS.md §15 与 §10.15 散落语义提炼。
 * SRC AGENTS.md 没有命名"工具分类三维矩阵"或"四层拦截链路"章节，
 * 本文件把散落在 §15 第 730-758 行和 §10.15 第 388-392 行的多层校验语义
 * 集中为静态常量表，供 harness rule 和未来 L1-L4 拦截实现引用。
 *
 * 三维分类（runtime / capabilities / risk）的载体是 tool-registry.ts 的
 * TOOL_CLASSIFICATION_BY_ID 表，本文件只定义四层拦截的层级语义和校验顺序。
 */

import type { BrowserAutomationMode } from './tool-authorization.ts';
import type { ModelToolRegistryEntry } from './tool-registry.ts';
import { isToolRuntimeAvailable } from './tool-registry.ts';

// ---------- 四层拦截层级定义 ----------

export const TOOL_INTERCEPTION_LAYERS = {
  L1_UI_GRAY_OUT: 'L1_UI_GRAY_OUT',
  L2_BATCH_ENABLE_PRESET: 'L2_BATCH_ENABLE_PRESET',
  L3_GATEWAY_BRIDGE_FILTER: 'L3_GATEWAY_BRIDGE_FILTER',
  L4_SERVICE_REVALIDATE: 'L4_SERVICE_REVALIDATE',
} as const;

export type ToolInterceptionLayer = typeof TOOL_INTERCEPTION_LAYERS[keyof typeof TOOL_INTERCEPTION_LAYERS];

export interface ToolInterceptionLayerSpec {
  layer: ToolInterceptionLayer;
  label: string;
  description: string;
  rule: string;
}

/**
 * 四层拦截链路规格表。
 * 每一层都必须独立生效，不能因为上一层通过就跳过本层校验。
 */
export const TOOL_INTERCEPTION_LAYER_SPECS: readonly ToolInterceptionLayerSpec[] = [
  {
    layer: TOOL_INTERCEPTION_LAYERS.L1_UI_GRAY_OUT,
    label: 'L1 UI 置灰',
    description: 'Renderer 侧工具菜单根据 browserControlEnabled 与 runtimeMode 置灰不可用工具。',
    rule: 'runtime 为 browser_control、controlled_enhanced、full_access 且当前运行态不满足时必须置灰并跳过批量启用。',
  },
  {
    layer: TOOL_INTERCEPTION_LAYERS.L2_BATCH_ENABLE_PRESET,
    label: 'L2 批量启用预设',
    description: '工具全选、按分类启用、预设启用或导入配置恢复时，必须跳过当前运行态不可用的 debugger 工具。',
    rule: '工具分类只能用于 UI 筛选、批量启用、提示词和审计展示，不能替代工具注册表 allow-list、requiredCapabilities 过滤、运行态授权和 background 执行期二次校验。',
  },
  {
    layer: TOOL_INTERCEPTION_LAYERS.L3_GATEWAY_BRIDGE_FILTER,
    label: 'L3 Gateway bridge 过滤',
    description: '模型请求构造前必须按真实运行态过滤工具 schema 和浏览器自动化系统提示词。',
    rule: 'browser.* 工具只有在工具调用开启、用户启用对应工具、且全局 browserControlEnabled 运行态为 true 时才允许暴露给模型；Gateway bridge 必须基于当前运行态二次过滤全部 browser.* 工具，不能仅信任 runtime 传入的 enabledToolIds。',
  },
  {
    layer: TOOL_INTERCEPTION_LAYERS.L4_SERVICE_REVALIDATE,
    label: 'L4 service 二次校验',
    description: 'AgentBrowserService 执行前必须二次校验 runtimeMode 与 browserControlEnabled。',
    rule: '模型返回的工具名只有匹配已注册且已启用的工具时才允许执行；service 层必须独立于 UI 和 Gateway bridge 做运行态二次校验，不信任任何上游传入的运行态。',
  },
];

// ---------- 拦截校验函数 ----------

export interface ToolInterceptionContext {
  browserControlEnabled: boolean;
  browserAutomationMode: BrowserAutomationMode;
}

/**
 * L1/L2/L3 通用校验：工具在给定运行态下是否可用。
 * 包装 isToolRuntimeAvailable，供四层拦截链路统一调用。
 */
export function isToolAvailableUnderInterception(
  tool: ModelToolRegistryEntry,
  context: ToolInterceptionContext,
): boolean {
  return isToolRuntimeAvailable(tool, context.browserControlEnabled, context.browserAutomationMode);
}

/**
 * 批量过滤：从工具列表中筛出当前运行态可用的工具。
 * 用于 L2 批量启用预设和 L3 Gateway bridge 过滤。
 */
export function filterToolsByRuntimeAvailability(
  tools: ModelToolRegistryEntry[],
  context: ToolInterceptionContext,
): ModelToolRegistryEntry[] {
  return tools.filter((tool) => isToolAvailableUnderInterception(tool, context));
}

/**
 * 返回四层拦截链路的校验顺序说明，供 harness rule 和审计展示引用。
 */
export function getToolInterceptionLayerOrder(): readonly ToolInterceptionLayer[] {
  return TOOL_INTERCEPTION_LAYER_SPECS.map((spec) => spec.layer);
}
