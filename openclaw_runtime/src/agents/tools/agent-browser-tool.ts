/**
 * Minimal agent-facing bridge for the Verse Claw internal Agent Browser.
 *
 * The browser itself is Electron Main-owned. Runtime callers inject the bridge
 * so BrowserWindow lifecycle and local profile state never move into Gateway.
 */
import { Type } from "typebox";
import type { ContentProvenanceContext } from "../../../../shared/security/content-provenance.js";
import { stringEnum } from "../schema/string-enum.js";
import type { AnyAgentTool } from "./common.js";
import {
  asToolParamsRecord,
  jsonResult,
  readStringParam,
  ToolAuthorizationError,
} from "./common.js";
import {
  buildAgentBrowserAutomationEvent,
  type AgentBrowserCorrelation,
} from "./agent-browser-automation-event.js";
import {
  resolveAgentBrowserExternalAccessPolicy,
  resolveAgentBrowserSessionEffectPolicy,
  shouldPreflightAgentBrowserSessionEffect,
  type AgentBrowserSessionEffect,
} from "./agent-browser-external-access-policy.js";

const AGENT_BROWSER_ACTIONS = [
  "open",
  "status",
  "navigate",
  "waitForSelector",
  "click",
  "type",
  "evaluate",
  "screenshot",
  "command",
  "close",
  "getConsoleMessages",
  "downloadFile",
  "uploadFiles",
  "pointer",
  "drag",
  "selectOption",
  "selectValues",
  "appendText",
  "setChecked",
  "findElement",
  "semanticRead",
  "readForms",
  "readDialogs",
  "respondDialog",
] as const;
const FAILURE_DIAGNOSTIC_COMMANDS: string[][] = [
  ["snapshot", "-i"],
  ["console"],
  ["errors"],
  ["network", "requests"],
];
const FAILURE_DIAGNOSTIC_MAX_OUTPUT = 120_000;

export type AgentBrowserAction = (typeof AGENT_BROWSER_ACTIONS)[number];
export type AgentBrowserInvoker = (
  action: AgentBrowserAction,
  payload: Record<string, unknown>,
  correlation?: AgentBrowserCorrelation,
) => Promise<unknown>;

