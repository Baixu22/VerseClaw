import type {
  HostApiAction,
  HostApiModule,
  HostApiPayloadArgs,
  HostApiResult,
} from '@shared/host-api/contract';
import type { TypedHostRequest } from '@shared/host-api/types';

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
    throw new Error('Host invoke bridge is unavailable');
  }

  const response = await bridge<HostApiResult<M, A>>(request);
  call.endedAt = Date.now();
  call.durationMs = call.endedAt - startedAt;

  if (!response.ok) {
    call.ok = false;
    call.error = response.error?.message || `Host request failed: ${module}.${action}`;
    rememberHostApiCall(call);
    throw new Error(response.error?.message || `Host request failed: ${module}.${action}`);
  }

  call.ok = true;
  rememberHostApiCall(call);
  recordFixture(replayConfig, request, response.data);
  return response.data;
}
