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

/**
 * Network 类型，抄写自 browser-ai-assistant-master/src/shared/types.ts（Network 部分）。
 * 保留源文件粒度，便于后续同步上游修复。
 */
export interface NetworkHeader {
  name: string;
  value: string;
}

export interface NetworkRequestMeta {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  resourceType?: string;
  startedAt?: string;
  durationMs?: number;
  requestHeaders?: NetworkHeader[];
  responseHeaders?: NetworkHeader[];
  requestBody?: string;
  failed?: boolean;
  error?: string;
}

export interface NetworkRequestDetail extends NetworkRequestMeta {
  responseBody?: string;
  responseBodyEncoding?: string;
  truncated: boolean;
  redacted: boolean;
}

/** P1-5: Chat 工具附件类型，抄写自 SRC src/shared/types.ts。 */
export type EndpointType = "openai_chat" | "anthropic_messages";
export type ChatRole = "system" | "user" | "assistant";
export type PageContextExtractMode = "text" | "all";
export type ExtractionSelectorType = "css" | "xpath";

export interface ExtractionRule {
  id: string;
  alias: string;
  urlPattern: string;
  selectorsText: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}
export type WebSearchProviderType = "tavily";
export type ToolAttachmentContextMode = "none" | "summary" | "selected_details";
export type ToolAttachmentRetentionMode = "discard" | "summary" | "detail_pool" | "current_turn_detail";
export type AutomationPlaybookSource = "builtin" | "skill" | "user";
export type AutomationPlaybookConfidence = "low" | "medium" | "high";
export type AutomationPlaybookRisk = "low" | "medium" | "high" | "critical";

export interface AutomationPlaybookSettings {
  disabledPlaybookIds: string[];
}

export type ChatToolCallStatus = "running" | "success" | "error";
export type AutomationTimelineEventType = "tool_call" | "page_change" | "wait" | "user_confirmation" | "failure_recovery";
export type AutomationReportType = "general" | "page_inspection" | "form_diagnosis" | "interface_analysis";
export type JsSourceResourceSource = "network" | "same-origin-fetch";
export type SourceMapCandidateSource = "response-header" | "x-source-map-header" | "source-mapping-url" | "inline";
export type SourceMapCandidateStatus = "available" | "fetchable" | "blocked" | "failed";

export interface ChatImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
}

export interface ChatNetworkContextAttachment {
  id: string;
  title: string;
  summary: string;
  requests: NetworkRequestDetail[];
  createdAt: number;
  redacted: boolean;
  truncated: boolean;
}

export interface ChatWebSearchResult {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score?: number;
  publishedDate?: string;
}

export interface ChatWebSearchPayload {
  provider: WebSearchProviderType;
  query: string;
  answer?: string;
  results: ChatWebSearchResult[];
  createdAt: number;
  truncated: boolean;
}

export interface ChatToolCallRecord {
  id: string;
  toolId: string;
  name: string;
  displayName: string;
  arguments: Record<string, unknown>;
  status: ChatToolCallStatus;
  startedAt: number;
  completedAt?: number;
  resultSummary?: string;
  errorMessage?: string;
  attachmentIds?: string[];
}

export interface ChatToolAttachmentBase {
  id: string;
  kind: string;
  title: string;
  summary: string;
  sourceToolCallId?: string;
  createdAt: number;
  redacted: boolean;
  truncated: boolean;
  retentionMode?: ToolAttachmentRetentionMode;
}

export interface ChatWebSearchToolAttachment extends ChatToolAttachmentBase {
  kind: "web-search";
  provider: WebSearchProviderType;
  query: string;
  answer?: string;
  results: ChatWebSearchResult[];
}

export interface ChatNetworkToolAttachment extends ChatToolAttachmentBase {
  kind: "network";
  fullAccess?: boolean;
  requests: NetworkRequestDetail[];
}

export interface JsSourceResource {
  id: string;
  source: JsSourceResourceSource;
  url: string;
  mimeType?: string;
  size: number;
  searchable: boolean;
  fetchedAt?: number;
  redacted: boolean;
  truncated: boolean;
}

export interface JsSourceMatch {
  resourceId: string;
  source: JsSourceResourceSource;
  url: string;
  term: string;
  position: number;
  line: number;
  column: number;
  snippet: string;
  redacted: boolean;
  truncated: boolean;
}

