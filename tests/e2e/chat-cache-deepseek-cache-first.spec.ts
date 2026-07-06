import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type {
  HostSuccess,
  PromptCacheStatusResult,
  ProviderAccount,
  WorkspaceActiveResult,
  WorkspaceLiveUsageResult,
} from '../../shared/host-api/contract';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostInvokeResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

type AgentRunResult = {
  runId?: string;
  status?: string;
};

type AgentWaitResult = {
  runId?: string;
  status?: string;
  error?: string;
  stopReason?: string;
};

type GatewayStatus = {
  state?: string;
  port?: number;
  gatewayReady?: boolean;
};

type ProviderConfigFile = {
  apiKeys?: Record<string, unknown>;
  providerSecrets?: Record<string, unknown>;
};

type CacheTraceEvent = {
  stage?: string;
  providerSystemDigest?: string;
  providerMessagesDigest?: string;
  providerToolsDigest?: string;
  providerPrefixShapeDigest?: string;
  providerParamsDigest?: string;
  providerToolCount?: number;
  providerToolNames?: string[];
  providerPayloadSource?: string;
};

type DeepSeekCacheEvidence = {
  version: 1;
  generatedAt: string;
  sessionKey: string;
  modelRef: string;
  turnsCompleted: number;
  threshold: {
    hardPassWarmHitRate: 0.95;
    targetWarmHitRate: 0.98;
  };
  perTurn: Array<{
    turn: number;
    totalTokens: number;
    cacheReadTokens: number;
    inputTokens: number;
    lastTurnHitRate?: number | null;
    warmTurnHitRate?: number | null;
  }>;
  promptCache: PromptCacheStatusResult['assessment'];
  finalUsage: WorkspaceLiveUsageResult['usage'];
  trace: {
    providerPayloadEvents: number;
    first?: CacheTraceEvent;
    last?: CacheTraceEvent;
    systemStable?: boolean;
    toolsStable?: boolean;
    prefixStable?: boolean;
    messagesStable?: boolean;
  };
  result: {
    passed: boolean;
    warmTurnHitRate: number | null;
    targetMet: boolean;
  };
  artifactSafety: {
    apiKeyCaptured: false;
    apiKeySource: string;
  };
};

const LIVE_ENABLED = process.env.CLAWX_LIVE_MODEL_E2E === '1';
const SESSION_KEY = 'agent:main:main';
const MODEL_REF = 'deepseek/deepseek-v4-flash';
const MODEL_ID = 'deepseek-v4-flash';
const ARTIFACT_DIR = resolve(process.cwd(), 'artifacts', 'prompt-cache-live-e2e');
const TRACE_FILE = join(ARTIFACT_DIR, 'deepseek-cache-first-trace.jsonl');
const HARD_PASS_WARM_HIT_RATE = 0.95;
const TARGET_WARM_HIT_RATE = 0.98;
const STABLE_PREFIX = Array.from({ length: 360 }, (_, index) => {
  const n = String(index + 1).padStart(3, '0');
  return [
    `CACHE-STABLE-LINE-${n}`,
    'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima',
    'mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu',
    `checksum-${n}-deepseek-cache-first`,
  ].join(' | ');
}).join('\n');
const STABLE_PROMPT_PREFIX = [
  'DeepSeek cache-first stable prefix begins.',
  STABLE_PREFIX,
  'DeepSeek cache-first stable prefix ends.',
].join('\n');

function extractSecret(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['apiKey', 'key', 'value', 'secret']) {
    const secret = extractSecret(record[key]);
    if (secret) return secret;
  }
  return undefined;
}

async function resolveDeepSeekApiKey(): Promise<{ apiKey: string; source: string }> {
  if (process.env.CLAWX_LIVE_API_KEY?.trim()) {
    return { apiKey: process.env.CLAWX_LIVE_API_KEY.trim(), source: 'CLAWX_LIVE_API_KEY' };
  }
  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    return { apiKey: process.env.DEEPSEEK_API_KEY.trim(), source: 'DEEPSEEK_API_KEY' };
  }

  const appData = process.env.APPDATA;
  if (appData) {
    try {
      const config = JSON.parse(
        await readFile(join(appData, 'clawx', 'clawx-providers.json'), 'utf-8'),
      ) as ProviderConfigFile;
      for (const [key, value] of Object.entries({
        ...(config.providerSecrets ?? {}),
        ...(config.apiKeys ?? {}),
      })) {
        if (!key.toLowerCase().includes('deepseek')) continue;
        const apiKey = extractSecret(value);
        if (apiKey) {
          return { apiKey, source: 'local-clawx-providers' };
        }
      }
    } catch {
      // Fall through to the explicit error below.
    }
  }

  throw new Error('Missing DeepSeek API key for live cache-first E2E');
}

