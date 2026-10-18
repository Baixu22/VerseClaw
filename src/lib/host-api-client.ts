import type {
  HostApiAction,
  HostApiModule,
  HostApiPayloadArgs,
  HostApiResult,
} from '@shared/host-api/contract';
import type { HostResponse, TypedHostRequest } from '@shared/host-api/types';
import { hostActionTimeoutMs } from '@shared/host-api/host-action-timeouts';
import { AppError, mapBackendErrorCode, normalizeAppError } from './error-model';
import { recordRendererIpcSample } from './performance-metrics';

/** Renderer-side margin above the Main-process budget (Main wins the race). */
const RENDERER_TIMEOUT_MARGIN_MS = 10_000;

type AgentDevMockReplayMode = 'off' | 'record' | 'replay';
type AgentDevHostApiFixture = {
  module: string;
  action: string;
  payload?: unknown;
  result: unknown;
};
type AgentDevHostApiCall = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  mocked?: boolean;
  ok?: boolean;
  error?: string;
};
type AgentDevReplayConfig = {
  mode?: AgentDevMockReplayMode;
  fixtures?: AgentDevHostApiFixture[];
};
type ReplayableHostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

const AGENT_DEV_REPLAY_STORAGE_KEY = 'clawx.agentDev.hostApiReplay';

function createRequestId(): string {
  return crypto.randomUUID();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRequestId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,200}$/.test(trimmed) ? trimmed : fallback;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function getAgentDevSurface(): {
  hostApiCalls?: AgentDevHostApiCall[];
  hostApiReplay?: AgentDevReplayConfig;
} | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as {
      __CLAWX_TEST__?: {
        hostApiCalls?: AgentDevHostApiCall[];
        hostApiReplay?: AgentDevReplayConfig;
      };
    }).__CLAWX_TEST__;
}

function readStoredReplayConfig(): AgentDevReplayConfig | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(AGENT_DEV_REPLAY_STORAGE_KEY);
    return raw ? JSON.parse(raw) as AgentDevReplayConfig : null;
  } catch {
    return null;
  }
}

function writeStoredReplayConfig(config: AgentDevReplayConfig): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(AGENT_DEV_REPLAY_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage can be disabled in hardened browser contexts.
  }
}

function getReplayConfig(): AgentDevReplayConfig {
  return getAgentDevSurface()?.hostApiReplay ?? readStoredReplayConfig() ?? { mode: 'off', fixtures: [] };
}

function rememberHostApiCall(call: AgentDevHostApiCall): void {
  if (typeof call.durationMs === 'number') {
    recordRendererIpcSample({
      module: call.module,
      action: call.action,
      durationMs: call.durationMs,
      ok: call.ok === true,
    });
  }
  const surface = getAgentDevSurface();
  if (!surface) return;
  const calls = surface.hostApiCalls ?? [];
  calls.push(call);
  if (calls.length > 500) calls.splice(0, calls.length - 500);
  surface.hostApiCalls = calls;
}

function findFixture(config: AgentDevReplayConfig, request: ReplayableHostRequest): AgentDevHostApiFixture | null {
  const fixtures = Array.isArray(config.fixtures) ? config.fixtures : [];
  const exact = stableStringify([request.module, request.action, request.payload ?? null]);
  const fallback = stableStringify([request.module, request.action, null]);
  return fixtures.find((fixture) => (
    stableStringify([fixture.module, fixture.action, fixture.payload ?? null]) === exact
      || stableStringify([fixture.module, fixture.action, null]) === fallback
  )) ?? null;
}

function recordFixture(
  config: AgentDevReplayConfig,
  request: ReplayableHostRequest,
  result: unknown,
): void {
  if (config.mode !== 'record') return;
  const fixtures = Array.isArray(config.fixtures) ? [...config.fixtures] : [];
  const nextFixture = {
    module: request.module,
    action: request.action,
    payload: request.payload,
    result,
  };
  const nextKey = stableStringify([nextFixture.module, nextFixture.action, nextFixture.payload ?? null]);
  const existingIndex = fixtures.findIndex((fixture) => (
    stableStringify([fixture.module, fixture.action, fixture.payload ?? null]) === nextKey
  ));
  if (existingIndex >= 0) fixtures[existingIndex] = nextFixture;
  else fixtures.push(nextFixture);
  const nextConfig = { ...config, fixtures };
  const surface = getAgentDevSurface();
  if (surface) surface.hostApiReplay = nextConfig;
  writeStoredReplayConfig(nextConfig);
}

