/**
 * Guarded provider fetch transport utilities.
 *
 * Applies request timeouts, proxy/TLS overrides, SSRF policy, local-service leases, retry hints, and SSE normalization.
 */
import {
  asFiniteNumberInRange,
  clampTimerTimeoutMs,
  parseStrictFiniteNumber,
  parseStrictNonNegativeInteger,
} from "@openclaw/normalization-core/number-coercion";
import {
  fetchWithSsrFGuard,
  withTrustedEnvProxyGuardedFetchMode,
} from "../infra/net/fetch-guard.js";
import { shouldUseEnvHttpProxyForUrl } from "../infra/net/proxy-env.js";
import type { SsrFPolicy } from "../infra/net/ssrf.js";
import type { Model } from "../llm/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveDebugProxySettings } from "../proxy-capture/env.js";
import { emitModelTransportDebug } from "./model-transport-debug.js";
import { formatModelTransportDebugUrl } from "./model-transport-url.js";
import { ProviderHttpError, readResponseTextLimited } from "./provider-http-errors.js";
import { appendProviderRequestAuthQuery } from "./provider-request-auth.js";
import { getRequestAttemptBudget, type RequestAttemptBudget } from "./request-attempt-budget.js";
import {
  clampRequestTimeoutToDeadline,
  getRequestDeadline,
  isRequestDeadlineExpired,
  RequestDeadlineExceededError,
} from "./request-deadline.js";
import {
  isProviderPayloadTraceEnabled,
  recordProviderPayloadTrace,
} from "./provider-payload-trace.js";
import {
  ensureModelProviderLocalService,
  type ProviderLocalServiceLease,
} from "./provider-local-service.js";
import {
  acquireProviderOutboundSlot,
  ProviderOutboundOverloadedError,
  resolveProviderOutboundQuotaGroup,
} from "./provider-outbound-budget.js";
import {
  admitProviderEndpointRequest,
  classifyProviderEndpointResponse,
  ProviderEndpointCircuitOpenError,
} from "./provider-endpoint-health.js";
import {
  buildProviderRequestDispatcherPolicy,
  getModelProviderRequestTransport,
  mergeModelProviderRequestOverrides,
  resolveProviderRequestPolicyConfig,
} from "./provider-request-config.js";
import { resolveProviderNetworkPolicy } from "./provider-network-policy.js";
import {
  emitRc03WireReceipt,
  emitShadowWireReceipt,
  ProviderEnvelopeRejectedError,
  recordShadowCensusFailure,
  resolveEnvelopeRejectEnabled,
  type ShadowReceiptOptions,
} from "./shadow-census.js";
import { buildStage1RequestEnvelope } from "./stage1-request-envelope.js";

const DEFAULT_MAX_SDK_RETRY_WAIT_SECONDS = 60;
const OPENAI_SDK_STREAM_CONTENT_SNIFF_BYTES = 2 * 1024;
const log = createSubsystemLogger("provider-transport-fetch");
const PLAIN_DECIMAL_NUMBER_RE = /^\d+(?:\.\d+)?$/;
const RETRY_AFTER_HTTP_DATE_RE =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
const HTTP_DATE_MONTH_INDEX = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, index],
  ),
);
const OBSOLETE_ASCTIME_HTTP_DATE_RE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

function hasReadableSseData(block: string): boolean {
  const dataLines = block
    .split(/\r\n|\n|\r/)
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => {
      if (line === "data") {
        return "";
      }
      const value = line.slice("data:".length);
      return value.startsWith(" ") ? value.slice(1) : value;
    });
  return dataLines.length > 0 && dataLines.join("\n").trim().length > 0;
}

function findSseEventBoundary(buffer: string): { index: number; length: number } | undefined {
  let best: { index: number; length: number } | undefined;
  for (const delimiter of ["\r\n\r\n", "\n\n", "\r\r"]) {
    const index = buffer.indexOf(delimiter);
    if (index === -1) {
      continue;
    }
    if (!best || index < best.index) {
      best = { index, length: delimiter.length };
    }
  }
  return best;
}