async function hostInvoke<T>(
  page: Page,
  module: string,
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await page.evaluate(async (request) => {
    const bridge = (window as unknown as {
      verseClaw?: {
        hostInvoke: <R>(input: Record<string, unknown>) => Promise<HostInvokeResponse<R>>;
      };
    }).verseClaw?.hostInvoke;
    if (!bridge) throw new Error('hostInvoke bridge unavailable');
    const response = await bridge<T>({
      id: crypto.randomUUID(),
      module: request.module,
      action: request.action,
      ...(request.payload ? { payload: request.payload } : {}),
    });
    if (!response.ok) throw new Error(response.error?.message || 'hostInvoke failed');
    return response.data as T;
  }, { module, action, payload });
}

async function configureDeepSeekProvider(page: Page, apiKey: string): Promise<void> {
  const now = new Date().toISOString();
  const account: ProviderAccount = {
    id: 'live-e2e-deepseek-cache-first',
    vendorId: 'deepseek',
    label: 'Live E2E DeepSeek Cache First',
    authMode: 'api_key',
    model: MODEL_ID,
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };

  expect((await hostInvoke<HostSuccess>(page, 'providers', 'createAccount', {
    account,
    apiKey,
  })).success).toBe(true);
  expect((await hostInvoke<HostSuccess>(page, 'providers', 'setDefaultAccount', {
    accountId: account.id,
  })).success).toBe(true);
  expect((await hostInvoke<HostSuccess>(page, 'agents', 'updateModel', {
    id: 'main',
    modelRef: MODEL_REF,
  })).success).toBe(true);
}

async function allocateGatewayPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate gateway port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function configureIsolatedGatewayPort(page: Page, port: number): Promise<void> {
  expect((await hostInvoke<HostSuccess>(page, 'settings', 'set', {
    key: 'gatewayPort',
    value: port,
  })).success).toBe(true);
}

async function ensureFullAccessWorkspaceForLiveRun(page: Page): Promise<void> {
  const active = await hostInvoke<WorkspaceActiveResult>(page, 'workspaces', 'getActive');
  const workspaceId = active.activeWorkspace?.id;
  expect(workspaceId, JSON.stringify(active)).toBeTruthy();
  if (active.activeWorkspace?.permissionMode === 'fullAccess') return;

  expect((await hostInvoke<HostSuccess>(page, 'workspaces', 'update', {
    id: workspaceId,
    permissionMode: 'fullAccess',
  })).success).toBe(true);
}

async function ensureGatewayReady(page: Page, expectedPort?: number): Promise<void> {
  const status = await hostInvoke<GatewayStatus>(page, 'gateway', 'status');
  if (status.state !== 'running' && status.state !== 'starting') {
    await hostInvoke<HostSuccess>(page, 'gateway', 'start').catch(() => ({ success: false }));
  }
  await expect.poll(async () => {
    const next = await hostInvoke<GatewayStatus>(page, 'gateway', 'status');
    return (next.gatewayReady === true || next.state === 'running')
      && (expectedPort === undefined || next.port === expectedPort);
  }, {
    intervals: [2_000, 5_000, 10_000],
    timeout: 120_000,
  }).toBe(true);
}

async function restartGatewayForLiveRun(page: Page, expectedPort?: number): Promise<void> {
  const restart = await hostInvoke<HostSuccess>(page, 'gateway', 'restart').catch(
    () => ({ success: false }),
  );
  if (!restart.success) {
    expect((await hostInvoke<HostSuccess>(page, 'gateway', 'start')).success).toBe(true);
  }
  await ensureGatewayReady(page, expectedPort);
}

function buildPrompt(turn: number): string {
  return [
    STABLE_PROMPT_PREFIX,
    `DeepSeek cache-first probe turn ${turn}.`,
    `Reply with exactly: deepseek-cache-ok-${turn}`,
    'Do not add any explanation or formatting.',
  ].join('\n');
}

