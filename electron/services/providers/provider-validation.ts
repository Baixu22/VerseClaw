import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getProviderConfig } from '../../utils/provider-registry';
import {
  appendProviderRequestAuthQuery,
  providerRequestAuthHeaders,
  resolveProviderRequestAuth,
  type ProviderRequestAuthOverride,
} from '@openclaw/provider-request-auth';
import type {
  ProviderValidationReason,
  ProviderValidationResult,
  ProviderValidationState,
} from '@shared/host-api/contract';

type ValidationProfile =
  | 'openai-completions'
  | 'openai-responses'
  | 'google-query-key'
  | 'anthropic-header'
  | 'openrouter'
  | 'none';

type ValidationResult = ProviderValidationResult;
export type ProviderModelListResult = {
  success: boolean;
  models: string[];
  error?: string;
  status?: number;
  /** TF-0733: structured outcome, present on the cancellation/failure paths. */
  state?: ProviderValidationState;
};
type ClassifiedValidationResult = ProviderValidationResult & { authFailure?: boolean };

/** UI-level auth format accepted from the custom provider dialog. */
export type ProviderValidationAuthInput = {
  mode: 'bearer' | 'custom-header' | 'query' | 'none';
  headerName?: string;
  prefix?: string;
  parameterName?: string;
};

type ValidationOptions = {
  baseUrl?: string;
  apiProtocol?: string;
  auth?: ProviderValidationAuthInput;
};

/**
 * Converts the UI auth selection + API key into the runtime auth override and
 * resolves it through the SAME shared resolver the transport uses
 * (openclaw_runtime/src/agents/provider-request-auth.ts), so a probe that
 * passes validation can never be sent with a different format by the real
 * transport.
 */
export function buildProviderValidationAuth(
  auth: ProviderValidationAuthInput | undefined,
  apiKey: string,
): { headers?: Record<string, string>; query?: Record<string, string> } {
  // No auth input: callers keep their legacy default (Bearer / x-api-key).
  if (!auth) {
    return { headers: undefined };
  }
  // Explicit "none": no auth header at all (empty object suppresses the fallback).
  if (auth.mode === 'none') {
    return { headers: {} };
  }
  const value = apiKey.trim();
  let override: ProviderRequestAuthOverride | undefined;
  if (auth.mode === 'bearer' && value) {
    override = { mode: 'authorization-bearer', token: value };
  } else if (auth.mode === 'custom-header' && auth.headerName?.trim() && value) {
    override = {
      mode: 'header',
      headerName: auth.headerName.trim(),
      value,
      ...(auth.prefix && auth.prefix.trim() ? { prefix: auth.prefix } : {}),
    };
  } else if (auth.mode === 'query' && auth.parameterName?.trim() && value) {
    override = { mode: 'query', parameterName: auth.parameterName.trim(), value };
  }
  if (!override) {
    return {};
  }
  const resolved = resolveProviderRequestAuth({ auth: override });
  return {
    ...(providerRequestAuthHeaders(resolved) ? { headers: providerRequestAuthHeaders(resolved) } : {}),
    ...(resolved.configured && resolved.mode === 'query'
      ? { query: { [resolved.parameterName]: resolved.value } }
      : {}),
  };
}

/** Appends resolved auth query params to a validation probe URL. */
export function applyProviderValidationAuthQuery(
  url: string,
  auth: ProviderValidationAuthInput | undefined,
  apiKey: string,
): string {
  const value = apiKey.trim();
  if (auth?.mode !== 'query' || !auth.parameterName?.trim() || !value) {
    return url;
  }
  return appendProviderRequestAuthQuery(
    url,
    resolveProviderRequestAuth({
      auth: { mode: 'query', parameterName: auth.parameterName.trim(), value },
    }),
  );
}

const AUTH_ERROR_PATTERN = /\b(unauthorized|forbidden|access denied|invalid api key|api key invalid|incorrect api key|api key incorrect|authentication failed|auth failed|invalid credential|credential invalid|invalid signature|signature invalid|invalid access token|access token invalid|invalid bearer token|bearer token invalid|access token expired)\b|鉴权失败|認証失敗|认证失败|無效密鑰|无效密钥|密钥无效|密鑰無效|憑證無效|凭证无效/i;
const AUTH_ERROR_CODE_PATTERN = /\b(unauthorized|forbidden|access[_-]?denied|invalid[_-]?api[_-]?key|api[_-]?key[_-]?invalid|incorrect[_-]?api[_-]?key|api[_-]?key[_-]?incorrect|authentication[_-]?failed|auth[_-]?failed|invalid[_-]?credential|credential[_-]?invalid|invalid[_-]?signature|signature[_-]?invalid|invalid[_-]?access[_-]?token|access[_-]?token[_-]?invalid|invalid[_-]?bearer[_-]?token|bearer[_-]?token[_-]?invalid|access[_-]?token[_-]?expired|invalid[_-]?token|token[_-]?invalid|token[_-]?expired)\b/i;

