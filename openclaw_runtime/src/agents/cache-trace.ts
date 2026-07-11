/**
 * Optional JSONL diagnostics for agent cache/session/prompt tracing.
 */
import crypto from "node:crypto";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveUserPath } from "../utils.js";
import { parseBooleanValue } from "../utils/boolean.js";
import { safeJsonStringify } from "../utils/safe-json.js";
import { sanitizeDiagnosticPayload } from "./payload-redaction.js";
import {
  canonicalizeOpenAIProviderPayload,
  summarizeProviderPayloadCacheShape,
} from "./provider-payload-cache-shape.js";
import { getQueuedFileWriter, type QueuedFileWriter } from "./queued-file-writer.js";
import type { AgentMessage, StreamFn } from "./runtime/index.js";
import { stableStringify } from "./stable-stringify.js";
import { buildAgentTraceBase } from "./trace-base.js";

export const CACHE_TRACE_PROVIDER_PAYLOAD_RECORDER = Symbol.for(
  "openclaw.cacheTrace.providerPayloadRecorder",
);

// Payloads are redacted before JSONL output while stable digests preserve
// correlation across prompt/session/cache stages.
type CacheTraceStage =
  | "cache:result"
  | "cache:state"
  | "session:loaded"
  | "session:raw-model-run"
  | "session:sanitized"
  | "session:limited"
  | "prompt:before"
  | "prompt:images"
  | "stream:context"
  | "provider:payload"
  | "session:after";

type CacheTraceEvent = {
  ts: string;
  seq: number;
  stage: CacheTraceStage;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
  prompt?: string;
  system?: unknown;
  options?: Record<string, unknown>;
  model?: Record<string, unknown>;
  messages?: AgentMessage[];
  messageCount?: number;
  messageRoles?: Array<string | undefined>;
  messageFingerprints?: string[];
  messagesDigest?: string;
  systemDigest?: string;
  providerSystemDigest?: string;
  providerMessagesDigest?: string;
  providerToolsDigest?: string;
  providerPrefixShapeDigest?: string;
  providerParamsDigest?: string;
  providerToolCount?: number;
  providerToolNames?: string[];
  providerPayloadSource?: string;
  note?: string;
  error?: string;
};

type CacheTrace = {
  enabled: true;
  filePath: string;
  recordStage: (stage: CacheTraceStage, payload?: Partial<CacheTraceEvent>) => void;
  wrapStreamFn: (streamFn: StreamFn) => StreamFn;
};

type CacheTraceInit = {
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
  writer?: CacheTraceWriter;
};

type CacheTraceConfig = {
  enabled: boolean;
  filePath: string;
  includeMessages: boolean;
  includePrompt: boolean;
  includeSystem: boolean;
};

type CacheTraceWriter = QueuedFileWriter;

type CacheTraceProviderPayloadRecorder = (payload: unknown, source?: string) => void;
type CacheTraceStreamOptions = NonNullable<Parameters<StreamFn>[2]> & {
  [CACHE_TRACE_PROVIDER_PAYLOAD_RECORDER]: CacheTraceProviderPayloadRecorder;
};

const writers = new Map<string, CacheTraceWriter>();

function resolveCacheTraceConfig(params: CacheTraceInit): CacheTraceConfig {
  const env = params.env ?? process.env;
  const config = params.cfg?.diagnostics?.cacheTrace;
  const envEnabled = parseBooleanValue(env.OPENCLAW_CACHE_TRACE);
  const enabled = envEnabled ?? config?.enabled ?? false;
  const fileOverride = config?.filePath?.trim() || env.OPENCLAW_CACHE_TRACE_FILE?.trim();
  const filePath = fileOverride
    ? resolveUserPath(fileOverride)
    : path.join(resolveStateDir(env), "logs", "cache-trace.jsonl");

  const includeMessages =
    parseBooleanValue(env.OPENCLAW_CACHE_TRACE_MESSAGES) ?? config?.includeMessages;
  const includePrompt = parseBooleanValue(env.OPENCLAW_CACHE_TRACE_PROMPT) ?? config?.includePrompt;
  const includeSystem = parseBooleanValue(env.OPENCLAW_CACHE_TRACE_SYSTEM) ?? config?.includeSystem;

  return {
    enabled,
    filePath,
    includeMessages: includeMessages ?? true,
    includePrompt: includePrompt ?? true,
    includeSystem: includeSystem ?? true,
  };
}