export async function invokeHost<
  M extends HostApiModule,
  A extends HostApiAction<M>,
>(
  module: M,
  action: A,
  ...payloadArgs: HostApiPayloadArgs<M, A>
): Promise<HostApiResult<M, A>> {
  const request: TypedHostRequest<M, A> = {
    id: createRequestId(),
    module,
    action,
  };
  if (payloadArgs.length > 0) {
    request.payload = payloadArgs[0];
  }

  const replayConfig = getReplayConfig();
  const startedAt = Date.now();
  const call: AgentDevHostApiCall = {
    id: request.id,
    module,
    action,
    payload: request.payload,
    startedAt,
  };

  const fixture = replayConfig.mode === 'replay' ? findFixture(replayConfig, request) : null;
  if (fixture) {
    call.endedAt = Date.now();
    call.durationMs = call.endedAt - startedAt;
    call.mocked = true;
    call.ok = true;
    rememberHostApiCall(call);
    return fixture.result as HostApiResult<M, A>;
  }

  const bridge = window.verseClaw?.hostInvoke;
  if (!bridge) {
    call.endedAt = Date.now();
    call.durationMs = call.endedAt - startedAt;
    call.ok = false;
    call.error = 'Host invoke bridge is unavailable';
    rememberHostApiCall(call);
    throw new AppError(
      'CHANNEL_UNAVAILABLE',
      'Host invoke bridge is unavailable',
      undefined,
      { module, action, requestId: request.id },
      request.id,
    );
  }

  // R0-4: last-line renderer fallback. The Main dispatcher enforces the
  // same budget (shared table) and normally answers first with a TIMEOUT
  // code; this race only fires when Main itself hangs and never responds.
  const timeoutMs = hostActionTimeoutMs(module, action) + RENDERER_TIMEOUT_MARGIN_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let response: HostResponse<HostApiResult<M, A>>;
  try {
    response = await Promise.race([
      bridge<HostApiResult<M, A>>(request),
      new Promise<HostApiResult<M, A>>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AppError(
            'TIMEOUT',
            `Host request timed out: ${module}.${action}`,
            undefined,
            { module, action, requestId: request.id },
            request.id,
          ));
        }, timeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  } catch (error) {
    call.endedAt = Date.now();
    call.durationMs = call.endedAt - startedAt;
    const normalized = error instanceof AppError ? error : normalizeAppError(error);
    const appError = new AppError(
      normalized.code,
      normalized.message || `Host request failed: ${module}.${action}`,
      error,
      { ...(normalized.details ?? {}), module, action, requestId: request.id },
      request.id,
    );
    call.ok = false;
    call.error = appError.message;
    rememberHostApiCall(call);
    throw appError;
  }
  call.endedAt = Date.now();
  call.durationMs = call.endedAt - startedAt;

  if (!response.ok) {
    const responseDetails = asRecord(response.error?.details);
    const backendCode = typeof responseDetails.backendCode === 'string'
      ? responseDetails.backendCode
      : response.error?.code;
    const requestId = readRequestId(response.id, request.id);
    const message = response.error?.message || `Host request failed: ${module}.${action}`;
    const mappedCode = mapBackendErrorCode(backendCode);
    const classifiedCode = mappedCode === 'UNKNOWN'
      ? normalizeAppError({
        code: backendCode,
        status: typeof responseDetails.status === 'number' ? responseDetails.status : undefined,
      }).code
      : mappedCode;
    const appError = new AppError(
      classifiedCode,
      message,
      response.error,
      { ...responseDetails, module, action, requestId },
      requestId,
    );
    call.ok = false;
    call.error = message;
    rememberHostApiCall(call);
    throw appError;
  }

  call.ok = true;
  rememberHostApiCall(call);
  recordFixture(replayConfig, request, response.data);
  return response.data;
}
