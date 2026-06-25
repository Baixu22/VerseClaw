/** Lightweight telemetry fragments emitted by the agent_browser tool. */

export type AgentBrowserAutomationEvent = {
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
}): AgentBrowserAutomationEvent {
  const result = asRecord(params.result) ?? {};
  const session = asRecord(result.session) ?? {};
  const event: AgentBrowserAutomationEvent = {
    schemaVersion: 1,
    tool: "agent_browser",
    action: params.action,
    ok: params.ok ?? result.success !== false,
    ts: Date.now(),
  };
  const sessionId = firstString(session.id, params.payload.sessionId);
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