function sanitizeOpenAISdkSseResponse(
  response: Response,
  options?: { synthesizeJsonAsSse?: boolean },
): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !response.body) {
    return response;
  }
  if (
    options?.synthesizeJsonAsSse === true &&
    (/\bapplication\/json\b/i.test(contentType) || /\+json\b/i.test(contentType))
  ) {
    const source = response.body;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let buffer = "";
    const sseBody = new ReadableStream<Uint8Array>({
      start() {
        reader = source.getReader();
      },
      async pull(controller) {
        try {
          for (;;) {
            const chunk = await reader?.read();
            if (!chunk || chunk.done) {
              buffer += decoder.decode();
              const data = buffer.trim();
              if (data) {
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
          }
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader?.cancel(reason);
      },
    });
    const headers = new Headers(response.headers);
    headers.set("content-type", "text/event-stream; charset=utf-8");
    return new Response(sseBody, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  if (!/\btext\/event-stream\b/i.test(contentType)) {
    return response;
  }

  const source = response.body;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let buffer = "";

  const enqueueSanitized = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    text: string,
  ): number => {
    let enqueued = 0;
    buffer += text;
    for (;;) {
      const boundary = findSseEventBoundary(buffer);
      if (!boundary) {
        return enqueued;
      }
      const block = buffer.slice(0, boundary.index);
      const separator = buffer.slice(boundary.index, boundary.index + boundary.length);
      buffer = buffer.slice(boundary.index + boundary.length);
      // OpenAI's SDK currently tries to JSON.parse event-only or blank-data SSE
      // messages. Drop those malformed keepalive-style blocks before it parses.
      if (hasReadableSseData(block)) {
        controller.enqueue(encoder.encode(`${block}${separator}`));
        enqueued += 1;
      }
    }
  };

  const sanitizedBody = new ReadableStream<Uint8Array>({
    start() {
      reader = source.getReader();
    },
    async pull(controller) {
      try {
        for (;;) {
          const chunk = await reader?.read();
          if (!chunk || chunk.done) {
            const tail = decoder.decode();
            if (tail) {
              enqueueSanitized(controller, tail);
            }
            if (buffer && hasReadableSseData(buffer)) {
              controller.enqueue(encoder.encode(buffer));
            }
            buffer = "";
            controller.close();
            return;
          }
          const enqueued = enqueueSanitized(
            controller,
            decoder.decode(chunk.value, { stream: true }),
          );
          if (enqueued > 0) {
            return;
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason);
    },
  });

  return new Response(sanitizedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function shouldSanitizeOpenAISdkSseResponse(model: Model): boolean {
  if (model.provider !== "openai") {
    return true;
  }
  try {
    return new URL(model.baseUrl).hostname.toLowerCase() !== "api.openai.com";
  } catch {
    return true;
  }
}

function isJsonContentType(contentType: string): boolean {
  return /\bapplication\/json\b/i.test(contentType) || /\+json\b/i.test(contentType);
}

function isOpenAISdkStreamContentType(contentType: string): boolean {
  return /\btext\/event-stream\b/i.test(contentType) || isJsonContentType(contentType);
}

type OpenAISdkStreamBodyKind = "html" | "json" | "sse" | "unknown";

function classifyOpenAISdkStreamBodyPrefix(text: string): OpenAISdkStreamBodyKind {
  const trimmed = text.replace(/^\uFEFF/u, "").trimStart();
  if (!trimmed) {
    return "unknown";
  }
  if (trimmed.startsWith("<")) {
    return "html";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  if (/^(?::|(?:data|event|id|retry)(?::|\r?\n|\r))/u.test(trimmed)) {
    return "sse";
  }
  const boundary = findSseEventBoundary(text);
  if (boundary && hasReadableSseData(text.slice(0, boundary.index))) {
    return "sse";
  }
  return "unknown";
}

async function classifyOpenAISdkStreamBody(response: Response): Promise<OpenAISdkStreamBodyKind> {
  const reader = response.clone().body?.getReader();
  if (!reader) {
    return "unknown";
  }

  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (total < OPENAI_SDK_STREAM_CONTENT_SNIFF_BYTES) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      const remaining = OPENAI_SDK_STREAM_CONTENT_SNIFF_BYTES - total;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      total += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      const kind = classifyOpenAISdkStreamBodyPrefix(text);
      if (kind !== "unknown") {
        return kind;
      }
    }
    text += decoder.decode();
    return classifyOpenAISdkStreamBodyPrefix(text);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function withOpenAISdkStreamContentType(response: Response, contentType: string): Response {
  const headers = new Headers(response.headers);
  headers.set("content-type", contentType);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function normalizeOpenAISdkStreamContentType(params: {
  response: Response;
  model: Model;
  release: () => Promise<void>;
  localServiceLease?: ProviderLocalServiceLease;
}): Promise<Response> {
  const contentType = params.response.headers.get("content-type") ?? "";
  if (!params.response.ok || !params.response.body || isOpenAISdkStreamContentType(contentType)) {
    return params.response;
  }
  if (!contentType.trim()) {
    // ChatGPT Codex can stream valid SSE with no content-type header. Sniff a
    // clone so the SDK still receives the original body once we normalize it.
    const kind = await classifyOpenAISdkStreamBody(params.response).catch(() => "unknown" as const);
    if (kind === "sse") {
      return withOpenAISdkStreamContentType(params.response, "text/event-stream; charset=utf-8");
    }
    if (kind === "json") {
      return withOpenAISdkStreamContentType(params.response, "application/json; charset=utf-8");
    }
  }
  const body = await readResponseTextLimited(params.response).catch(() => "");
  await params.release().catch(() => undefined);
  params.localServiceLease?.release();
  const hint =
    "OpenAI-compatible streamed responses must be text/event-stream or JSON; got " +
    `${contentType || "missing content-type"}. Check the provider baseUrl; ` +
    "OpenAI-compatible APIs commonly require a /v1 path prefix.";
  throw new ProviderHttpError(`${params.model.provider}/${params.model.id}: ${hint}`, {
    status: params.response.status,
    code: "invalid_provider_content_type",
    type: "invalid_response",
    body,
  });
}

async function requestBodyHasStreamTrue(
  request: Request | undefined,
  init: RequestInit | undefined,
): Promise<boolean> {
  const method = request?.method ?? init?.method;
  if (method && method.toUpperCase() !== "POST") {
    return false;
  }
  const headers = request?.headers ?? new Headers(init?.headers);
  const contentType = headers.get("content-type") ?? "";
  if (contentType && !/\bapplication\/json\b/i.test(contentType)) {
    return false;
  }

  let text: string | undefined;
  if (typeof init?.body === "string") {
    text = init.body;
  }
  if (!text) {
    return false;
  }
  try {
    return (JSON.parse(text) as { stream?: unknown }).stream === true;
  } catch {
    return false;
  }
}

function decodeProviderTraceBody(body: BodyInit | null | undefined): string | undefined {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("utf8");
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  }
  return undefined;
}

async function readProviderRequestJsonBody(
  request: Request | undefined,
  init: RequestInit | undefined,
): Promise<{ text: string; payload: unknown } | undefined> {
  const headers = request?.headers ?? new Headers(init?.headers);
  const contentType = headers.get("content-type") ?? "";
  if (contentType && !isJsonContentType(contentType)) {
    return undefined;
  }

  let text = decodeProviderTraceBody(init?.body ?? null);
  if (!text && request) {
    try {
      text = await request.clone().text();
    } catch {
      return undefined;
    }
  }
  if (!text?.trim()) {
    return undefined;
  }
  try {
    return { text, payload: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

function resolveProviderHttpPayloadTraceSource(model: Model, url: string): string {
  let endpoint = "request";
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith("/chat/completions")) {
      endpoint = "chat-completions";
    } else if (pathname.endsWith("/responses")) {
      endpoint = "responses";
    }
  } catch {
    // Keep the generic endpoint label for non-standard URL strings.
  }
  return `${model.api}-${endpoint}-http`;
}

function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const retryAfterMs = headers.get("retry-after-ms");
  if (retryAfterMs) {
    const trimmedRetryAfterMs = retryAfterMs.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmedRetryAfterMs)) {
      const milliseconds = asFiniteNumberInRange(parseStrictFiniteNumber(trimmedRetryAfterMs), {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
      });
      return milliseconds === undefined ? Number.POSITIVE_INFINITY : milliseconds / 1000;
    }
  }

  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return undefined;
  }

  const trimmedRetryAfterSeconds = retryAfter.trim();
  if (/^\d+$/.test(trimmedRetryAfterSeconds)) {
    return parseStrictNonNegativeInteger(trimmedRetryAfterSeconds) ?? Number.POSITIVE_INFINITY;
  }

  const trimmedRetryAfter = trimmedRetryAfterSeconds;
  if (!RETRY_AFTER_HTTP_DATE_RE.test(trimmedRetryAfter)) {
    return undefined;
  }

  const retryAt = parseRetryAfterHttpDateMs(trimmedRetryAfter);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  return Math.max(0, (retryAt - Date.now()) / 1000);
}

function parseRetryAfterHttpDateMs(value: string): number {
  const match = OBSOLETE_ASCTIME_HTTP_DATE_RE.exec(value);
  if (match) {
    const month = HTTP_DATE_MONTH_INDEX.get(match[1] ?? "");
    if (month === undefined) {
      return Number.NaN;
    }
    const year = Number.parseInt(match[6] ?? "", 10);
    const day = Number.parseInt((match[2] ?? "").trim(), 10);
    const hours = Number.parseInt(match[3] ?? "", 10);
    const minutes = Number.parseInt(match[4] ?? "", 10);
    const seconds = Number.parseInt(match[5] ?? "", 10);
    if (
      day < 1 ||
      day > 31 ||
      hours > 23 ||
      minutes > 59 ||
      seconds > 59 ||
      [year, day, hours, minutes, seconds].some((component) => !Number.isFinite(component))
    ) {
      return Number.NaN;
    }
    const timestamp = Date.UTC(year, month, day, hours, minutes, seconds);
    const parsedDate = new Date(timestamp);
    return parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month &&
      parsedDate.getUTCDate() === day &&
      parsedDate.getUTCHours() === hours &&
      parsedDate.getUTCMinutes() === minutes &&
      parsedDate.getUTCSeconds() === seconds
      ? timestamp
      : Number.NaN;
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  return Number.NaN;
}

function resolveMaxSdkRetryWaitSeconds(): number | undefined {
  const raw = process.env.OPENCLAW_SDK_RETRY_MAX_WAIT_SECONDS?.trim();
  if (!raw) {
    return DEFAULT_MAX_SDK_RETRY_WAIT_SECONDS;
  }

  if (/^(?:0|false|off|none|disabled)$/i.test(raw)) {
    return undefined;
  }

  if (!PLAIN_DECIMAL_NUMBER_RE.test(raw)) {
    return DEFAULT_MAX_SDK_RETRY_WAIT_SECONDS;
  }

  const seconds = asFiniteNumberInRange(parseStrictFiniteNumber(raw), {
    min: 0,
    minExclusive: true,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (seconds !== undefined) {
    return seconds;
  }

  return DEFAULT_MAX_SDK_RETRY_WAIT_SECONDS;
}

function shouldBypassLongSdkRetry(response: Response): boolean {
  const maxWaitSeconds = resolveMaxSdkRetryWaitSeconds();
  if (maxWaitSeconds === undefined) {
    return false;
  }

  const status = response.status;
  const stainlessRetryable = status === 408 || status === 409 || status === 429 || status >= 500;
  if (!stainlessRetryable) {
    return false;
  }

  const retryAfterSeconds = parseRetryAfterSeconds(response.headers);
  if (retryAfterSeconds !== undefined) {
    return retryAfterSeconds > maxWaitSeconds;
  }

  return status === 429;
}

const managedStreamCleanupRegistry = new FinalizationRegistry<{ finalize: () => Promise<void> }>(
  (held) => {
    void held.finalize();
  },
);

function buildManagedResponse(
  response: Response,
  release: () => Promise<void>,
  refreshTimeout?: () => void,
  localServiceLease?: ProviderLocalServiceLease,
): Response {
  const finalizeLocalServiceLease = () => {
    localServiceLease?.release();
  };
  if (!response.body) {
    void release().finally(finalizeLocalServiceLease);
    return response;
  }
  const source = response.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let released = false;
  const cleanupRegistrationToken = {};
  const finalize = async () => {
    if (released) {
      return;
    }
    released = true;
    managedStreamCleanupRegistry.unregister(cleanupRegistrationToken);
    try {
      await reader?.cancel().catch(() => undefined);
      await release().catch(() => undefined);
    } finally {
      finalizeLocalServiceLease();
    }
  };
  const wrappedBody = new ReadableStream<Uint8Array>({
    start() {
      reader = source.getReader();
    },
    async pull(controller) {
      try {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) {
          controller.close();
          await finalize();
          return;
        }
        refreshTimeout?.();
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        await finalize();
      }
    },
    async cancel(reason) {
      try {
        await reader?.cancel(reason);
      } finally {
        await finalize();
      }
    },
  });
  // Stream consumers should cancel deterministically; this catches abandoned
  // wrapper bodies so guarded dispatchers and local-service leases do not leak.
  managedStreamCleanupRegistry.register(wrappedBody, { finalize }, cleanupRegistrationToken);
  return new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function resolveModelRequestPolicy(model: Model) {
  const debugProxy = resolveDebugProxySettings();
  let explicitDebugProxyUrl: string | undefined;
  if (debugProxy.enabled && debugProxy.proxyUrl) {
    try {
      if (new URL(model.baseUrl).protocol === "https:") {
        explicitDebugProxyUrl = debugProxy.proxyUrl;
      }
    } catch {
      // Non-URL provider base URLs cannot use the debug proxy override safely.
    }
  }
  const request = mergeModelProviderRequestOverrides(getModelProviderRequestTransport(model), {
    proxy: explicitDebugProxyUrl
      ? {
          mode: "explicit-proxy",
          url: explicitDebugProxyUrl,
        }
      : undefined,
  });
  return resolveProviderRequestPolicyConfig({
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    capability: "llm",
    transport: "stream",
    request,
  });
}

export function resolveModelRequestTimeoutMs(
  model: Model,
  timeoutMs: number | undefined,
): number | undefined {
  if (timeoutMs !== undefined) {
    return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? clampTimerTimeoutMs(timeoutMs)
      : undefined;
  }
  const modelTimeoutMs = (model as { requestTimeoutMs?: unknown }).requestTimeoutMs;
  return typeof modelTimeoutMs === "number" && Number.isFinite(modelTimeoutMs) && modelTimeoutMs > 0
    ? clampTimerTimeoutMs(modelTimeoutMs)
    : undefined;
}

function buildModelRequestSignal(
  baseSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (timeoutMs === undefined) {
    return baseSignal;
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!baseSignal) {
    return timeoutSignal;
  }
  return AbortSignal.any([baseSignal, timeoutSignal]);
}

function resolveModelTransportSsrFPolicy(params: {
  model: Model;
  url: string;
  allowPrivateNetwork?: boolean;
  trustConfiguredBaseUrlOrigin?: boolean;
}): SsrFPolicy | undefined {
  // TF-0734: the same policy resolver is used by the validation probe.
  return resolveProviderNetworkPolicy({
    baseUrl: (params.model as { baseUrl?: unknown }).baseUrl,
    requestUrl: params.url,
    allowPrivateNetwork: params.allowPrivateNetwork,
    trustConfiguredBaseUrlOrigin: params.trustConfiguredBaseUrlOrigin,
  }).policy;
}

export class ProviderRequestAttemptBudgetExhaustedError extends Error {
  readonly code = "E_PROVIDER_REQUEST_ATTEMPT_BUDGET_EXHAUSTED";

  constructor() {
    super("provider request attempt budget exhausted");
    this.name = "ProviderRequestAttemptBudgetExhaustedError";
  }
}

export function buildGuardedModelFetch(
  model: Model,
  timeoutMs?: number,
  options?: { sanitizeSse?: boolean; attemptBudget?: RequestAttemptBudget },
  shadow?: ShadowReceiptOptions,
): typeof fetch {
  const requestConfig = resolveModelRequestPolicy(model);
  const dispatcherPolicy = buildProviderRequestDispatcherPolicy(requestConfig);
  const configuredProviderTimeoutMs = resolveModelRequestTimeoutMs(model, timeoutMs);
  const configuredAttemptBudget = options?.attemptBudget;
  // Quota identity is stable per model+credential; resolving it once per guarded fetch keeps the
  // per-attempt cost to one gate lookup.
  const outboundGroup = resolveProviderOutboundQuotaGroup({ model, requestConfig });
  let nextWireAttemptIndex = shadow?.wireAttemptIndex ?? 0;
  const summarizeError = (error: unknown): string => {
    if (!error || typeof error !== "object") {
      return `type=${typeof error}`;
    }
    const record = error as Record<string, unknown>;
    const cause =
      record.cause && typeof record.cause === "object"
        ? (record.cause as Record<string, unknown>)
        : undefined;
    const read = (value: unknown) => (typeof value === "string" ? value : typeof value);
    return [
      `name=${read(record.name)}`,
      `code=${read(record.code)}`,
      `causeName=${read(cause?.name)}`,
      `causeCode=${read(cause?.code)}`,
      `message=${error instanceof Error ? error.message : read(record.message)}`,
    ].join(" ");
  };
  return async (input, init) => {
    // NET-E (TF-0442): share the caller's logical deadline. An already-expired
    // deadline fails closed before any provider request is prepared, and a live
    // budget tightens the provider window to what remains.
    const ambientDeadline = getRequestDeadline();
    if (ambientDeadline && isRequestDeadlineExpired()) {
      throw new RequestDeadlineExceededError({
        deadlineAtMs: ambientDeadline.deadlineAtMs,
        stage: "provider",
        ...(ambientDeadline.requestId ? { requestId: ambientDeadline.requestId } : {}),
      });
    }
    const requestTimeoutMs = clampRequestTimeoutToDeadline(configuredProviderTimeoutMs);
    const attemptBudget = configuredAttemptBudget ?? getRequestAttemptBudget();
    const physicalAttempt = attemptBudget?.tryRecordAttempt({ layer: "provider-transport", outcome: "failure" });
    if (attemptBudget && physicalAttempt === undefined) {
      throw new ProviderRequestAttemptBudgetExhaustedError();
    }
    let localServiceLease: ProviderLocalServiceLease | undefined;
    const request = input instanceof Request ? new Request(input, init) : undefined;
    const url = appendProviderRequestAuthQuery(
      request?.url ??
        (input instanceof URL
          ? input.toString()
          : typeof input === "string"
            ? input
            : (() => {
                throw new Error("Unsupported fetch input for transport-aware model request");
              })()),
      requestConfig.auth,
    );
    const policy = resolveModelTransportSsrFPolicy({
      model,
      url,
      allowPrivateNetwork: requestConfig.allowPrivateNetwork,
      // Only operator-configured custom/local endpoints get exact-origin trust;
      // known public/native providers keep the default rebinding checks.
      trustConfiguredBaseUrlOrigin:
        !requestConfig.privateNetworkExplicitlyDenied &&
        (requestConfig.policy?.endpointClass === "custom" ||
          requestConfig.policy?.endpointClass === "local"),
    });
    const requestInit =
      request &&
      ({
        method: request.method,
        headers: request.headers,
        body: request.body ?? undefined,
        redirect: request.redirect,
        signal: request.signal,
        ...(request.body ? ({ duplex: "half" } as const) : {}),
      } satisfies RequestInit & { duplex?: "half" });
    const baseInit = requestInit ?? init;
    const shouldReadProviderBody = Boolean(shadow) || isProviderPayloadTraceEnabled();
    const providerBody = shouldReadProviderBody
      ? await readProviderRequestJsonBody(request, baseInit)
      : undefined;
    if (isProviderPayloadTraceEnabled() && providerBody !== undefined) {
      recordProviderPayloadTrace(
        undefined,
        providerBody.payload,
        resolveProviderHttpPayloadTraceSource(model, url),
      );
    }
    if (shadow) {
      const wireAttemptIndex = nextWireAttemptIndex;
      nextWireAttemptIndex += 1;
      let wireShadow: ShadowReceiptOptions = { ...shadow, wireAttemptIndex };
      if (providerBody) {
        // Stage 1 observational envelope. Digest/ref only; request bytes do not change.
        const endpointClass =
          requestConfig.policy?.endpointClass === "custom"
            ? "custom"
            : requestConfig.policy?.endpointClass === "local"
              ? "local"
              : "public";
        const envelope = buildStage1RequestEnvelope({
          body: providerBody.payload,
          bodyText: providerBody.text,
          providerId: model.provider,
          adapterId: model.api,
          modelId: model.id,
          url,
          method: request?.method ?? baseInit?.method ?? "POST",
          endpointClass,
          wireAttemptIndex,
          shadow: wireShadow,
        });
        if (envelope.ok) {
          wireShadow = { ...wireShadow, requestEnvelopeRef: envelope.envelopeRef };
        } else {
          recordShadowCensusFailure(
            "wire-capture",
            envelope.reason === "unregistered-transform"
              ? "unregistered-transform"
              : "request-envelope-incomplete",
          );
        }
        // Receipt writes are observational. A persistence failure is recorded by the
        // census diagnostics, while the guarded provider request continues unchanged.
        emitShadowWireReceipt(
          providerBody.text,
          {
            providerId: model.provider,
            adapterId: model.api,
            modelId: model.id,
            sessionKey: wireShadow.sessionKey,
            runId: wireShadow.runId,
            traceId: wireShadow.traceId,
            transformIds: wireShadow.transformIds,
            attemptIndex: wireShadow.attemptIndex,
            modelCallIndex: wireShadow.modelCallIndex,
            wireAttemptIndex,
          },
          wireShadow,
        );
        // Opt-in (default off): refuse an invalid/unknown request envelope before any
        // provider bytes go on the wire. The digest-only wire receipt above is already
        // persisted, so the refusal is observable without raw content. The default and
        // flag-off paths stay observational and byte-identical.
        if (!envelope.ok && resolveEnvelopeRejectEnabled(wireShadow)) {
          throw new ProviderEnvelopeRejectedError(envelope.reason);
        }
        if (wireShadow.rc03Plan) {
          // RC-03: WireReceipt/v1 at the guarded request boundary, bound to the
          // sealed CompilePlan and the final serialized body digest. Observational:
          // failures land in the census diagnostics, never in the send path.
          emitRc03WireReceipt(providerBody.text, wireShadow, {
            providerId: model.provider,
            adapterId: model.api,
            modelId: model.id,
            wireAttemptIndex,
          });
        }
      } else {
        recordShadowCensusFailure("wire-capture", "final-wire-body-unavailable");
      }
    }
    const synthesizeJsonAsSse = await requestBodyHasStreamTrue(request, baseInit);
    const baseSignal = baseInit?.signal ?? undefined;
    const localServiceSignal = buildModelRequestSignal(baseSignal, requestTimeoutMs);
    const guardedFetchOptions = {
      url,
      init: baseInit,
      capture: {
        meta: {
          provider: model.provider,
          api: model.api,
          model: model.id,
        },
      },
      dispatcherPolicy,
      timeoutMs: requestTimeoutMs,
      // Model requests target operator-configured provider endpoints. Connection-time
      // DNS pinning stalls streamed SSE responses through the custom pinned dispatcher
      // (the resolve-time hostname/IP SSRF policy check still runs via pinDns=false),
      // so model transport uses a non-pinned dispatcher to keep streaming reliable.
      pinDns: false as const,
      ...(baseSignal ? { signal: baseSignal } : {}),
      // Provider transport intentionally keeps the secure default and never
      // replays unsafe request bodies across cross-origin redirects.
      allowCrossOriginUnsafeRedirectReplay: false,
      ...(policy ? { policy } : {}),
    };
    let result: Awaited<ReturnType<typeof fetchWithSsrFGuard>>;
    const fetchStartedAt = Date.now();
    const useEnvProxy = !dispatcherPolicy && shouldUseEnvHttpProxyForUrl(url);
    // Shared outbound concurrency budget (issue #154). Admission happens before the local
    // provider sidecar starts and before any bytes go on the wire, so a refused request never
    // enters the expensive path. The slot is released only where the guarded request is
    // confirmed finished — stream end, stream cancel, error, or dispatcher release — never by an
    // upper-layer timeout that leaves the physical request alive.
    const admission = await acquireProviderOutboundSlot({
      group: outboundGroup,
      ...(baseSignal ? { signal: baseSignal } : {}),
    });
    if (!admission.ok) {
      throw new ProviderOutboundOverloadedError({
        model,
        reason: admission.reason,
        endpoint: outboundGroup.endpoint,
        waitedMs: admission.waitedMs,
        snapshot: admission.snapshot,
      });
    }
    const outboundSlot = admission.slot;
    let outboundSlotReleased = false;
    const releaseOutboundSlot = (): boolean => {
      if (outboundSlotReleased) {
        return false;
      }
      outboundSlotReleased = true;
      return outboundSlot.release();
    };
    const releaseGuardedRequest = async (): Promise<void> => {
      try {
        await result.release();
      } finally {
        releaseOutboundSlot();
      }
    };
    // NET-C: the endpoint health gate sits after budget admission so a circuit
    // refusal never counts as a budget rejection (and vice versa). An open
    // endpoint fails fast here, before any provider request is sent.
    const endpointAdmission = admitProviderEndpointRequest(outboundGroup);
    if (!endpointAdmission.ok) {
      releaseOutboundSlot();
      throw new ProviderEndpointCircuitOpenError({
        model,
        endpoint: endpointAdmission.endpoint,
        retryAfterMs: endpointAdmission.retryAfterMs,
        snapshot: endpointAdmission.snapshot,
      });
    }
    const endpointTicket = endpointAdmission.ticket;
    emitModelTransportDebug(
      log,
      `[model-fetch] start provider=${model.provider} api=${model.api} model=${model.id} ` +
        `method=${baseInit?.method ?? "GET"} url=${formatModelTransportDebugUrl(url)} timeoutMs=${requestTimeoutMs} ` +
        `proxy=${dispatcherPolicy ? "configured" : useEnvProxy ? "env" : "none"} ` +
        `policy=${policy ? "custom" : "default"} ` +
        `outbound=${outboundSlot.limited ? "gated" : "ungated"} admissionWaitMs=${outboundSlot.waitedMs} ` +
        `endpointHealth=${endpointTicket.getSnapshot().state}`,
    );
    try {
      localServiceLease = await ensureModelProviderLocalService(
        model,
        baseInit?.headers,
        localServiceSignal,
      );
      result = await fetchWithSsrFGuard(
        useEnvProxy
          ? withTrustedEnvProxyGuardedFetchMode(guardedFetchOptions)
          : guardedFetchOptions,
      );
    } catch (error) {
      log.warn(
        `[model-fetch] error provider=${model.provider} api=${model.api} model=${model.id} ` +
          `elapsedMs=${Date.now() - fetchStartedAt} ${summarizeError(error)}`,
      );
      endpointTicket.record("failure");
      localServiceLease?.release();
      releaseOutboundSlot();
      throw error;
    }
    let response = result.response;
    emitModelTransportDebug(
      log,
      `[model-fetch] response provider=${model.provider} api=${model.api} model=${model.id} ` +
        `status=${response.status} elapsedMs=${Date.now() - fetchStartedAt} ` +
        `contentType=${response.headers.get("content-type") ?? ""}`,
    );
    if (attemptBudget && physicalAttempt !== undefined) {
      attemptBudget.completeAttempt(physicalAttempt, response.ok ? "success" : "failure");
    }
    endpointTicket.record(classifyProviderEndpointResponse(response.status));
    if (shouldBypassLongSdkRetry(response)) {
      const headers = new Headers(response.headers);
      headers.set("x-should-retry", "false");
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    if (synthesizeJsonAsSse && options?.sanitizeSse !== false) {
      response = await normalizeOpenAISdkStreamContentType({
        response,
        model,
        release: releaseGuardedRequest,
        localServiceLease,
      });
    }
    response = buildManagedResponse(
      response,
      releaseGuardedRequest,
      result.refreshTimeout,
      localServiceLease,
    );
    return options?.sanitizeSse === false || !shouldSanitizeOpenAISdkSseResponse(model)
      ? response
      : sanitizeOpenAISdkSseResponse(response, { synthesizeJsonAsSse });
  };
}