function getWriter(filePath: string): CacheTraceWriter {
  return getQueuedFileWriter(writers, filePath);
}

function digest(value: unknown): string {
  const serialized = stableStringify(value);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

function summarizeMessages(messages: AgentMessage[]): {
  messageCount: number;
  messageRoles: Array<string | undefined>;
  messageFingerprints: string[];
  messagesDigest: string;
} {
  // Hash each message and then the ordered fingerprint list so traces can detect
  // prompt drift without writing full messages when disabled.
  const messageFingerprints = messages.map((msg) => digest(msg));
  return {
    messageCount: messages.length,
    messageRoles: messages.map((msg) => (msg as { role?: string }).role),
    messageFingerprints,
    messagesDigest: digest(messageFingerprints.join("|")),
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePayloadReplacement(payload: unknown, replacement: unknown): unknown {
  if (replacement === undefined) {
    return payload;
  }
  if (isRecord(payload) && isRecord(replacement)) {
    return canonicalizeOpenAIProviderPayload({
      ...payload,
      ...replacement,
    });
  }
  return replacement;
}

function buildProviderLikePayloadFromStreamContext(params: {
  model: Parameters<StreamFn>[0];
  context: Parameters<StreamFn>[1];
}): Record<string, unknown> {
  const traceContext = params.context as {
    messages?: AgentMessage[];
    system?: unknown;
    systemPrompt?: unknown;
    tools?: unknown;
  };
  const messages: unknown[] = [];
  const system = traceContext.systemPrompt ?? traceContext.system;
  if (system !== undefined && system !== null && system !== "") {
    messages.push({ role: "system", content: system });
  }
  if (Array.isArray(traceContext.messages)) {
    messages.push(...traceContext.messages);
  }
  const payload: Record<string, unknown> = {
    model: (params.model as { id?: unknown } | undefined)?.id,
    messages,
  };
  if (Array.isArray(traceContext.tools)) {
    payload.tools = traceContext.tools;
  }
  return canonicalizeOpenAIProviderPayload(payload);
}

/** Create a cache trace recorder when diagnostics config/env enables it. */
export function createCacheTrace(params: CacheTraceInit): CacheTrace | null {
  const cfg = resolveCacheTraceConfig(params);
  if (!cfg.enabled) {
    return null;
  }

  const writer = params.writer ?? getWriter(cfg.filePath);
  let seq = 0;

  const base: Omit<CacheTraceEvent, "ts" | "seq" | "stage"> = buildAgentTraceBase(params);

  const recordStage: CacheTrace["recordStage"] = (stage, payload = {}) => {
    const event: CacheTraceEvent = {
      ...base,
      ts: new Date().toISOString(),
      seq: (seq += 1),
      stage,
    };

    if (payload.prompt !== undefined && cfg.includePrompt) {
      event.prompt = payload.prompt;
    }
    if (payload.system !== undefined && cfg.includeSystem) {
      event.system = sanitizeDiagnosticPayload(payload.system);
      event.systemDigest = digest(payload.system);
    }
    if (payload.options) {
      event.options = sanitizeDiagnosticPayload(payload.options) as Record<string, unknown>;
    }
    if (payload.model) {
      event.model = sanitizeDiagnosticPayload(payload.model) as Record<string, unknown>;
    }

    const messages = payload.messages;
    if (Array.isArray(messages)) {
      const summary = summarizeMessages(messages);
      event.messageCount = summary.messageCount;
      event.messageRoles = summary.messageRoles;
      event.messageFingerprints = summary.messageFingerprints;
      event.messagesDigest = summary.messagesDigest;
      if (cfg.includeMessages) {
        // Full messages are optional; summaries/digests are always recorded when
        // message payloads are supplied.
        event.messages = sanitizeDiagnosticPayload(messages) as AgentMessage[];
      }
    }

    if (payload.note) {
      event.note = payload.note;
    }
    if (payload.error) {
      event.error = payload.error;
    }
    if (payload.providerSystemDigest) {
      event.providerSystemDigest = payload.providerSystemDigest;
    }
    if (payload.providerMessagesDigest) {
      event.providerMessagesDigest = payload.providerMessagesDigest;
    }
    if (payload.providerToolsDigest) {
      event.providerToolsDigest = payload.providerToolsDigest;
    }
    if (payload.providerPrefixShapeDigest) {
      event.providerPrefixShapeDigest = payload.providerPrefixShapeDigest;
    }
    if (payload.providerParamsDigest) {
      event.providerParamsDigest = payload.providerParamsDigest;
    }
    if (typeof payload.providerToolCount === "number") {
      event.providerToolCount = payload.providerToolCount;
    }
    if (Array.isArray(payload.providerToolNames)) {
      event.providerToolNames = payload.providerToolNames.filter(
        (name): name is string => typeof name === "string",
      );
    }
    if (typeof payload.providerPayloadSource === "string") {
      event.providerPayloadSource = payload.providerPayloadSource;
    }

    const line = safeJsonStringify(event);
    if (!line) {
      return;
    }
    writer.write(`${line}\n`);
  };

  const recordProviderPayloadShape: CacheTraceProviderPayloadRecorder = (
    payload,
    source = "onPayload",
  ) => {
    const shape = summarizeProviderPayloadCacheShape(payload);
    recordStage("provider:payload", {
      providerSystemDigest: shape.systemHash,
      providerMessagesDigest: shape.messagesHash,
      providerToolsDigest: shape.toolsHash,
      providerPrefixShapeDigest: shape.prefixShapeHash,
      providerParamsDigest: shape.paramsHash,
      providerToolCount: shape.toolCount,
      providerToolNames: shape.toolNames,
      providerPayloadSource: source,
    });
  };

  const wrapStreamFn: CacheTrace["wrapStreamFn"] = (streamFn) => {
    const wrapped: StreamFn = (model, context, options) => {
      let providerPayloadRecorded = false;
      const recordProviderPayloadShapeForCall: CacheTraceProviderPayloadRecorder = (
        payload,
        source = "onPayload",
      ) => {
        providerPayloadRecorded = true;
        recordProviderPayloadShape(payload, source);
      };
      const traceContext = context as {
        messages?: AgentMessage[];
        system?: unknown;
        systemPrompt?: unknown;
      };
      const originalOnPayload = options?.onPayload;
      const onPayload = originalOnPayload
        ? (payload: unknown, modelValue: Parameters<NonNullable<typeof originalOnPayload>>[1]) => {
            const result = originalOnPayload(payload, modelValue);
            if (isPromiseLike(result)) {
              return result.then((replacement) => {
                const finalPayload = mergePayloadReplacement(payload, replacement);
                recordProviderPayloadShapeForCall(finalPayload, "onPayload");
                return replacement;
              });
            }
            const finalPayload = mergePayloadReplacement(payload, result);
            recordProviderPayloadShapeForCall(finalPayload, "onPayload");
            return result;
          }
        : (payload: unknown) => {
            recordProviderPayloadShapeForCall(payload, "onPayload");
            return undefined;
          };
      recordStage("stream:context", {
        model: {
          id: model?.id,
          provider: model?.provider,
          api: model?.api,
        },
        system: traceContext.systemPrompt ?? traceContext.system,
        messages: traceContext.messages ?? [],
        options: (options ?? {}) as Record<string, unknown>,
      });
      queueMicrotask(() => {
        if (providerPayloadRecorded) {
          return;
        }
        recordProviderPayloadShapeForCall(
          buildProviderLikePayloadFromStreamContext({ model, context }),
          "stream-context-fallback",
        );
      });
      const tracedOptions: CacheTraceStreamOptions = {
        ...options,
        [CACHE_TRACE_PROVIDER_PAYLOAD_RECORDER]: recordProviderPayloadShapeForCall,
        onPayload,
      };
      return streamFn(model, context, tracedOptions);
    };
    return wrapped;
  };

  return {
    enabled: true,
    filePath: cfg.filePath,
    recordStage,
    wrapStreamFn,
  };
}