const AgentBrowserSchema = Type.Object({
  action: stringEnum(AGENT_BROWSER_ACTIONS, {
    description: "Agent browser action to run.",
  }),
  sessionId: Type.Optional(Type.String({ description: "Existing agent browser session id." })),
  taskId: Type.Optional(Type.String({ description: "Correlation id for an owning browser task." })),
  pageId: Type.Optional(Type.String({ description: "Correlation id for the target browser page." })),
  workspaceId: Type.Optional(Type.String({ description: "ClawX workspace id for new sessions." })),
  sessionKey: Type.Optional(Type.String({ description: "ClawX session key for new sessions." })),
  agentId: Type.Optional(Type.String({ description: "ClawX agent id for new sessions." })),
  url: Type.Optional(Type.String({ description: "HTTP(S) URL for open or navigate." })),
  profile: Type.Optional(Type.String({ description: "Persistent browser profile name." })),
  mode: Type.Optional(stringEnum(["headless", "visible"], { description: "Browser visibility." })),
  authPersistence: Type.Optional(stringEnum(["session-name", "profile", "off"], {
    description: "Login-state persistence mode. Defaults to session-name so cookies/localStorage survive new browser sessions for the same profile.",
  })),
  authStateName: Type.Optional(Type.String({
    description: "Stable auth-state name for persisted cookies/localStorage. Defaults to the profile name.",
  })),
  connectionMode: Type.Optional(stringEnum(["managed", "auto-connect", "cdp", "external-profile"], {
    description: "Browser connection mode. External modes require allowExternalBrowser=true.",
  })),
  cdpEndpoint: Type.Optional(Type.String({ description: "CDP port or endpoint for connectionMode='cdp'." })),
  externalProfile: Type.Optional(Type.String({
    description: "Existing Chrome profile name or path for connectionMode='external-profile'. Requires allowExternalBrowser=true.",
  })),
  executablePath: Type.Optional(Type.String({
    description: "Optional browser executable path for connectionMode='external-profile'. Requires allowExternalBrowser=true.",
  })),
  allowExternalBrowser: Type.Optional(Type.Boolean({
    description: "Explicit safety acknowledgement required to connect to a running browser or an existing external browser profile.",
  })),
  selector: Type.Optional(Type.String({ description: "CSS selector for wait/click/type." })),
  pointerAction: Type.Optional(stringEnum(["hover", "double-click", "right-click", "scroll", "scroll-into-view"], { description: "Pointer action for action='pointer'." })),
  sourceSelector: Type.Optional(Type.String({ description: "Source selector for drag." })),
  targetSelector: Type.Optional(Type.String({ description: "Target selector for drag." })),
  path: Type.Optional(Type.String({ description: "Authorized download path." })),
  paths: Type.Optional(Type.Array(Type.String(), { description: "Authorized upload paths." })),
  label: Type.Optional(Type.String({ description: "Visible option label." })),
  values: Type.Optional(Type.Array(Type.String(), { description: "Select option values." })),
  checked: Type.Optional(Type.Boolean({ description: "Desired checkbox/radio state." })),
  role: Type.Optional(Type.String({ description: "Accessible role for exact find." })),
  name: Type.Optional(Type.String({ description: "Accessible name for exact find." })),
  testId: Type.Optional(Type.String({ description: "Test id for exact find." })),
  instruction: Type.Optional(Type.String({ description: "Semantic observe/extract instruction." })),
  schema: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Optional semantic extraction schema." })),
  dialogId: Type.Optional(Type.String({ description: "Observed dialog id." })),
  accept: Type.Optional(Type.Boolean({ description: "Accept or dismiss a dialog." })),
  promptText: Type.Optional(Type.String({ description: "Optional prompt response text." })),
  text: Type.Optional(Type.String({ description: "Text for type action." })),
  expression: Type.Optional(Type.String({ description: "JavaScript expression for evaluate." })),
  args: Type.Optional(Type.Array(Type.String(), {
    description: "agent-browser CLI subcommand argv for command action, e.g. ['snapshot', '-i'] or ['network', 'requests'].",
  })),
  globalOptions: Type.Optional(Type.Array(Type.String(), {
    description: "agent-browser global CLI options inserted before the subcommand, e.g. ['--enable', 'react-devtools']. Managed flags such as --session and --profile are rejected by ClawX.",
  })),
  clear: Type.Optional(Type.Boolean({ description: "Clear target before type; default true." })),
  timeoutMs: Type.Optional(Type.Integer({ description: "Selector wait timeout in milliseconds." })),
  maxOutput: Type.Optional(Type.Integer({ description: "Maximum CLI output characters for command action." })),
  width: Type.Optional(Type.Integer({ description: "Viewport/window width." })),
  height: Type.Optional(Type.Integer({ description: "Viewport/window height." })),
});

function requireSession(params: Record<string, unknown>, action: AgentBrowserAction): string {
  return readStringParam(params, "sessionId", {
    required: true,
    label: `${action}.sessionId`,
  });
}

function pickPayload(params: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    if (params[key] !== undefined) {
      payload[key] = params[key];
    }
  }
  return payload;
}

function buildPayload(action: AgentBrowserAction, params: Record<string, unknown>) {
  switch (action) {
    case "open":
      return pickPayload(params, [
        "url",
        "profile",
        "mode",
        "width",
        "height",
        "authPersistence",
        "authStateName",
        "connectionMode",
        "cdpEndpoint",
        "externalProfile",
        "executablePath",
        "allowExternalBrowser",
        "workspaceId",
        "sessionKey",
        "agentId",
      ]);
    case "status":
      return {};
    case "navigate":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["url"]) };
    case "waitForSelector":
    case "click":
      return {
        sessionId: requireSession(params, action),
        ...pickPayload(params, ["selector", "timeoutMs"]),
      };
    case "type":
      return {
        sessionId: requireSession(params, action),
        ...pickPayload(params, ["selector", "text", "clear", "timeoutMs"]),
      };
    case "evaluate":
      return {
        sessionId: requireSession(params, action),
        ...pickPayload(params, ["expression"]),
      };
    case "screenshot":
    case "close":
    case "getConsoleMessages":
      return { sessionId: requireSession(params, action) };
    case "command":
      return pickPayload(params, [
        "sessionId",
        "args",
        "globalOptions",
        "profile",
        "mode",
        "authPersistence",
        "authStateName",
        "connectionMode",
        "cdpEndpoint",
        "externalProfile",
        "executablePath",
        "allowExternalBrowser",
        "timeoutMs",
        "maxOutput",
      ]);
    case "downloadFile":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["selector", "path", "timeoutMs"]) };
    case "uploadFiles":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["selector", "paths", "timeoutMs"]) };
    case "pointer":
      return { sessionId: requireSession(params, action), action: params.pointerAction, ...pickPayload(params, ["selector", "deltaX", "deltaY", "timeoutMs"]) };
    case "drag":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["sourceSelector", "targetSelector", "timeoutMs"]) };
    case "selectOption":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["selector", "label", "timeoutMs"]) };
    case "selectValues":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["selector", "values", "timeoutMs"]) };
    case "appendText":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["selector", "text", "timeoutMs"]) };
    case "setChecked":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["selector", "checked", "timeoutMs"]) };
    case "findElement":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["role", "name", "label", "testId", "timeoutMs"]) };
    case "semanticRead":
      return { sessionId: requireSession(params, action), instruction: params.instruction, schema: params.schema, timeoutMs: params.timeoutMs };
    case "readForms":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["selector"]) };
    case "readDialogs":
      return { sessionId: requireSession(params, action) };
    case "respondDialog":
      return { sessionId: requireSession(params, action), ...pickPayload(params, ["dialogId", "accept", "promptText"]) };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function applyCorrelationToPayload(
  action: AgentBrowserAction,
  payload: Record<string, unknown>,
  correlation: AgentBrowserCorrelation,
): void {
  if (action !== "open") return;
  if (payload.sessionKey === undefined && correlation.sessionKey) {
    payload.sessionKey = correlation.sessionKey;
  }
  if (payload.agentId === undefined && correlation.agentId) {
    payload.agentId = correlation.agentId;
  }
}