async function clearSessionHistory(page: Page): Promise<void> {
  await hostInvoke<unknown>(page, 'gateway', 'rpc', {
    method: 'agent.reset',
    params: { sessionKey: SESSION_KEY },
    timeoutMs: 60_000,
  }).catch(() => undefined);
}

async function readLiveUsage(page: Page): Promise<WorkspaceLiveUsageResult['usage']> {
  const result = await hostInvoke<WorkspaceLiveUsageResult>(page, 'usage', 'live', {
    sessionKey: SESSION_KEY,
  });
  expect(result.success).toBe(true);
  return result.usage;
}

async function runRawPromptAndWait(page: Page, turn: number): Promise<string> {
  const run = await hostInvoke<AgentRunResult>(page, 'gateway', 'rpc', {
    method: 'agent',
    params: {
      message: buildPrompt(turn),
      agentId: 'main',
      sessionKey: SESSION_KEY,
      provider: 'deepseek',
      model: MODEL_ID,
      deliver: false,
      modelRun: true,
      promptMode: 'none',
      timeout: 240_000,
      idempotencyKey: `deepseek-cache-first-${Date.now()}-${turn}`,
    },
    timeoutMs: 30_000,
  });
  const runId = run.runId;
  expect(runId, JSON.stringify(run)).toBeTruthy();

  const wait = await hostInvoke<AgentWaitResult>(page, 'gateway', 'rpc', {
    method: 'agent.wait',
    params: { runId, timeoutMs: 240_000 },
    timeoutMs: 250_000,
  });
  expect(wait.status, JSON.stringify(wait)).toBe('ok');
  return runId!;
}

async function waitForUsageIncrease(
  page: Page,
  previousTotalTokens: number,
): Promise<WorkspaceLiveUsageResult['usage']> {
  await expect.poll(async () => {
    const usage = await readLiveUsage(page);
    return usage.status === 'final' ? usage.totalTokens : 0;
  }, {
    intervals: [1_000, 2_000, 5_000],
    timeout: 120_000,
  }).toBeGreaterThan(previousTotalTokens);
  return await readLiveUsage(page);
}

async function readPromptCacheStatus(page: Page): Promise<PromptCacheStatusResult['assessment']> {
  const result = await hostInvoke<PromptCacheStatusResult>(page, 'usage', 'promptCacheStatus', {
    sessionKey: SESSION_KEY,
    modelRef: MODEL_REF,
  });
  expect(result.success).toBe(true);
  return result.assessment;
}

async function readProviderPayloadTrace(): Promise<CacheTraceEvent[]> {
  try {
    const content = await readFile(TRACE_FILE, 'utf-8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CacheTraceEvent)
      .filter((event) => event.stage === 'provider:payload');
  } catch {
    return [];
  }
}

async function writeEvidence(evidence: DeepSeekCacheEvidence): Promise<string> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const latestPath = join(ARTIFACT_DIR, 'deepseek-cache-first-latest.json');
  const datedPath = join(
    ARTIFACT_DIR,
    `deepseek-cache-first-${evidence.generatedAt.replace(/[:.]/g, '-')}.json`,
  );
  const content = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(latestPath, content, 'utf-8');
  await writeFile(datedPath, content, 'utf-8');
  return latestPath;
}