function logValidationStatus(provider: string, status: number): void {
  console.log(`[clawx-validate] ${provider} HTTP ${status}`);
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValidationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const key = url.searchParams.get('key');
    if (key) url.searchParams.set('key', maskSecret(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  if (next.Authorization?.startsWith('Bearer ')) {
    const token = next.Authorization.slice('Bearer '.length);
    next.Authorization = `Bearer ${maskSecret(token)}`;
  }
  if (next['x-api-key']) {
    next['x-api-key'] = maskSecret(next['x-api-key']);
  }
  return next;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models?limit=1`;
}

function buildOpenAiFullModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

function resolveOpenAiProbeUrls(
  baseUrl: string,
  apiProtocol: 'openai-completions' | 'openai-responses',
): { modelsUrl: string; probeUrl: string } {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const endpointSuffixPattern = /(\/responses?|\/chat\/completions)$/;
  const rootBase = normalizedBase.replace(endpointSuffixPattern, '');
  const modelsUrl = buildOpenAiModelsUrl(rootBase);

  if (apiProtocol === 'openai-responses') {
    const probeUrl = /(\/responses?)$/.test(normalizedBase)
      ? normalizedBase
      : `${rootBase}/responses`;
    return { modelsUrl, probeUrl };
  }

  const probeUrl = /\/chat\/completions$/.test(normalizedBase)
    ? normalizedBase
    : `${rootBase}/chat/completions`;
  return { modelsUrl, probeUrl };
}

function logValidationRequest(
  provider: string,
  method: string,
  url: string,
  headers: Record<string, string>,
): void {
  console.log(
    `[clawx-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`,
  );
}

function getValidationProfile(
  providerType: string,
  options?: { apiProtocol?: string }
): ValidationProfile {
  const providerApi = options?.apiProtocol || getProviderConfig(providerType)?.api;
  if (providerApi === 'anthropic-messages') {
    return 'anthropic-header';
  }
  if (providerApi === 'openai-responses') {
    return 'openai-responses';
  }
  if (providerApi === 'openai-completions') {
    return 'openai-completions';
  }

  switch (providerType) {
    case 'anthropic':
      return 'anthropic-header';
    case 'google':
      return 'google-query-key';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'none';
    default:
      return 'openai-completions';
  }
}

function uniqueModelIds(models: string[]): string[] {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function extractModelId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  for (const key of ['id', 'name', 'model', 'modelId']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function extractModelIds(data: unknown): string[] {
  if (Array.isArray(data)) {
    return uniqueModelIds(data.map(extractModelId).filter((model): model is string => Boolean(model)));
  }
  if (!data || typeof data !== 'object') {
    return [];
  }
  const record = data as Record<string, unknown>;
  for (const key of ['data', 'models', 'items']) {
    const value = record[key];
    if (Array.isArray(value)) {
      return uniqueModelIds(value.map(extractModelId).filter((model): model is string => Boolean(model)));
    }
  }
  return [];
}

const UNKNOWN_VALIDATION_STATE: ProviderValidationState = {
  reachable: 'unknown',
  auth: 'unknown',
  protocol: 'unknown',
  model: 'unknown',
  rateLimited: false,
  ready: false,
  reason: 'unknown',
};

function toValidationState(result: ProviderValidationResult): ProviderValidationState {
  return {
    reachable: result.reachable,
    auth: result.auth,
    protocol: result.protocol,
    model: result.model,
    rateLimited: result.rateLimited,
    ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
    ready: result.ready,
    reason: result.reason,
  };
}

function noAuthValidationResult(): ProviderValidationResult {
  return {
    ...UNKNOWN_VALIDATION_STATE,
    auth: 'valid',
    ready: true,
    reason: 'ok',
    valid: true,
  };
}

function unknownValidationResult(error?: string): ProviderValidationResult {
  return {
    ...UNKNOWN_VALIDATION_STATE,
    valid: false,
    ...(error !== undefined ? { error } : {}),
  };
}

const MODEL_ERROR_PATTERN =
  /(invalid|unknown|unsupported|not[_ -]?found|does not exist|no such|unavailable|deprecated|missing)[^\n]{0,24}\b(model|deployment)\b|\b(model|deployment)\b[^\n]{0,24}(invalid|unknown|unsupported|not[_ -]?found|does not exist|no such|unavailable|deprecated|missing)|invalid[_ -]?model|model[_ -]?not[_ -]?found/i;

/** Parse an HTTP `Retry-After` header (delay-seconds or HTTP-date) into ms. */
function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : undefined;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Classify a transport-level failure (timeout / DNS / SSRF-blocked / proxy). */
function classifyNetworkFailure(error: unknown): ClassifiedValidationResult {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  let reason: ProviderValidationReason = 'network-error';
  if (/abort|timed?\s?out|etimedout|timeout|deadline/.test(lowered)) {
    reason = 'timeout';
  } else if (/enotfound|eai_again|getaddrinfo|dns|name resolution|nodename nor servname/.test(lowered)) {
    reason = 'dns-error';
  } else if (/ssrf|private|blocked|not allowed|forbidden host|metadata|link-?local|loopback/.test(lowered)) {
    reason = 'blocked';
  }
  return {
    reachable: 'unreachable',
    auth: 'unknown',
    protocol: 'unknown',
    model: 'unknown',
    rateLimited: false,
    ready: false,
    reason,
    valid: false,
    error: `Connection error: ${message}`,
  };
}

/**
 * TF-0733: classify one HTTP response into the six validation dimensions.
 *
 * `stage` distinguishes the `/models` credential probe from the chat/responses
 * fallback probe: a non-auth 400 on the fallback probe means the endpoint
 * understood our auth + protocol and rejected the dummy model or a parameter,
 * so it is NOT a credential failure and must NOT be reported as ready.
 */
function classifyHttpResponse(
  stage: 'models' | 'probe',
  status: number,
  data: unknown,
  headers?: Headers,
  options?: { requireModel?: boolean },
): ClassifiedValidationResult {
  const obj = data as {
    error?: { message?: string; code?: string };
    message?: string;
    code?: string;
  } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  const code = obj?.error?.code || obj?.code;
  const hasAuthCode = typeof code === 'string' && AUTH_ERROR_CODE_PATTERN.test(code);
  const authLike = AUTH_ERROR_PATTERN.test(msg) || hasAuthCode;

  if (status >= 200 && status < 300) {
    const models = extractModelIds(data);
    // A /models 200 with an empty list proves the credential but not a usable
    // model, so `ready` (and therefore the UI's "verified" copy) waits for the
    // Model step to confirm one.
    const requiresModelList = stage === 'models' && options?.requireModel === true;
    const model = stage === 'models'
      ? (models.length > 0 ? 'available' : (requiresModelList ? 'unavailable' : 'unknown'))
      : 'available';
    const ready = !requiresModelList || models.length > 0;
    return {
      reachable: 'reachable',
      auth: 'valid',
      protocol: 'compatible',
      model,
      rateLimited: false,
      // A 2xx proves the credential. Readiness additionally needs a listed
      // model when the caller asked for one (OpenRouter's /auth/key does not).
      ready,
      reason: ready ? 'ok' : 'model-unavailable',
      valid: true,
      status,
    };
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(headers?.get('retry-after'));
    return {
      reachable: 'reachable',
      auth: 'unknown',
      protocol: 'unknown',
      model: 'unknown',
      rateLimited: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ready: false,
      reason: 'rate-limited',
      valid: false,
      error: msg === `API error: ${status}` ? 'Rate limited' : msg,
      status,
    };
  }

  if (status === 401 || status === 403) {
    return {
      reachable: 'reachable',
      auth: 'invalid',
      protocol: 'unknown',
      model: 'unknown',
      rateLimited: false,
      ready: false,
      reason: 'unauthorized',
      valid: false,
      error: 'Invalid API key',
      authFailure: true,
      status,
    };
  }

  if (status === 400 && authLike) {
    const error = hasAuthCode && msg === `API error: ${status}`
      ? `Invalid API key (${code})`
      : msg || 'Invalid API key';
    return {
      reachable: 'reachable',
      auth: 'invalid',
      protocol: 'unknown',
      model: 'unknown',
      rateLimited: false,
      ready: false,
      reason: 'unauthorized',
      valid: false,
      error,
      authFailure: true,
      status,
    };
  }

  if (status >= 500) {
    return {
      reachable: 'reachable',
      auth: 'unknown',
      protocol: 'unknown',
      model: 'unknown',
      rateLimited: false,
      ready: false,
      reason: 'server-error',
      valid: false,
      error: msg,
      status,
    };
  }

  const modelLike = MODEL_ERROR_PATTERN.test(msg) || (typeof code === 'string' && /model/i.test(code));

  if (stage === 'probe' && status === 400) {
    if (modelLike) {
      return {
        reachable: 'reachable',
        auth: 'valid',
        protocol: 'compatible',
        model: 'unavailable',
        rateLimited: false,
        ready: false,
        reason: 'model-unavailable',
        valid: true,
        error: msg,
        status,
      };
    }
    return {
      reachable: 'reachable',
      auth: 'valid',
      // A non-auth 400 on the chat/responses probe means the endpoint
      // understood the credential but rejected the request shape/parameters,
      // so the protocol dimension is genuinely incompatible. This also keeps
      // the compatibility `valid` field false for non-auth 400s.
      protocol: 'incompatible',
      model: 'unknown',
      rateLimited: false,
      ready: false,
      reason: 'protocol-error',
      valid: false,
      error: msg,
      status,
    };
  }

  if (status === 404 && modelLike) {
    return {
      reachable: 'reachable',
      auth: 'unknown',
      protocol: 'compatible',
      model: 'unavailable',
      rateLimited: false,
      ready: false,
      reason: 'model-unavailable',
      valid: false,
      error: msg,
      status,
    };
  }

  if (status === 404 || status === 405 || status === 501) {
    return {
      reachable: 'reachable',
      auth: 'unknown',
      protocol: 'incompatible',
      model: 'unknown',
      rateLimited: false,
      ready: false,
      reason: 'protocol-error',
      valid: false,
      error: msg,
      status,
    };
  }

  if (modelLike) {
    return {
      reachable: 'reachable',
      auth: 'unknown',
      protocol: 'compatible',
      model: 'unavailable',
      rateLimited: false,
      ready: false,
      reason: 'model-unavailable',
      valid: false,
      error: msg,
      status,
    };
  }

  return {
    reachable: 'reachable',
    auth: 'unknown',
    protocol: 'incompatible',
    model: 'unknown',
    rateLimited: false,
    ready: false,
    reason: 'protocol-error',
    valid: false,
    error: msg,
    status,
  };
}

async function performProviderValidationRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
  options?: { requireModel?: boolean },
): Promise<ClassifiedValidationResult> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    // Model-listing probes require a non-empty list to count as ready; the
    // OpenRouter /auth/key probe proves the credential only.
    return classifyHttpResponse('models', response.status, data, response.headers, options);
  } catch (error) {
    return classifyNetworkFailure(error);
  }
}

function classifyAuthResponse(
  status: number,
  data: unknown,
  headers?: Headers,
  options?: { requireModel?: boolean },
): ClassifiedValidationResult {
  return classifyHttpResponse('models', status, data, headers, options);
}

function shouldFallbackFromModelsProbe(result: ClassifiedValidationResult): boolean {
  if (result.valid || result.status === undefined) return false;
  if (result.rateLimited) return false;
  if (result.status === 401 || result.status === 403) return false;
  if (result.authFailure) return false;
  return true;
}

function classifyProbeResponse(
  status: number,
  data: unknown,
  headers?: Headers,
): ClassifiedValidationResult {
  return classifyHttpResponse('probe', status, data, headers);
}

async function validateOpenAiCompatibleKey(
  providerType: string,
  apiKey: string,
  apiProtocol: 'openai-completions' | 'openai-responses',
  baseUrl?: string,
  auth?: ProviderValidationAuthInput,
): Promise<ValidationResult> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return unknownValidationResult(`Base URL is required for provider "${providerType}" validation`);
  }

  const authHeaders = buildProviderValidationAuth(auth, apiKey).headers ?? {
    Authorization: `Bearer ${apiKey}`,
  };
  const { modelsUrl, probeUrl } = resolveOpenAiProbeUrls(trimmedBaseUrl, apiProtocol);
  const authModelsUrl = applyProviderValidationAuthQuery(modelsUrl, auth, apiKey);
  const authProbeUrl = applyProviderValidationAuthQuery(probeUrl, auth, apiKey);
  const modelsResult = await performProviderValidationRequest(providerType, authModelsUrl, authHeaders, { requireModel: true });

  if (shouldFallbackFromModelsProbe(modelsResult)) {
    console.log(
      `[clawx-validate] ${providerType} /models returned ${modelsResult.status}, falling back to ${apiProtocol} probe`,
    );
    if (apiProtocol === 'openai-responses') {
      return await performResponsesProbe(providerType, authProbeUrl, authHeaders);
    }
    return await performChatCompletionsProbe(providerType, authProbeUrl, authHeaders);
  }

  return modelsResult;
}

async function performResponsesProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        input: 'hi',
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyProbeResponse(response.status, data, response.headers);
  } catch (error) {
    return classifyNetworkFailure(error);
  }
}

async function performChatCompletionsProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyProbeResponse(response.status, data, response.headers);
  } catch (error) {
    return classifyNetworkFailure(error);
  }
}

async function performAnthropicMessagesProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyProbeResponse(response.status, data, response.headers);
  } catch (error) {
    return classifyNetworkFailure(error);
  }
}

async function validateGoogleQueryKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidationResult> {
  const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const url = `${base}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  return await performProviderValidationRequest(providerType, url, {});
}

async function validateAnthropicHeaderKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
  auth?: ProviderValidationAuthInput,
): Promise<ValidationResult> {
  const rawBase = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const base = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
  const authHeaders = buildProviderValidationAuth(auth, apiKey).headers ?? {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  const url = applyProviderValidationAuthQuery(`${base}/models?limit=1`, auth, apiKey);
  const headers = {
    ...(authHeaders['anthropic-version'] ? {} : { 'anthropic-version': '2023-06-01' }),
    ...authHeaders,
  };

  const modelsResult = await performProviderValidationRequest(providerType, url, headers, { requireModel: true });

  // If the endpoint doesn't implement /models (like Minimax Anthropic compatibility), fallback to a /messages probe.
  if (
    modelsResult.status === 404 ||
    modelsResult.status === 400 ||
    modelsResult.error?.includes('API error: 404') ||
    modelsResult.error?.includes('API error: 400')
  ) {
    console.log(
      `[clawx-validate] ${providerType} /models returned error, falling back to /messages probe`,
    );
    const messagesUrl = applyProviderValidationAuthQuery(`${base}/messages`, auth, apiKey);
    return await performAnthropicMessagesProbe(providerType, messagesUrl, headers);
  }

  return modelsResult;
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string,
): Promise<ValidationResult> {
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers, { requireModel: false });
}

async function listOpenAiCompatibleModels(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
  auth?: ProviderValidationAuthInput,
): Promise<ProviderModelListResult> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { success: false, models: [], error: `Base URL is required for provider "${providerType}" model discovery` };
  }

  const url = applyProviderValidationAuthQuery(
    buildOpenAiFullModelsUrl(trimmedBaseUrl.replace(/(\/responses?|\/chat\/completions)$/, '')),
    auth,
    apiKey,
  );
  const headers = buildProviderValidationAuth(auth, apiKey).headers ?? {
    Authorization: `Bearer ${apiKey}`,
  };
  try {
    logValidationRequest(providerType, 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers });
    logValidationStatus(providerType, response.status);
    const data = await response.json().catch(() => ({}));
    const classified = classifyAuthResponse(response.status, data, response.headers);
    if (!classified.valid) {
      return {
        success: false,
        models: [],
        error: classified.error,
        status: response.status,
        state: toValidationState(classified),
      };
    }
    return {
      success: true,
      models: extractModelIds(data),
      status: response.status,
      state: toValidationState(classified),
    };
  } catch (error) {
    const failure = classifyNetworkFailure(error);
    return {
      success: false,
      models: [],
      error: failure.error,
      state: toValidationState(failure),
    };
  }
}