function readGatewayRequestId(result: unknown): string | undefined {
  const value = asRecord(result).gatewayRequestId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readResultSessionId(result: unknown): string | undefined {
  const record = asRecord(result);
  const session = asRecord(record.session);
  const sessionId = session.id;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined;
}

function readPayloadSessionId(payload: Record<string, unknown>, result?: unknown): string | undefined {
  const sessionId = payload.sessionId;
  return typeof sessionId === "string" && sessionId.trim()
    ? sessionId.trim()
    : readResultSessionId(result);
}

function isFailureResult(result: unknown): boolean {
  const record = asRecord(result);
  return (
    record.success === false ||
    record.ok === false ||
    record.status === "error" ||
    record.status === "failed"
  );
}

function resultPayload(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : { value: result };
}

function readSessionConnectionMode(result: unknown, sessionId: string): unknown {
  const record = asRecord(result);
  if (record.success !== true || isFailureResult(result)) return undefined;
  const sessions = record.sessions;
  if (!Array.isArray(sessions)) return undefined;
  for (const value of sessions) {
    const session = asRecord(value);
    if (session.id === sessionId) {
      return asRecord(session.connection).mode;
    }
  }
  return undefined;
}

async function assertSessionEffectAllowed(params: {
  invoke: AgentBrowserInvoker;
  sessionId: string;
  action: AgentBrowserSessionEffect;
  provenanceContext?: ContentProvenanceContext;
}): Promise<void> {
  if (!shouldPreflightAgentBrowserSessionEffect(params.provenanceContext)) return;
  let statusResult: unknown;
  try {
    statusResult = await params.invoke("status", {});
  } catch {
    throw new ToolAuthorizationError(
      `Agent browser ${params.action} denied: unable to verify the target browser session.`,
    );
  }
  const policy = resolveAgentBrowserSessionEffectPolicy({
    provenanceContext: params.provenanceContext,
    sessionConnectionMode: readSessionConnectionMode(statusResult, params.sessionId),
    action: params.action,
  });
  if (!policy.allowed) {
    throw new ToolAuthorizationError(policy.reason ?? `Agent browser ${params.action} denied.`);
  }
}

function shouldCollectFailureDiagnostics(action: AgentBrowserAction, sessionId?: string): boolean {
  if (!sessionId) {
    return false;
  }
  return !["status", "screenshot", "command", "close", "getConsoleMessages"].includes(action);
}

async function collectFailureDiagnostics(params: {
  invoke: AgentBrowserInvoker;
  sessionId: string | undefined;
  failedAction: AgentBrowserAction;
  correlation?: AgentBrowserCorrelation;
}) {
  if (!shouldCollectFailureDiagnostics(params.failedAction, params.sessionId)) {
    return [];
  }
  const sessionId = params.sessionId;
  const events = [];
  try {
    const payload = { sessionId };
    const result = await params.invoke("screenshot", payload, params.correlation);
    events.push(buildAgentBrowserAutomationEvent({ action: "screenshot", payload, result, correlation: params.correlation }));
  } catch (error) {
    const payload = { sessionId };
    events.push(
      buildAgentBrowserAutomationEvent({
        action: "screenshot",
        payload,
        result: { success: false, error: errorMessage(error) },
        ok: false,
        error,
      }),
    );
  }
  for (const args of FAILURE_DIAGNOSTIC_COMMANDS) {
    const payload = { sessionId, args, maxOutput: FAILURE_DIAGNOSTIC_MAX_OUTPUT };
    try {
      const result = await params.invoke("command", payload, params.correlation);
      events.push(buildAgentBrowserAutomationEvent({ action: "command", payload, result, correlation: params.correlation }));
    } catch (error) {
      events.push(
        buildAgentBrowserAutomationEvent({
          action: "command",
          payload,
          result: { success: false, command: args, error: errorMessage(error) },
          ok: false,
          error,
        }),
      );
    }
  }
  return events;
}

export function createAgentBrowserTool(options?: {
  invoke?: AgentBrowserInvoker;
  contentProvenanceContext?: ContentProvenanceContext;
  correlation?: AgentBrowserCorrelation;
}): AnyAgentTool | null {
  if (!options?.invoke) {
    return null;
  }
  return {
    label: "Agent Browser",
    name: "agent_browser",
    description:
      "Drive Verse Claw's internal Agent Browser for web automation. Login state persists by profile by default through authStateName/session-name. Use simple actions for common tasks; action='getConsoleMessages' reads CDP-captured console logs for the current browser-window session. Use action='command' with agent-browser CLI argv to access advanced features such as snapshot, console, errors, network, cookies, storage, trace, record, vitals, tabs, auth, plugins, and MCP. External browser reuse via auto-connect, CDP, or existing Chrome profiles requires allowExternalBrowser=true.",
    parameters: AgentBrowserSchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParamsRecord(args);
      const action = readStringParam(params, "action", {
        required: true,
      }) as AgentBrowserAction;
      if (!AGENT_BROWSER_ACTIONS.includes(action)) {
        throw new Error(`Unsupported agent_browser action: ${action}`);
      }
      const payload = buildPayload(action, params);
      const correlation: AgentBrowserCorrelation = {
        ...options?.correlation,
        toolCallId: _toolCallId,
        ...(readStringParam(params, "taskId") ? { taskId: readStringParam(params, "taskId") } : {}),
        ...(readStringParam(params, "pageId") ? { pageId: readStringParam(params, "pageId") } : {}),
      };
      applyCorrelationToPayload(action, payload, correlation);
      const externalAccessPolicy = resolveAgentBrowserExternalAccessPolicy({
        provenanceContext: options.contentProvenanceContext,
        connectionMode: payload.connectionMode,
      });
      if (!externalAccessPolicy.allowed) {
        throw new ToolAuthorizationError(
          externalAccessPolicy.reason ?? "Agent browser external connection denied.",
        );
      }
      if (action === "click" || action === "type") {
        await assertSessionEffectAllowed({
          invoke: options.invoke!,
          sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
          action,
          provenanceContext: options.contentProvenanceContext,
        });
      }
      let result: unknown;
      try {
        result = await options.invoke!(action, payload, correlation);
      } catch (error) {
        const sessionId = readPayloadSessionId(payload);
        const diagnostics = await collectFailureDiagnostics({
          invoke: options.invoke!,
          sessionId,
          failedAction: action,
          correlation,
        });
        const message = errorMessage(error);
        return jsonResult({
          status: "error",
          success: false,
          error: message,
          browserAutomationEvent: buildAgentBrowserAutomationEvent({
            action,
            payload,
            result: { success: false, error: message },
            ok: false,
            error,
            correlation,
          }),
          ...(diagnostics.length > 0 ? { browserAutomationEvents: diagnostics } : {}),
        });
      }
      correlation.gatewayRequestId = readGatewayRequestId(result) ?? correlation.gatewayRequestId;
      const primaryEvent = buildAgentBrowserAutomationEvent({
        action,
        payload,
        result,
        ok: !isFailureResult(result),
        correlation,
      });
      if (isFailureResult(result)) {
        const diagnostics = await collectFailureDiagnostics({
          invoke: options.invoke!,
          sessionId: readPayloadSessionId(payload, result),
          failedAction: action,
          correlation,
        });
        return jsonResult({
          ...resultPayload(result),
          status: "error",
          browserAutomationEvent: primaryEvent,
          ...(diagnostics.length > 0 ? { browserAutomationEvents: diagnostics } : {}),
        });
      }
      return jsonResult({
        ...resultPayload(result),
        browserAutomationEvent: primaryEvent,
      });
    },
  };
}
