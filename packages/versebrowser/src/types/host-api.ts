/**
 * Agent Browser host-api contract types.
 * Extracted verbatim from shared/host-api/contract.ts by line range:
 * - HostSuccess (source line 255)
 * - AgentBrowser* types (source lines 1020-1648)
 * - HostApiContract.agentBrowser method surface (source lines 5135-5203)
 */

import type {
  JsSourceResource,
  JsSourceMatch,
  JsSourceContext,
  JsSourceFetchFailure,
  SourceMapCandidate,
  SourceMapResolvedLocation,
  SourceMapOriginalContext,
} from '../core/types.ts';

export type HostSuccess = { success: boolean; error?: string };

export type AgentBrowserSessionMode = 'headless' | 'visible';
export type AgentBrowserAuthPersistenceMode = 'session-name' | 'profile' | 'off';
export type AgentBrowserConnectionMode = 'managed' | 'auto-connect' | 'cdp' | 'external-profile';
export type AgentBrowserRuntimeMode = 'normal_restricted' | 'controlled_enhanced' | 'full_access';
export type AgentBrowserConnectionSnapshot = {
  mode: AgentBrowserConnectionMode;
  cdpEndpoint?: string;
  externalProfile?: string;
  executablePath?: string;
};
/** Origin context for a browser session created from a ClawX workspace. */
export type AgentBrowserWorkspaceContext = {
  workspaceId?: string;
  sessionKey?: string;
  agentId?: string;
};
export type AgentBrowserSession = {
  id: string;
  profile: string;
  mode: AgentBrowserSessionMode;
  authPersistence?: AgentBrowserAuthPersistenceMode;
  authStateName?: string;
  connection?: AgentBrowserConnectionSnapshot;
  url?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  runtimeMode?: AgentBrowserRuntimeMode;
} & AgentBrowserWorkspaceContext;
export type AgentBrowserSecurityPayload = {
  authPersistence?: AgentBrowserAuthPersistenceMode;
  authStateName?: string;
  connectionMode?: AgentBrowserConnectionMode;
  cdpEndpoint?: string;
  externalProfile?: string;
  executablePath?: string;
  allowExternalBrowser?: boolean;
};
export type AgentBrowserOpenPayload = {
  url?: string;
  /**
   * Navigation readiness for the initial page. Omitted keeps the historical `load`; `dom-ready`
   * resolves on DOMContentLoaded so a page whose `load` never settles (heavy/large documents) can
   * still be observed. Mirrors AgentBrowserNavigatePayload.
   */
  waitUntil?: 'dom-ready' | 'load';
  profile?: string;
  mode?: AgentBrowserSessionMode;
  width?: number;
  height?: number;
  runtimeMode?: AgentBrowserRuntimeMode;
  /**
   * Standalone loopback CDP only. Desktop managed sessions reject this before
   * creating a window. Absent from the desktop host contract on purpose.
   */
  browser?: 'kitesurf';
} & AgentBrowserSecurityPayload & AgentBrowserWorkspaceContext;
export type AgentBrowserSessionPayload = {
  sessionId: string;
};

export type AgentBrowserPdfPayload = AgentBrowserSessionPayload & { printBackground?: boolean; landscape?: boolean; scale?: number; paperWidth?: number; paperHeight?: number; margin?: { top?: number; bottom?: number; left?: number; right?: number } };
export type AgentBrowserPdfResult = HostSuccess & { dataUrl: string; bytes: number; format: 'pdf' };
export type AgentBrowserNavigatePayload = AgentBrowserSessionPayload & {
  url: string;
  waitUntil?: 'dom-ready' | 'load';
};
export type AgentBrowserSelectorPayload = AgentBrowserSessionPayload & {
  selector: string;
  timeoutMs?: number;
};
export type AgentBrowserClickPayload = AgentBrowserSelectorPayload & { after?: 'popup' | 'download' | 'navigation' };
export type AgentBrowserDownloadPayload = AgentBrowserSelectorPayload & { path: string };
export type AgentBrowserDownloadResult = AgentBrowserActionResult & { pageId:string;file:{reference:string;bytes:number;mimeType:string|null};status:'completed' };
export type AgentBrowserUploadPayload = AgentBrowserSelectorPayload & { paths: string[] };
export type AgentBrowserUploadResult = AgentBrowserActionResult & { pageId: string; files: Array<{name:string;bytes:number}>; status:'assigned' };
export type AgentBrowserPointerPayload = AgentBrowserSessionPayload & {
  action: 'hover' | 'double-click' | 'right-click' | 'scroll' | 'scroll-into-view';
  selector?: string;
  deltaX?: number;
  deltaY?: number;
  timeoutMs?: number;
};
export type AgentBrowserDragPayload = AgentBrowserSessionPayload & {
  sourceSelector: string;
  targetSelector: string;
  timeoutMs?: number;
};
export type AgentBrowserTypePayload = AgentBrowserSelectorPayload & {
  text: string;
  clear?: boolean;
};
export type AgentBrowserEvaluatePayload = AgentBrowserSessionPayload & {
  expression: string;
};
export type AgentBrowserScreenshotPayload = AgentBrowserSessionPayload & {
  fullPage?: boolean;
  /** Optional unique CSS selector or current observation ref; requires declared driver support. */
  selector?: string;
  /** Optional one-time sensitive-capture grant id (P7-003). */
  grantId?: string;
};
/**
 * TF-0164: optional frame scope. Omitted or 'main' keeps the existing main-frame
 * behaviour byte-for-byte; any other value must resolve to a live frame owned by
 * this session's page, otherwise the call is refused (never guessed or fallen back).
 */