async function listGoogleModels(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ProviderModelListResult> {
  const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const url = `${base}/models?key=${encodeURIComponent(apiKey)}`;
  try {
    logValidationRequest(providerType, 'GET', url, {});
    const response = await proxyAwareFetch(url, {});
    logValidationStatus(providerType, response.status);
    const data = await response.json().catch(() => ({}));
    const result = classifyAuthResponse(response.status, data, response.headers);
    if (!result.valid) {
      return {
        success: false,
        models: [],
        error: result.error,
        status: response.status,
        state: toValidationState(result),
      };
    }
    const models = extractModelIds(data).map((model) => model.replace(/^models\//, ''));
    return {
      success: true,
      models,
      status: response.status,
      state: toValidationState(result),
    };
  } catch (error) {
    const failure = classifyNetworkFailure(error);
    return { success: false, models: [], error: failure.error, state: toValidationState(failure) };
  }
}

async function listAnthropicModels(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
  auth?: ProviderValidationAuthInput,
): Promise<ProviderModelListResult> {
  const rawBase = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const base = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
  const url = applyProviderValidationAuthQuery(`${base}/models`, auth, apiKey);
  const authHeaders = buildProviderValidationAuth(auth, apiKey).headers ?? {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  const headers = {
    ...(authHeaders['anthropic-version'] ? {} : { 'anthropic-version': '2023-06-01' }),
    ...authHeaders,
  };
  try {
    logValidationRequest(providerType, 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers });
    logValidationStatus(providerType, response.status);
    const data = await response.json().catch(() => ({}));
    const classified = classifyAuthResponse(response.status, data, response.headers);
    if (!classified.valid) {
      return {
        success: false,
        models: [],
        error: classified.error,
        status: response.status,
        state: toValidationState(classified),
      };
    }
    return {
      success: true,
      models: extractModelIds(data),
      status: response.status,
      state: toValidationState(classified),
    };
  } catch (error) {
    const failure = classifyNetworkFailure(error);
    return { success: false, models: [], error: failure.error, state: toValidationState(failure) };
  }
}

export async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: ValidationOptions,
): Promise<ValidationResult> {
  const profile = getValidationProfile(providerType, options);
  const resolvedBaseUrl = options?.baseUrl || getProviderConfig(providerType)?.baseUrl;
  const auth = options?.auth;

  if (profile === 'none') {
    return noAuthValidationResult();
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return unknownValidationResult('API key is required');
  }

  try {
    switch (profile) {
      case 'openai-completions':
        return await validateOpenAiCompatibleKey(
          providerType,
          trimmedKey,
          'openai-completions',
          resolvedBaseUrl,
          auth,
        );
      case 'openai-responses':
        return await validateOpenAiCompatibleKey(
          providerType,
          trimmedKey,
          'openai-responses',
          resolvedBaseUrl,
          auth,
        );
      case 'google-query-key':
        return await validateGoogleQueryKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'anthropic-header':
        return await validateAnthropicHeaderKey(providerType, trimmedKey, resolvedBaseUrl, auth);
      case 'openrouter':
        return await validateOpenRouterKey(providerType, trimmedKey);
      default:
        return unknownValidationResult(`Unsupported validation profile for provider: ${providerType}`);
    }
  } catch (error) {
    return classifyNetworkFailure(error);
  }
}

export async function listModelsWithProvider(
  providerType: string,
  apiKey: string,
  options?: ValidationOptions,
): Promise<ProviderModelListResult> {
  const profile = getValidationProfile(providerType, options);
  const resolvedBaseUrl = options?.baseUrl || getProviderConfig(providerType)?.baseUrl;
  const trimmedKey = apiKey.trim();
  const auth = options?.auth;

  if (profile === 'none') {
    return {
      success: true,
      models: [],
      state: {
        reachable: 'unknown',
        auth: 'valid',
        protocol: 'unknown',
        model: 'unknown',
        rateLimited: false,
        ready: true,
        reason: 'ok',
      },
    };
  }
  if (!trimmedKey) {
    return {
      success: false,
      models: [],
      error: 'API key is required',
      state: toValidationState(unknownValidationResult('API key is required')),
    };
  }

  switch (profile) {
    case 'google-query-key':
      return await listGoogleModels(providerType, trimmedKey, resolvedBaseUrl);
    case 'anthropic-header':
      return await listAnthropicModels(providerType, trimmedKey, resolvedBaseUrl, auth);
    case 'openrouter':
    case 'openai-completions':
    case 'openai-responses':
      return await listOpenAiCompatibleModels(providerType, trimmedKey, resolvedBaseUrl, auth);
    default:
      return {
        success: false,
        models: [],
        error: `Unsupported model discovery profile for provider: ${providerType}`,
        state: toValidationState(unknownValidationResult()),
      };
  }
}
