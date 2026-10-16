/** Lightweight telemetry fragments emitted by the agent_browser tool. */

export type AgentBrowserCorrelation = {
  gatewayRequestId?: string;
  runId?: string;
  sessionKey?: string;
  agentSessionKey?: string;
  agentSessionId?: string;
  toolCallId?: string;
  taskId?: string;
  pageId?: string;
  workspaceId?: string;
  agentId?: string;
};

export type AgentBrowserAutomationEvent = AgentBrowserCorrelation & {
  schemaVersion: 1;
  tool: "agent_browser";
  action: string;
  ok: boolean;
  ts: number;
  sessionId?: string;
  profile?: string;
  authStateName?: string;
  mode?: string;
  url?: string;
  finalUrl?: string;
  title?: string;
  textSample?: string;
  screenshotDataUrl?: string;
  command?: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => optionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? entries : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function buildAgentBrowserAutomationEvent(params: {
  action: string;
  payload: Record<string, unknown>;
  result: unknown;
  ok?: boolean;
  error?: unknown;
  correlation?: AgentBrowserCorrelation;
}): AgentBrowserAutomationEvent {
  const result = asRecord(params.result) ?? {};
  const session = asRecord(result.session) ?? {};
  const correlation = params.correlation ?? {};
  const resultData = asRecord(result.data) ?? {};
  const event: AgentBrowserAutomationEvent = {
    schemaVersion: 1,
    tool: "agent_browser",
    action: params.action,
    ok: params.ok ?? result.success !== false,
    ts: Date.now(),
  };
  const sessionId = firstString(session.id, params.payload.sessionId);
  const pageId = firstString(
    correlation.pageId,
    result.pageId,
    resultData.activePageId,
    params.payload.pageId,
  );
  const profile = firstString(session.profile, params.payload.profile);
  const authStateName = firstString(session.authStateName, params.payload.authStateName);
  const mode = firstString(session.mode, params.payload.mode);
  const finalUrl = firstString(session.url, result.url, params.payload.url);
  const title = firstString(session.title, result.title);
  const textSample = firstString(result.textSample);
  const screenshotDataUrl = firstString(result.dataUrl, result.screenshotDataUrl);
  const command = optionalStringArray(result.command) ?? optionalStringArray(params.payload.args);
  const stdout = firstString(result.stdout);
  const stderr = firstString(result.stderr);
  const error = firstString(params.error, result.error, asRecord(result.error)?.message);
  if (sessionId) event.sessionId = sessionId;
  if (pageId) event.pageId = pageId;
  if (correlation.gatewayRequestId) event.gatewayRequestId = correlation.gatewayRequestId;
  if (correlation.runId) event.runId = correlation.runId;
  if (correlation.sessionKey) event.sessionKey = correlation.sessionKey;
  if (correlation.agentSessionKey) event.agentSessionKey = correlation.agentSessionKey;
  if (correlation.agentSessionId) event.agentSessionId = correlation.agentSessionId;
  if (correlation.toolCallId) event.toolCallId = correlation.toolCallId;
  if (correlation.taskId) event.taskId = correlation.taskId;
  if (correlation.workspaceId) event.workspaceId = correlation.workspaceId;
  if (correlation.agentId) event.agentId = correlation.agentId;
  if (profile) event.profile = profile;
  if (authStateName) event.authStateName = authStateName;
  if (mode) event.mode = mode;
  if (optionalString(params.payload.url)) event.url = optionalString(params.payload.url);
  if (finalUrl) event.finalUrl = finalUrl;
  if (title) event.title = title;
  if (textSample) event.textSample = textSample.slice(0, 4000);
  if (screenshotDataUrl) event.screenshotDataUrl = screenshotDataUrl;
  if (command) event.command = command;
  if (stdout) event.stdout = stdout.slice(0, 4000);
  if (stderr) event.stderr = stderr.slice(0, 4000);
  if (error) event.error = error.slice(0, 2000);
  return event;
}

export function readAgentBrowserAutomationEvent(value: unknown): AgentBrowserAutomationEvent | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const source = asRecord(record.browserAutomationEvent) ?? asRecord(record._browserAutomationEvent);
  if (!source) {
    return null;
  }
  if (
    source.schemaVersion !== 1 ||
    source.tool !== "agent_browser" ||
    typeof source.action !== "string" ||
    typeof source.ok !== "boolean"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    tool: "agent_browser",
    action: source.action,
    ok: source.ok,
    ts: typeof source.ts === "number" && Number.isFinite(source.ts) ? source.ts : Date.now(),
    ...(optionalString(source.sessionId) ? { sessionId: optionalString(source.sessionId) } : {}),
    ...(optionalString(source.pageId) ? { pageId: optionalString(source.pageId) } : {}),
    ...(optionalString(source.gatewayRequestId)
      ? { gatewayRequestId: optionalString(source.gatewayRequestId) }
      : {}),
    ...(optionalString(source.runId) ? { runId: optionalString(source.runId) } : {}),
    ...(optionalString(source.sessionKey) ? { sessionKey: optionalString(source.sessionKey) } : {}),
    ...(optionalString(source.agentSessionKey)
      ? { agentSessionKey: optionalString(source.agentSessionKey) }
      : {}),
    ...(optionalString(source.agentSessionId)
      ? { agentSessionId: optionalString(source.agentSessionId) }
      : {}),
    ...(optionalString(source.toolCallId) ? { toolCallId: optionalString(source.toolCallId) } : {}),
    ...(optionalString(source.taskId) ? { taskId: optionalString(source.taskId) } : {}),
    ...(optionalString(source.workspaceId) ? { workspaceId: optionalString(source.workspaceId) } : {}),
    ...(optionalString(source.agentId) ? { agentId: optionalString(source.agentId) } : {}),
    ...(optionalString(source.profile) ? { profile: optionalString(source.profile) } : {}),
    ...(optionalString(source.authStateName)
      ? { authStateName: optionalString(source.authStateName) }
      : {}),
    ...(optionalString(source.mode) ? { mode: optionalString(source.mode) } : {}),
    ...(optionalString(source.url) ? { url: optionalString(source.url) } : {}),
    ...(optionalString(source.finalUrl) ? { finalUrl: optionalString(source.finalUrl) } : {}),
    ...(optionalString(source.title) ? { title: optionalString(source.title) } : {}),
    ...(optionalString(source.textSample) ? { textSample: optionalString(source.textSample) } : {}),
    ...(optionalString(source.screenshotDataUrl)
      ? { screenshotDataUrl: optionalString(source.screenshotDataUrl) }
      : {}),
    ...(optionalStringArray(source.command) ? { command: optionalStringArray(source.command) } : {}),
    ...(optionalString(source.stdout) ? { stdout: optionalString(source.stdout) } : {}),
    ...(optionalString(source.stderr) ? { stderr: optionalString(source.stderr) } : {}),
    ...(optionalString(source.error) ? { error: optionalString(source.error) } : {}),
  };
}

export function readAgentBrowserAutomationEvents(value: unknown): AgentBrowserAutomationEvent[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  const events: AgentBrowserAutomationEvent[] = [];
  const single = readAgentBrowserAutomationEvent(record);
  if (single) {
    events.push(single);
  }
  const rawEvents = Array.isArray(record.browserAutomationEvents)
    ? record.browserAutomationEvents
    : Array.isArray(record._browserAutomationEvents)
      ? record._browserAutomationEvents
      : [];
  for (const rawEvent of rawEvents) {
    const event = readAgentBrowserAutomationEvent({ browserAutomationEvent: rawEvent });
    if (event) {
      events.push(event);
    }
  }
  return events;
}
