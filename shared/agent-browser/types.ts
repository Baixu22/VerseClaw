/**
 * Agent Browser 子系统共享类型。
 *
 * 抄写自 browser-ai-assistant-master/src/shared/models/types.ts 中的
 * ModelToolCall / ModelToolResult，以及 browserControlMessageHandler.ts
 * 中的 Accessibility 相关类型定义。
 *
 * 保留源文件粒度，仅调整 import 路径，便于后续同步上游修复。
 */

/** 浏览器控制工具调用入参，对应源项目 ModelToolCall。 */
export interface BrowserControlToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  parseError?: string;
}

/** 浏览器控制工具调用结果，对应源项目 ModelToolResult。 */
export interface BrowserControlToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/** Accessibility 属性节点。 */
export interface AccessibilityProperty {
  name?: string;
  value?: {
    value?: unknown;
  };
}

/** Accessibility 节点。 */
export interface AccessibilityNode {
  nodeId?: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: {
    value?: unknown;
  };
  name?: {
    value?: unknown;
  };
  value?: {
    value?: unknown;
  };
  properties?: AccessibilityProperty[];
  childIds?: string[];
}

/** 快照格式化预算。 */
export interface SnapshotFormatBudget {
  lines: string[];
  visitedNodeIds: Set<string>;
  nodeCount: number;
  characterCount: number;
  truncated: boolean;
}

/** 浏览器标签页信息（用于页面身份校验）。 */
export interface BrowserControlTabInfo {
  title: string;
  url: string;
}