export interface JsSourceContext {
  resourceId: string;
  source: JsSourceResourceSource;
  url: string;
  position: number;
  line: number;
  column: number;
  snippet: string;
  redacted: boolean;
  truncated: boolean;
}

export interface JsSourceFetchFailure {
  url: string;
  message: string;
}

export interface ChatJsSourceToolAttachment extends ChatToolAttachmentBase {
  kind: "js-source";
  query?: string[];
  resources: JsSourceResource[];
  jsMatches: JsSourceMatch[];
  contexts: JsSourceContext[];
  failedFetches: JsSourceFetchFailure[];
}

export interface SourceMapCandidate {
  resourceId: string;
  resourceUrl: string;
  source: SourceMapCandidateSource;
  url?: string;
  inline: boolean;
  status: SourceMapCandidateStatus;
  parsed: boolean;
  message?: string;
}

export interface SourceMapResolvedLocation {
  resourceId: string;
  resourceUrl: string;
  generatedLine: number;
  generatedColumn: number;
  source?: string;
  originalLine?: number;
  originalColumn?: number;
  name?: string;
  ignored: boolean;
  hasSourceContent: boolean;
  message?: string;
}

export interface SourceMapOriginalContext extends SourceMapResolvedLocation {
  snippet?: string;
  redacted: boolean;
  truncated: boolean;
}

export interface ChatSourceMapToolAttachment extends ChatToolAttachmentBase {
  kind: "source-map";
  candidates: SourceMapCandidate[];
  resolvedLocations: SourceMapResolvedLocation[];
  originalContexts: SourceMapOriginalContext[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
}

export interface ChatBrowserScreenshotToolAttachment extends ChatToolAttachmentBase {
  kind: "browser-screenshot";
  mediaType: "image/png";
  dataUrl: string;
  target: "viewport" | "element";
  uid?: string;
  byteSize: number;
  clip?: { x: number; y: number; width: number; height: number; scale: number };
}

export interface AutomationPlaybookSelection {
  playbookId: string;
  title: string;
  source: AutomationPlaybookSource;
  confidence: AutomationPlaybookConfidence;
  reason: string;
}

export interface AutomationReportStep {
  toolCallId: string;
  toolName: string;
  displayName: string;
  status: ChatToolCallStatus;
  startedAt: number;
  completedAt?: number;
  evidence: string;
  attachmentKinds: string[];
}

export interface AutomationTimelineEvent {
  id: string;
  type: AutomationTimelineEventType;
  at: number;
  label: string;
  detail: string;
  toolCallId?: string;
  status?: ChatToolCallStatus;
}

export interface AutomationFailureSummary {
  failedStepCount: number;
  failedTools: string[];
  recoverableActions: string[];
}

export interface ChatAutomationReportToolAttachment extends ChatToolAttachmentBase {
  kind: "automation-report";
  reportType: AutomationReportType;
  objective: string;
  conclusion: string;
  playbook?: AutomationPlaybookSelection;
  steps: AutomationReportStep[];
  timeline: AutomationTimelineEvent[];
  failureSummary?: AutomationFailureSummary;
  fullAccessIncluded: boolean;
}

export interface ChatGenericToolAttachment extends ChatToolAttachmentBase {
  kind: string;
  details?: string;
}

export type ChatToolAttachment =
  | ChatWebSearchToolAttachment
  | ChatNetworkToolAttachment
  | ChatJsSourceToolAttachment
  | ChatSourceMapToolAttachment
  | ChatBrowserScreenshotToolAttachment
  | ChatAutomationReportToolAttachment
  | ChatGenericToolAttachment;

export interface ChatPromptInvocation {
  promptId: string;
  title: string;
  contentSnapshot: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  assistantMessageKind?: "tool_call_turn" | "context_summary";
  content: string;
  createdAt: number;
  modelId: string;
  endpointType: EndpointType;
  streamMode: boolean;
  systemPrompt: string;
  contextPrompt: string;
  contextMode: PageContextExtractMode;
  matchedRuleId?: string;
  attachments?: ChatImageAttachment[];
  networkContextAttachment?: ChatNetworkContextAttachment;
  toolCallRecords?: ChatToolCallRecord[];
  toolAttachmentIds?: string[];
  toolAttachments?: ChatToolAttachment[];
  promptInvocations?: ChatPromptInvocation[];
  thinking?: string;
  reasoningContent?: string;
  streaming?: boolean;
  tokenUsageEntryIds?: string[];
}