test.describe('DeepSeek prompt cache-first live E2E', () => {
  test.skip(!LIVE_ENABLED, 'Set CLAWX_LIVE_MODEL_E2E=1 to run real DeepSeek cache calls');

  test('keeps a stable provider prefix warm across real DeepSeek turns', async ({ launchElectronApp }, testInfo) => {
    test.setTimeout(480_000);
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await rm(TRACE_FILE, { force: true });
    const previousTrace = process.env.OPENCLAW_CACHE_TRACE;
    const previousTraceFile = process.env.OPENCLAW_CACHE_TRACE_FILE;
    const previousTraceMessages = process.env.OPENCLAW_CACHE_TRACE_MESSAGES;
    process.env.OPENCLAW_CACHE_TRACE = '1';
    process.env.OPENCLAW_CACHE_TRACE_FILE = TRACE_FILE;
    process.env.OPENCLAW_CACHE_TRACE_MESSAGES = '0';

    const { apiKey, source } = await resolveDeepSeekApiKey();
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      await ensureFullAccessWorkspaceForLiveRun(page);
      await configureDeepSeekProvider(page, apiKey);
      const gatewayPort = await allocateGatewayPort();
      await configureIsolatedGatewayPort(page, gatewayPort);
      await restartGatewayForLiveRun(page, gatewayPort);
      await clearSessionHistory(page);

      let usage = await readLiveUsage(page);
      let previousTotalTokens = usage.totalTokens;
      const perTurn: DeepSeekCacheEvidence['perTurn'] = [];
      for (let turn = 1; turn <= 2; turn += 1) {
        await runRawPromptAndWait(page, turn);
        usage = await waitForUsageIncrease(page, previousTotalTokens);
        previousTotalTokens = usage.totalTokens;
        perTurn.push({
          turn,
          totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cacheReadTokens,
          inputTokens: usage.inputTokens,
          lastTurnHitRate: usage.lastTurnHitRate,
          warmTurnHitRate: usage.warmTurnHitRate,
        });
      }

      const promptCache = await readPromptCacheStatus(page);
      const warmTurnHitRate = promptCache.warmTurnHitRate ?? usage.warmTurnHitRate ?? null;
      const traceEvents = await readProviderPayloadTrace();
      const transportTraceEvents = traceEvents.filter((event) =>
        event.providerPayloadSource?.includes('transport'),
      );
      const comparableTraceEvents =
        transportTraceEvents.length >= 2 ? transportTraceEvents : traceEvents;
      const firstTrace = comparableTraceEvents.at(0);
      const lastTrace = comparableTraceEvents.at(-1);
      const evidence: DeepSeekCacheEvidence = {
        version: 1,
        generatedAt: new Date().toISOString(),
        sessionKey: SESSION_KEY,
        modelRef: MODEL_REF,
        turnsCompleted: perTurn.length,
        threshold: {
          hardPassWarmHitRate: HARD_PASS_WARM_HIT_RATE,
          targetWarmHitRate: TARGET_WARM_HIT_RATE,
        },
        perTurn,
        promptCache,
        finalUsage: usage,
        trace: {
          providerPayloadEvents: traceEvents.length,
          ...(firstTrace ? { first: firstTrace } : {}),
          ...(lastTrace ? { last: lastTrace } : {}),
          ...(firstTrace && lastTrace ? {
            systemStable: firstTrace.providerSystemDigest === lastTrace.providerSystemDigest,
            toolsStable: firstTrace.providerToolsDigest === lastTrace.providerToolsDigest,
            prefixStable: firstTrace.providerPrefixShapeDigest === lastTrace.providerPrefixShapeDigest,
            messagesStable: firstTrace.providerMessagesDigest === lastTrace.providerMessagesDigest,
          } : {}),
        },
        result: {
          passed: warmTurnHitRate != null && warmTurnHitRate >= HARD_PASS_WARM_HIT_RATE,
          warmTurnHitRate,
          targetMet: warmTurnHitRate != null && warmTurnHitRate >= TARGET_WARM_HIT_RATE,
        },
        artifactSafety: {
          apiKeyCaptured: false,
          apiKeySource: source,
        },
      };
      const artifactPath = await writeEvidence(evidence);
      await testInfo.attach('deepseek-cache-first', {
        path: artifactPath,
        contentType: 'application/json',
      });

      expect(warmTurnHitRate, JSON.stringify(evidence.result)).not.toBeNull();
      expect(warmTurnHitRate ?? 0).toBeGreaterThanOrEqual(HARD_PASS_WARM_HIT_RATE);
      expect(evidence.trace.providerPayloadEvents).toBeGreaterThanOrEqual(2);
      expect(evidence.trace.systemStable).toBe(true);
      expect(evidence.trace.toolsStable).toBe(true);
      expect(evidence.trace.prefixStable).toBe(true);
    } finally {
      await closeElectronApp(app);
      if (previousTrace === undefined) delete process.env.OPENCLAW_CACHE_TRACE;
      else process.env.OPENCLAW_CACHE_TRACE = previousTrace;
      if (previousTraceFile === undefined) delete process.env.OPENCLAW_CACHE_TRACE_FILE;
      else process.env.OPENCLAW_CACHE_TRACE_FILE = previousTraceFile;
      if (previousTraceMessages === undefined) delete process.env.OPENCLAW_CACHE_TRACE_MESSAGES;
      else process.env.OPENCLAW_CACHE_TRACE_MESSAGES = previousTraceMessages;
    }
  });
});