export type AgentBrowserFrameScope = { frameId?: string };
export type AgentBrowserTakeSnapshotPayload = AgentBrowserSessionPayload & AgentBrowserFrameScope & { selector?: string; paged?: boolean; cursor?: string };
/** Exact native locator constraints; name requires role. No script or selector DSL. */
export type AgentBrowserSemanticPayload = AgentBrowserSessionPayload & {
  action: 'observe' | 'extract';
  instruction: string;
  schema?: Record<string, unknown>;
  timeoutMs?: number;
};
export type AgentBrowserSemanticResult = AgentBrowserActionResult & {
  value: unknown;
  source: { sessionId: string; pageId: string; frameId: 'main'; observationId: string; url: string };
  model: { modelId: string; usageComplete: boolean; calls: Array<{ status: string; durationMs: number; usage: null | {input:number;output:number;total:number;reasoning?:number;cachedInput?:number} }> };
};
export type AgentBrowserFindPayload = AgentBrowserSessionPayload & {
  role?: string;
  name?: string;
  label?: string;
  testId?: string;
  timeoutMs?: number;
};
export type AgentBrowserFindResult = AgentBrowserActionResult & {
  match: 'none' | 'unique' | 'ambiguous';
  count: number;
  scope: { sessionId: string; pageId: string; frameId: string; observationId: string };
  item?: AgentBrowserSnapshotItem;
  details?: { tag: string; sourceUrl: string; trust: 'untrusted'; required?: boolean; readOnly?: boolean; disabled?: boolean; value?: string; checked?: boolean; selectedValues?: string[]; valueRedacted?: boolean; truncated?: boolean; name?: string | null; type?: string | null; label?: string; form?: {id:string|null;name:string|null;documentIndex?:number}|null; constraints?: Record<string,string|null>; validity?: Record<string,boolean>; validitySource?: string; errors?: Array<{id:string;text?:string;missing?:boolean;source:string}>; descriptions?: Array<{id:string;text?:string;missing?:boolean;source:string}>; ariaInvalid?: string|null; options?: Array<{value:string;label:string;selected:boolean;disabled:boolean}>; optionsTruncated?:boolean; serverValidation?: 'unknown' };
};
export type AgentBrowserClickByUidPayload = AgentBrowserSessionPayload & {
  uid: string;
};
export type AgentBrowserFillByUidPayload = AgentBrowserSessionPayload & {
  uid: string;
  value: string;
  clear?: boolean;
};
export type AgentBrowserPressKeyPayload = AgentBrowserSessionPayload & {
  key: string;
  /** Optional element to focus first; omitted means press on the current focus. */
  selector?: string;
};
export type AgentBrowserRequestModeUpgradePayload = AgentBrowserSessionPayload & {
  targetMode: AgentBrowserRuntimeMode;
  reason?: string;
  expiresInMs?: number;
  /** Required true for upgrades above normal_restricted (user approval gate). */
  userApproval?: boolean;
};
export type AgentBrowserRequestModeUpgradeResult = AgentBrowserActionResult & {
  runtimeMode: AgentBrowserRuntimeMode;
  expiresAt?: string;
};
export type AgentBrowserRespondBoundaryChoicePayload = AgentBrowserSessionPayload & {
  requestId: string;
  selectedChoiceIds: string[];
  otherText?: string;
};
export type AgentBrowserRespondBoundaryChoiceResult = HostSuccess & {
  accepted: boolean;
};
export type AgentBrowserCommandPayload = Partial<AgentBrowserSessionPayload> & {
  args: string[];
  globalOptions?: string[];
  profile?: string;
  mode?: AgentBrowserSessionMode;
  timeoutMs?: number;
  maxOutput?: number;
  /** Optional one-time sensitive-capture grant id (P7-003). */
  grantId?: string;
} & AgentBrowserSecurityPayload;
export type AgentBrowserProfileEntry = {
  profile: string;
  label?: string;
  description?: string;
  authStateName?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
  activeSessions?: number;
  source: 'metadata' | 'profile-dir' | 'session';
};
export type AgentBrowserProfilesResult = HostSuccess & {
  profiles: AgentBrowserProfileEntry[];
};
export type AgentBrowserProfileSavePayload = {
  profile: string;
  label?: string;
  description?: string;
  authStateName?: string;
};
export type AgentBrowserProfileSaveResult = HostSuccess & {
  profile: AgentBrowserProfileEntry;
};
export type AgentBrowserValidatePayload = AgentBrowserOpenPayload & {
  /** R5-1: canonical run id (e.g. `cron:<jobId>:<startedAt>`). When provided, validate() records it verbatim instead of minting a new UUID. */
  runId?: string;
  expectedDomains?: string[];
  diagnostics?: {
    snapshot?: boolean;
    console?: boolean;
    errors?: boolean;
    network?: boolean;
    screenshot?: boolean;
  };
};
export type AgentBrowserArtifactKind = 'snapshot' | 'console' | 'errors' | 'network' | 'screenshot' | 'text' | 'manifest';
export type AgentBrowserArtifactRef = {
  id: string;
  kind: AgentBrowserArtifactKind;
  label: string;
  path?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
};
export type BrowserAutomationRunStep = {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  detail?: string;
  startedAt?: string;
  endedAt?: string;
};
export type BrowserAutomationRunResult = {
  schemaVersion: 1;
  runId: string;
  status: 'success' | 'failed';
  startedAt: string;
  endedAt: string;
  profile?: string;
  authStateName?: string;
  finalUrl?: string;
  title?: string;
  loginState: 'unknown' | 'authenticated' | 'login-required';
  steps: BrowserAutomationRunStep[];
  evidence: {
    textSample?: string;
    artifacts: AgentBrowserArtifactRef[];
  };
  consoleErrors?: string[];
  networkErrors?: string[];
  error?: string;
};
export type AgentBrowserValidateResult = HostSuccess & {
  ok: boolean;
  session?: AgentBrowserSession;
  url?: string;
  title?: string;
  textSample?: string;
  screenshotDataUrl?: string;
  diagnostics?: Record<string, unknown>;
  runResult?: BrowserAutomationRunResult;
  error?: string;
};
export type AgentBrowserPendingDialogNavigation = { dialogId: string; pageId: string; requestedUrl: string; navigationStarted: boolean };
export type AgentBrowserSessionResult = HostSuccess & {
  pendingDialog?: AgentBrowserPendingDialogNavigation;
  session: AgentBrowserSession;
  textSample?: string;
};
export type AgentBrowserStatusResult = HostSuccess & {
  sessions: AgentBrowserSession[];
  browserControlEnabled?: boolean;
};
export type AgentBrowserSetEnabledPayload = {
  enabled: boolean;
};
export type AgentBrowserSetEnabledResult = HostSuccess & {
  enabled: boolean;
};
export type AgentBrowserActionResult = HostSuccess & {
  pendingDialog?: AgentBrowserPendingDialogNavigation;
  session: AgentBrowserSession;
  observation?: { changed: true | 'unknown'; beforeUrl: string; afterUrl: string; sinceCursor: string; networkObserved: number; scope: 'session-window'; businessOutcome: 'unknown'; events?: Array<{type:string}>; eventsTruncated?:boolean };
  fieldChange?: {
    before: { value?: string; checked?: boolean; selectedValues?: string[]; valueRedacted?: boolean; truncated?: boolean };
    after?: { value?: string; checked?: boolean; selectedValues?: string[]; valueRedacted?: boolean; truncated?: boolean };
    changed: boolean | 'unknown';
    stateUnavailable?: boolean;
  };
};
export type AgentBrowserEvaluateResult = AgentBrowserActionResult & {
  value?: unknown;
};
export type AgentBrowserScreenshotMetrics = {
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  devicePixelRatio: number;
};
export type AgentBrowserScreenshotResult = AgentBrowserActionResult & {
  dataUrl: string;
  format: 'png';
  capture?: {
    kind: 'viewport' | 'fullPage' | 'element';
    pageId?: string;
    pixels?: { width: number; height: number };
    /** Stable means equal measurements around capture, not an atomic or visually accepted page. */
    metrics: { state: 'stable' | 'changed' | 'unavailable'; before?: AgentBrowserScreenshotMetrics; after?: AgentBrowserScreenshotMetrics };
  };
};
export type AgentBrowserSnapshotItem = {
  ref: string;
  value?: string;
  valueRedacted?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  checked?: boolean | 'mixed';
  selected?: boolean;
  tag?: string;
  role?: string;
  name?: string;
  href?: string;
  /**
   * TF-0107: disclosure state (`aria-expanded`) and the panel it toggles
   * (`aria-controls`), when the element carries them. Absent otherwise, so a
   * driver/host that does not report ARIA state is indistinguishable from a page
   * that has none.
   */
  expanded?: boolean;
  controls?: string;
};

export type AgentBrowserTakeSnapshotResult = AgentBrowserActionResult & {
  snapshot: string;
  page?: { observationId: string; offset: number; total: number; truncated: boolean; nextCursor?: string; source: string };
  /**
   * Structured interactive items when the driver can provide them. Optional, so
   * a host-injected driver may omit it — TF-0102 then diffs only the page facts
   * parsed out of `snapshot`.
   */
  items?: AgentBrowserSnapshotItem[];
};
export type AgentBrowserNetworkFilter = {
  urlIncludes?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  limit?: number;
  timeoutMs?: number;
};
export type AgentBrowserNetworkListPayload = AgentBrowserSessionPayload & {
  filter?: AgentBrowserNetworkFilter;
  redacted?: boolean;
};
export type AgentBrowserNetworkListResult = HostSuccess & {
  collection?: 'ok' | 'degraded';
  collectionError?: string;
  /** Opaque observation cursor; absent when this driver cannot provide one. */
  cursor?: string;
  /** Offset of the current document in an unfiltered observation list. */
  currentPageStart?: number;
  requests: Array<{
    id: string;
    url: string;
    method: string;
    status?: number;
    statusText?: string;
    mimeType?: string;
    resourceType?: string;
    failed?: boolean;
    error?: string;
  }>;
};
export type AgentBrowserNetworkDetailPayload = AgentBrowserSessionPayload & {
  requestIds: string[];
  redacted?: boolean;
};
export type AgentBrowserNetworkDetailResult = HostSuccess & {
  details: unknown[];
};
export type AgentBrowserNetworkClearPayload = AgentBrowserSessionPayload;
export type AgentBrowserNetworkClearResult = HostSuccess;
export type AgentBrowserNetworkWaitPayload = AgentBrowserSessionPayload & {
  /** Require a matching response transfer to finish, not merely response headers. */
  responseComplete?: boolean;
  /** Include already captured observations after this cursor; never reuse across sessions or reattachment. */
  sinceCursor?: string;
  filter?: AgentBrowserNetworkFilter;
  redacted?: boolean;
  /** How long to wait for a match / for the page to go quiet. Default 5000, cap 30000. */
  timeoutMs?: number;
};
export type AgentBrowserNetworkWaitResult = AgentBrowserNetworkListResult & { responseComplete?: boolean };
export type AgentBrowserNetworkComparePayload = AgentBrowserSessionPayload & {
  requestIds: string[];
  redacted?: boolean;
};
export type AgentBrowserNetworkCompareResult = HostSuccess & {
  comparison: string;
};
export type AgentBrowserNetworkFindParamsPayload = AgentBrowserSessionPayload & {
  requestIds: string[];
  redacted?: boolean;
};
export type AgentBrowserNetworkFindParamsResult = HostSuccess & {
  candidates: string;
};
export type AgentBrowserNetworkExtractJsPayload = AgentBrowserSessionPayload & {
  requestIds?: string[];
  keywords?: string[];
  urlIncludes?: string;
  redacted?: boolean;
};
export type AgentBrowserNetworkExtractJsResult = HostSuccess & {
  candidates: string;
};
export type AgentBrowserJsListResourcesPayload = AgentBrowserSessionPayload;
export type AgentBrowserJsListResourcesResult = HostSuccess & {
  resources: JsSourceResource[];
  content: string;
};
export type AgentBrowserJsSearchSourcesPayload = AgentBrowserSessionPayload & {
  keywords: string[];
  urls?: string[];
  limit?: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserJsSearchSourcesResult = HostSuccess & {
  resources: JsSourceResource[];
  matches: JsSourceMatch[];
  failedFetches: JsSourceFetchFailure[];
  truncated: boolean;
  content: string;
};
export type AgentBrowserJsExtractContextPayload = AgentBrowserSessionPayload & {
  resourceId: string;
  position: number;
};
export type AgentBrowserJsExtractContextResult = HostSuccess & {
  resources: JsSourceResource[];
  contexts: JsSourceContext[];
  truncated: boolean;
  content: string;
};
export type AgentBrowserSourceMapListCandidatesPayload = AgentBrowserSessionPayload & {
  resourceIds?: string[];
  limit?: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserSourceMapListCandidatesResult = HostSuccess & {
  candidates: SourceMapCandidate[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
  truncated: boolean;
  content: string;
};
export type AgentBrowserSourceMapResolveLocationPayload = AgentBrowserSessionPayload & {
  resourceId: string;
  line: number;
  column: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserSourceMapResolveLocationResult = HostSuccess & {
  candidates: SourceMapCandidate[];
  resolvedLocations: SourceMapResolvedLocation[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
  content: string;
};
export type AgentBrowserSourceMapExtractOriginalContextPayload = AgentBrowserSessionPayload & {
  resourceId: string;
  line: number;
  column: number;
  radius?: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserSourceMapExtractOriginalContextResult = HostSuccess & {
  candidates: SourceMapCandidate[];
  resolvedLocations: SourceMapResolvedLocation[];
  originalContexts: SourceMapOriginalContext[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
  truncated: boolean;
  content: string;
};
export type AgentBrowserRuntimeInspectGlobalsPayload = AgentBrowserSessionPayload & {
  paths: string[];
  maxDepth?: number;
  limit?: number;
};
export type AgentBrowserRuntimeInspectGlobalsResult = HostSuccess & {
  content: string;
  isError?: boolean;
  /** TF-0105: summary flags (also present in the content header). */
  redacted?: boolean;
  truncated?: boolean;
};
export type AgentBrowserRuntimeSearchModulesPayload = AgentBrowserSessionPayload & {
  keywords: string[];
  limit?: number;
  radius?: number;
};
export type AgentBrowserRuntimeSearchModulesResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserRuntimeDescribeFunctionPayload = AgentBrowserSessionPayload & {
  path: string;
  keywords?: string[];
  radius?: number;
};
export type AgentBrowserRuntimeDescribeFunctionResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserReplayPrepareRequestPayload = AgentBrowserSessionPayload & {
  requestId: string;
};
export type AgentBrowserReplayPrepareRequestResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserReplaySendRequestPayload = AgentBrowserSessionPayload & {
  draftId: string;
};
export type AgentBrowserReplaySendRequestResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserReplayCompareResponsesPayload = AgentBrowserSessionPayload & {
  draftId: string;
};
export type AgentBrowserReplayCompareResponsesResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserConsoleMessagesPayload = AgentBrowserSessionPayload;
export type AgentBrowserConsoleMessagesResult = HostSuccess & {
  collection?: 'ok' | 'degraded';
  collectionError?: string;
  content: string;
  /** Offset in the formatted console lines where the current document starts. */
  currentPageStart?: number;
};
export type AgentBrowserFullAccessExecuteScriptPayload = AgentBrowserSessionPayload & {
  script: string;
  awaitPromise?: boolean;
};
export type AgentBrowserFullAccessExecuteScriptResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserFullAccessFetchPayload = AgentBrowserSessionPayload & {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: 'include' | 'same-origin' | 'omit';
};
export type AgentBrowserFullAccessFetchResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserFullAccessGetNetworkDetailsPayload = AgentBrowserSessionPayload & {
  requestIds: string[];
};
export type AgentBrowserFullAccessGetNetworkDetailsResult = HostSuccess & {
  content: string;
  isError?: boolean;
  toolAttachments?: unknown[];
};
export type AgentBrowserFullAccessReadStoragePayload = AgentBrowserSessionPayload;
export type AgentBrowserFullAccessReadStorageResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserFullAccessRevokePayload = AgentBrowserSessionPayload;
export type AgentBrowserFullAccessRevokeResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserExtractPageTextRule = {
  id: string;
  alias: string;
  urlPattern: string;
  selectorsText: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};
export type AgentBrowserExtractPageTextPayload = AgentBrowserSessionPayload & {
  metadata?: boolean;
  rows?: { selector: string; fields: Record<string, { selector?: string; attribute?: string }>; limit?: number };
  structured?: boolean;
  rules: AgentBrowserExtractPageTextRule[];
  maxLength?: number;
  extractMode?: 'text' | 'all';
  selectorType?: 'css' | 'xpath';
  allowFallback?: boolean;
  /**
   * TF-0164: read inside this frame scope. Omitted or "main" keeps the page frame. The value
   * must be a frameId the page inventory reports; an unknown or unauthorized frame is
   * refused rather than falling back to the main frame.
   */
  frameId?: string;
};
export type AgentBrowserExtractPageTextResult = HostSuccess & {
  observation?: { sessionId: string; pageId: string; frameId: string; observationId: string; capturedAt: string };
  text: string;
  sourceUrl?: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
};
export type AgentBrowserValidateExtractionRulePayload = {
  alias: string;
  urlPattern: string;
  selectorsText: string;
};
export type AgentBrowserValidateExtractionRuleResult = HostSuccess & {
  ok: boolean;
  message?: string;
};
/**
 * TF-0164: one child frame of a page, using the same `f<n>` numbering the upstream snapshot
 * applies to frame-scoped refs (`f<n>e<m>`). The page own main frame is not listed here.
 */
export type AgentBrowserFrameInfo = {
  frameId: string;
  index: number;
  url: string;
  name: string;
  /** True when this frame origin is inside the session authorized origin set. */
  authorized: boolean;
};
export type AgentBrowserPageInfo = {
  titleUnavailable?: boolean;
  /** Popup source when known within this session. */
  openerPageId?: string;
  pageId: string;
  index: number;
  url: string;
  title: string;
  active: boolean;
  /** TF-0164: child frames of this page, main frame excluded. */
  frames?: AgentBrowserFrameInfo[];
};
export type AgentBrowserDialogInfo = {
  dialogId: string;
  pageId: string;
  type: string;
  message: string;
  defaultValue?: string;
  truncated?: boolean;
  responseState: 'pending' | 'responding' | 'unknown';
};
export type AgentBrowserDialogsResult = HostSuccess & { dialogs: AgentBrowserDialogInfo[] };
export type AgentBrowserDialogResponsePayload = AgentBrowserSessionPayload & { dialogId: string; accept: boolean; promptText?: string };
export type AgentBrowserDialogResponseResult = HostSuccess & { dialogId: string; pageId: string; accepted: boolean };
export type AgentBrowserNewPagePayload = AgentBrowserSessionPayload & {
  url?: string;
  background?: boolean;
};
export type AgentBrowserSelectPagePayload = AgentBrowserSessionPayload & {
  pageId: string;
};
export type AgentBrowserClosePagePayload = AgentBrowserSessionPayload & {
  pageId?: string;
};
export type AgentBrowserNavigatePagePayload = AgentBrowserSessionPayload & {
  url: string;
  pageId?: string;
  waitUntil?: 'dom-ready' | 'load';
};
export type AgentBrowserListPagesResult = AgentBrowserActionResult & {
  createdPageId?: string;
  closedPageId?: string;
  pages: AgentBrowserPageInfo[];
  activePageId?: string;
};
export type AgentBrowserCommandResult = HostSuccess & {
  session?: AgentBrowserSession;
  data?: unknown;
  stdout: string;
  stderr: string;
  command: string[];
};
export type AgentBrowserTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type AgentBrowserTaskRecovery = {
  recoveredFrom: AgentBrowserTaskStatus;
  reason: 'app-restart-while-running';
  recoveredAt: string;
};
export type AgentBrowserTaskStepAction = 'navigate' | 'wait-for-selector' | 'click';
export type AgentBrowserTaskStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
export type AgentBrowserTaskStepInput = {
  action: AgentBrowserTaskStepAction;
  url?: string;
  selector?: string;
  timeoutMs?: number;
};
export type AgentBrowserTaskStep = AgentBrowserTaskStepInput & {
  id: string;
  status: AgentBrowserTaskStepStatus;
  startedAt?: string;
  endedAt?: string;
  errorCode?: string;
  error?: string;
};
export type AgentBrowserTaskSuccessCriteria = {
  kind: 'url-includes' | 'text-includes' | 'selector-visible';
  value: string;
  timeoutMs?: number;
};
export type AgentBrowserTaskVerification = AgentBrowserTaskSuccessCriteria & {
  status: 'passed' | 'failed';
  reasonCode: string;
  message: string;
  checkedAt: string;
};
export type AgentBrowserTaskApproval = {
  status: 'pending' | 'approved' | 'consumed' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  consumedAt?: string;
};
export type AgentBrowserTaskCounters = {
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
};
export type AgentBrowserTask = {
  id: string;
  name: string;
  url: string;
  objective: string;
  successCondition?: string;
  profile: string;
  mode: AgentBrowserSessionMode;
  allowedDomains: string[];
  permissionScope: Array<'navigate' | 'read-page' | 'interact-page'>;
  steps: AgentBrowserTaskStep[];
  successCriteria?: AgentBrowserTaskSuccessCriteria;
  verification?: AgentBrowserTaskVerification;
  approval: AgentBrowserTaskApproval;
  counters: AgentBrowserTaskCounters;
  status: AgentBrowserTaskStatus;
  statusExplain?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  runId?: string;
  errorCode?: string;
  error?: string;
  recovery?: AgentBrowserTaskRecovery;
} & AgentBrowserWorkspaceContext;
export type AgentBrowserTaskCreatePayload = Pick<
  AgentBrowserTask,
  'name' | 'url' | 'objective' | 'successCondition' | 'profile' | 'mode'
> & {
  allowedDomains?: string[];
  steps?: AgentBrowserTaskStepInput[];
  successCriteria?: AgentBrowserTaskSuccessCriteria;
} & AgentBrowserWorkspaceContext;
export type AgentBrowserTaskPayload = { taskId: string };
export type AgentBrowserTasksResult = HostSuccess & { tasks: AgentBrowserTask[] };
export type AgentBrowserTaskResult = HostSuccess & { task: AgentBrowserTask };
export type AgentBrowserCredentialMetadata = {
  id: string;
  profile: string;
  origin: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};
export type AgentBrowserVaultState =
  | 'not_configured'
  | 'ready'
  | 'corrupted'
  | 'encryption_unavailable';
export type AgentBrowserVaultHealth = {
  state: AgentBrowserVaultState;
  path: string;
  credentialCount: number;
  errorCode?: 'VAULT_NOT_CONFIGURED' | 'VAULT_CORRUPTED' | 'VAULT_ENCRYPTION_UNAVAILABLE';
  errorMessage?: string;
};
export type AgentBrowserVaultHealthResult = HostSuccess & {
  health: AgentBrowserVaultHealth;
};
export type AgentBrowserCredentialSavePayload = {
  id?: string;
  profile: string;
  origin: string;
  username: string;
  password: string;
};
export type AgentBrowserCredentialPayload = { credentialId: string };
export type AgentBrowserVaultResult = HostSuccess & {
  credentials: AgentBrowserCredentialMetadata[];
};
export type AgentBrowserCredentialResult = HostSuccess & {
  credential: AgentBrowserCredentialMetadata;
};

/**
 * Host service method surface for agentBrowser module.
 * Extracted from CompleteHostServiceRegistry['agentBrowser'] (contract.ts:5135-5203).
 */

/**
 * MaybePromise + HostServiceModule wrapping matches electron/main/ipc/host-contract.ts
 * CompleteHostServiceRegistry mapping so async host methods type-check.
 */
type MaybePromise<T> = T | Promise<T>;
type HostServiceFunction<TFunction> = TFunction extends (...args: infer Args) => infer Result
  ? (...args: Args) => MaybePromise<Awaited<Result>>
  : never;
type HostServiceModule<TModule> = {
  [A in keyof TModule]: HostServiceFunction<TModule[A]>;
};

/**
 * Host service method surface for agentBrowser module (raw contract).
 * Extracted from HostApiContract['agentBrowser'] (contract.ts:5135-5203).
 */
type AgentBrowserHostApiContract = {
    /** In-process cancellation; never supplied through serialized tool arguments. */
    open: (payload?: AgentBrowserOpenPayload, options?: { signal?: AbortSignal }) => AgentBrowserSessionResult;
    status: () => AgentBrowserStatusResult;
    setEnabled: (payload: AgentBrowserSetEnabledPayload) => AgentBrowserSetEnabledResult;
    profiles: () => AgentBrowserProfilesResult;
    saveProfile: (payload: AgentBrowserProfileSavePayload) => AgentBrowserProfileSaveResult;
    validate: (payload?: AgentBrowserValidatePayload) => AgentBrowserValidateResult;
    navigate: (payload: AgentBrowserNavigatePayload) => AgentBrowserActionResult;
    focus: (payload: AgentBrowserSessionPayload) => AgentBrowserActionResult;
    waitForSelector: (payload: AgentBrowserSelectorPayload) => AgentBrowserActionResult;
    click: (payload: AgentBrowserClickPayload) => AgentBrowserActionResult;
    downloadFile?: (payload: AgentBrowserDownloadPayload) => AgentBrowserDownloadResult;
    uploadFiles?: (payload: AgentBrowserUploadPayload) => AgentBrowserUploadResult;
    pointer?: (payload: AgentBrowserPointerPayload) => AgentBrowserActionResult;
    drag?: (payload: AgentBrowserDragPayload) => AgentBrowserActionResult;
    type: (payload: AgentBrowserTypePayload) => AgentBrowserActionResult;
    selectOption?: (payload: AgentBrowserSelectorPayload & { label: string }) => AgentBrowserActionResult;
    selectValues?: (payload: AgentBrowserSelectorPayload & { values: string[] }) => AgentBrowserActionResult;
    appendText?: (payload: AgentBrowserTypePayload) => AgentBrowserActionResult;
    setChecked?: (payload: AgentBrowserSelectorPayload & { checked: boolean }) => AgentBrowserActionResult;
    evaluate: (payload: AgentBrowserEvaluatePayload) => AgentBrowserEvaluateResult;
    pdf?: (payload: AgentBrowserPdfPayload) => AgentBrowserPdfResult;
    screenshot: (payload: AgentBrowserScreenshotPayload) => AgentBrowserScreenshotResult;
    command: (payload: AgentBrowserCommandPayload) => AgentBrowserCommandResult;
    tasks: () => AgentBrowserTasksResult;
    createTask: (payload: AgentBrowserTaskCreatePayload) => AgentBrowserTaskResult;
    runTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    retryTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    cancelTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    requestTaskApproval: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    approveTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    rejectTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    show: (payload: AgentBrowserSessionPayload) => AgentBrowserActionResult;
    hide: (payload: AgentBrowserSessionPayload) => AgentBrowserActionResult;
    vault: () => AgentBrowserVaultResult;
    vaultHealth: () => AgentBrowserVaultHealthResult;
    saveCredential: (payload: AgentBrowserCredentialSavePayload) => AgentBrowserCredentialResult;
    deleteCredential: (payload: AgentBrowserCredentialPayload) => HostSuccess;
    close: (payload: AgentBrowserSessionPayload) => HostSuccess;
    takeSnapshot: (payload: AgentBrowserTakeSnapshotPayload) => AgentBrowserTakeSnapshotResult;
    findElement?: (payload: AgentBrowserFindPayload) => AgentBrowserFindResult;
    semanticRead?: (payload: AgentBrowserSemanticPayload, options?: { signal?: AbortSignal }) => AgentBrowserSemanticResult;
    readForms?: (payload: AgentBrowserSessionPayload & {selector?:string}) => HostSuccess & { fields: unknown[]; scope: {pageId:string;frameId:string;observationId:string}; trust:string };
    clickByUid: (payload: AgentBrowserClickByUidPayload) => AgentBrowserActionResult;
    fillByUid: (payload: AgentBrowserFillByUidPayload) => AgentBrowserActionResult;
    pressKey: (payload: AgentBrowserPressKeyPayload) => AgentBrowserActionResult;
    requestModeUpgrade: (payload: AgentBrowserRequestModeUpgradePayload) => AgentBrowserRequestModeUpgradeResult;
    respondBoundaryChoice: (payload: AgentBrowserRespondBoundaryChoicePayload) => AgentBrowserRespondBoundaryChoiceResult;
    networkListRequests: (payload: AgentBrowserNetworkListPayload) => AgentBrowserNetworkListResult;
    networkGetRequestDetails: (payload: AgentBrowserNetworkDetailPayload) => AgentBrowserNetworkDetailResult;
    networkClearRequests: (payload: AgentBrowserNetworkClearPayload) => AgentBrowserNetworkClearResult;
    networkWaitForRequests: (payload: AgentBrowserNetworkWaitPayload) => AgentBrowserNetworkWaitResult;
    networkCompareRequests: (payload: AgentBrowserNetworkComparePayload) => AgentBrowserNetworkCompareResult;
    networkFindParameterCandidates: (payload: AgentBrowserNetworkFindParamsPayload) => AgentBrowserNetworkFindParamsResult;
    networkExtractJsCandidates: (payload: AgentBrowserNetworkExtractJsPayload) => AgentBrowserNetworkExtractJsResult;
    newPage: (payload: AgentBrowserNewPagePayload) => AgentBrowserListPagesResult;
    listPages: (payload: AgentBrowserSessionPayload) => AgentBrowserListPagesResult;
    readDialogs?: (payload: AgentBrowserSessionPayload) => AgentBrowserDialogsResult;
    respondDialog?: (payload: AgentBrowserDialogResponsePayload) => AgentBrowserDialogResponseResult;
    selectPage: (payload: AgentBrowserSelectPagePayload) => AgentBrowserListPagesResult;
    closePage: (payload: AgentBrowserClosePagePayload) => AgentBrowserListPagesResult;
    navigatePage: (payload: AgentBrowserNavigatePagePayload) => AgentBrowserListPagesResult;
    jsListResources: (payload: AgentBrowserJsListResourcesPayload) => AgentBrowserJsListResourcesResult;
    jsSearchSources: (payload: AgentBrowserJsSearchSourcesPayload) => AgentBrowserJsSearchSourcesResult;
    jsExtractContext: (payload: AgentBrowserJsExtractContextPayload) => AgentBrowserJsExtractContextResult;
    sourceMapListCandidates: (payload: AgentBrowserSourceMapListCandidatesPayload) => AgentBrowserSourceMapListCandidatesResult;
    sourceMapResolveLocation: (payload: AgentBrowserSourceMapResolveLocationPayload) => AgentBrowserSourceMapResolveLocationResult;
    sourceMapExtractOriginalContext: (payload: AgentBrowserSourceMapExtractOriginalContextPayload) => AgentBrowserSourceMapExtractOriginalContextResult;
    runtimeInspectGlobals: (payload: AgentBrowserRuntimeInspectGlobalsPayload) => AgentBrowserRuntimeInspectGlobalsResult;
    runtimeSearchModules: (payload: AgentBrowserRuntimeSearchModulesPayload) => AgentBrowserRuntimeSearchModulesResult;
    runtimeDescribeFunction: (payload: AgentBrowserRuntimeDescribeFunctionPayload) => AgentBrowserRuntimeDescribeFunctionResult;
    replayPrepareRequest: (payload: AgentBrowserReplayPrepareRequestPayload) => AgentBrowserReplayPrepareRequestResult;
    replaySendRequest: (payload: AgentBrowserReplaySendRequestPayload) => AgentBrowserReplaySendRequestResult;
    replayCompareResponses: (payload: AgentBrowserReplayCompareResponsesPayload) => AgentBrowserReplayCompareResponsesResult;
    getConsoleMessages: (payload: AgentBrowserConsoleMessagesPayload) => AgentBrowserConsoleMessagesResult;
    fullAccessExecuteScript: (payload: AgentBrowserFullAccessExecuteScriptPayload) => AgentBrowserFullAccessExecuteScriptResult;
    fullAccessFetch: (payload: AgentBrowserFullAccessFetchPayload) => AgentBrowserFullAccessFetchResult;
    fullAccessGetNetworkDetails: (payload: AgentBrowserFullAccessGetNetworkDetailsPayload) => AgentBrowserFullAccessGetNetworkDetailsResult;
    fullAccessReadStorage: (payload: AgentBrowserFullAccessReadStoragePayload) => AgentBrowserFullAccessReadStorageResult;
    fullAccessRevoke: (payload: AgentBrowserFullAccessRevokePayload) => AgentBrowserFullAccessRevokeResult;
    extractPageText: (payload: AgentBrowserExtractPageTextPayload) => AgentBrowserExtractPageTextResult;
    validateExtractionRule: (payload: AgentBrowserValidateExtractionRulePayload) => AgentBrowserValidateExtractionRuleResult;
};

/**
 * Async-capable host API surface (CompleteHostServiceRegistry equivalent).
 */
export type AgentBrowserHostApi = HostServiceModule<AgentBrowserHostApiContract>;
