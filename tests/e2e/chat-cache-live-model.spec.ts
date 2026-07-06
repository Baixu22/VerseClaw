import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type {
  HostSuccess,
  ProviderAccount,
  PromptCacheStatusResult,
  WorkspaceLiveUsageResult,
} from '../../shared/host-api/contract';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostInvokeResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

type ChatHistoryMessage = {
  role?: string;
  content?: unknown;
  timestamp?: number;
};

type ChatHistoryResult = {
  messages?: ChatHistoryMessage[];
};

type LiveModelConfig = {
  accountId: string;
  apiKey?: string;
  apiKeySource: string;
  apiProtocol?: ProviderAccount['apiProtocol'];
  baseUrl?: string;
  modelId: string;
  provider: ProviderAccount['vendorId'];
  requestedModelRef: string;
  runtimeModelRef: string;
  turns: number;
};

type LiveEvidence = {
  version: 1;
  generatedAt: string;
  sessionKey: string;
  provider: string;
  requestedModelRef: string;
  runtimeModelRef: string;
  modelId: string;
  turnsRequested: number;
  turnsCompleted: number;
  apiProtocol?: string;
  baseUrlConfigured: boolean;
  usage: WorkspaceLiveUsageResult['usage'];
  promptCache: PromptCacheStatusResult['assessment'];
  metrics: {
    cacheHitRate: number | null;
    lastTurnHitRate?: number | null;
    warmTurnHitRate?: number | null;
    lastTurnCacheReadTokens?: number;
    lastTurnCacheMissTokens?: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    inputTokens: number;
    totalTokens: number;
    estimatedSavedUsd?: number;
    estimatedExtraCostUsd?: number;
    cacheBreakWarnings: number;
    cancelledBreaks: number;
    confidence: string;
    status: string;
    providerStrategy: string;
  };
  artifactSafety: {
    apiKeyCaptured: false;
    apiKeySource: string;
  };
};

const LIVE_ENABLED = process.env.CLAWX_LIVE_MODEL_E2E === '1';
const SESSION_KEY = 'agent:main:main';
const ARTIFACT_DIR = resolve(process.cwd(), 'artifacts', 'prompt-cache-live-e2e');
const PROVIDER_KEY_ENVS: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  ark: ['ARK_API_KEY'],
  moonshot: ['MOONSHOT_API_KEY'],
  'moonshot-global': ['MOONSHOT_GLOBAL_API_KEY'],
  siliconflow: ['SILICONFLOW_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  'minimax-portal': ['MINIMAX_API_KEY'],
  'minimax-portal-cn': ['MINIMAX_CN_API_KEY'],
  modelstudio: ['MODELSTUDIO_API_KEY'],
  custom: ['CUSTOM_API_KEY'],
};
const UNREGISTERED_PROVIDER_TYPES = new Set(['custom', 'ollama']);

function sanitizeId(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'provider';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

function parseModelRef(modelRef: string): { providerKey: string; modelId: string } {
  const separator = modelRef.indexOf('/');
  if (separator <= 0 || separator >= modelRef.length - 1) {
    throw new Error('CLAWX_LIVE_MODEL_REF must use provider/model format');
  }
  return {
    providerKey: modelRef.slice(0, separator),
    modelId: modelRef.slice(separator + 1),
  };
}

function runtimeProviderKey(provider: string, accountId: string): string {
  if (provider === 'minimax-portal-cn') return 'minimax-portal';
  if (!UNREGISTERED_PROVIDER_TYPES.has(provider)) return provider;
  const prefix = `${provider}-`;
  if (accountId.startsWith(prefix)) {
    const tail = accountId.slice(prefix.length);
    if (tail.length === 8 && !tail.includes('-')) {
      return accountId;
    }
  }
  const suffix = accountId.replace(/-/g, '').slice(0, 8);
  return `${provider}-${suffix}`;
}

function resolveApiKey(provider: string): { apiKey: string; source: string } {
  if (provider === 'ollama') {
    return { apiKey: '', source: 'not-required' };
  }

  if (process.env.CLAWX_LIVE_API_KEY?.trim()) {
    return { apiKey: process.env.CLAWX_LIVE_API_KEY.trim(), source: 'CLAWX_LIVE_API_KEY' };
  }

  const dynamicEnv = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  const candidates = [dynamicEnv, ...(PROVIDER_KEY_ENVS[provider] ?? [])];
  for (const envName of candidates) {
    const value = process.env[envName]?.trim();
    if (value) return { apiKey: value, source: envName };
  }

  throw new Error(
    `Missing live model API key. Set CLAWX_LIVE_API_KEY or one of: ${candidates.join(', ')}`,
  );
}

function readLiveConfig(): LiveModelConfig {
  const requestedModelRef = process.env.CLAWX_LIVE_MODEL_REF?.trim();
  if (!requestedModelRef) {
    throw new Error('Set CLAWX_LIVE_MODEL_REF=provider/model before running live model E2E');
  }

  const parsed = parseModelRef(requestedModelRef);
  const provider = (
    process.env.CLAWX_LIVE_PROVIDER?.trim()
    || parsed.providerKey
  ) as ProviderAccount['vendorId'];
  const modelId = process.env.CLAWX_LIVE_MODEL_ID?.trim() || parsed.modelId;
  const accountId = `live-e2e-${sanitizeId(provider)}`;
  const runtimeKey = runtimeProviderKey(provider, accountId);
  const runtimeModelRef = requestedModelRef.startsWith(`${runtimeKey}/`)
    ? requestedModelRef
    : `${runtimeKey}/${modelId}`;
  const baseUrl = process.env.CLAWX_LIVE_BASE_URL?.trim() || undefined;
  const apiProtocol = process.env.CLAWX_LIVE_API_PROTOCOL?.trim() as ProviderAccount['apiProtocol'] | undefined;

  if (UNREGISTERED_PROVIDER_TYPES.has(provider) && !baseUrl) {
    throw new Error('CLAWX_LIVE_BASE_URL is required when CLAWX_LIVE_PROVIDER is custom or ollama');
  }

  const { apiKey, source } = resolveApiKey(provider);
  return {
    accountId,
    apiKey,
    apiKeySource: source,
    apiProtocol,
    baseUrl,
    modelId,
    provider,
    requestedModelRef,
    runtimeModelRef,
    turns: parsePositiveInt(process.env.CLAWX_LIVE_TURNS, 2),
  };
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

async function configureLiveProvider(page: Page, config: LiveModelConfig): Promise<void> {
  const now = new Date().toISOString();
  const account: ProviderAccount = {
    id: config.accountId,
    vendorId: config.provider,
    label: `Live E2E ${config.provider}`,
    authMode: config.provider === 'ollama' ? 'local' : 'api_key',
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.apiProtocol ? { apiProtocol: config.apiProtocol } : {}),
    model: config.modelId,
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };

  const created = await hostInvoke<HostSuccess>(page, 'providers', 'createAccount', {
    account,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  });
  expect(created.success).toBe(true);

  const defaulted = await hostInvoke<HostSuccess>(page, 'providers', 'setDefaultAccount', {
    accountId: config.accountId,
  });
  expect(defaulted.success).toBe(true);

  const updated = await hostInvoke<HostSuccess>(page, 'agents', 'updateModel', {
    id: 'main',
    modelRef: config.runtimeModelRef,
  });
  expect(updated.success).toBe(true);
}

async function ensureGatewayReady(page: Page): Promise<void> {
  const status = await hostInvoke<Record<string, unknown>>(page, 'gateway', 'status');
  if (status.state !== 'running' && status.state !== 'starting') {
    try {
      await hostInvoke<HostSuccess>(page, 'gateway', 'start');
    } catch {
      // Provider writes may have scheduled a refresh while the explicit start
      // request was in flight. Poll the canonical status below before failing.
    }
  }

  let lastStatus: Record<string, unknown> | null = status;
  let lastHealth: Record<string, unknown> | null = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<Record<string, unknown>>(page, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') {
        return;
      }
      try {
        lastHealth = await hostInvoke<Record<string, unknown>>(page, 'gateway', 'health', {
          probe: true,
        });
      } catch {
        // Status is the primary signal; health is only best-effort context.
      }
    } catch {
      // Keep the last successful status for the timeout diagnostic.
    }
    await page.waitForTimeout(2_000);
  }

  throw new Error(`Gateway did not become ready: ${JSON.stringify({
    status: lastStatus,
    health: lastHealth,
  })}`);
}

function buildLivePrompt(turn: number): string {
  return [
    `Cache live E2E probe turn ${turn}.`,
    `Reply with exactly: cache-live-ok-${turn}`,
    'Do not add any explanation or formatting.',
  ].join('\n');
}

async function readHistory(page: Page): Promise<ChatHistoryResult> {
  return await hostInvoke<ChatHistoryResult>(page, 'gateway', 'rpc', {
    method: 'chat.history',
    params: {
      sessionKey: SESSION_KEY,
      limit: 50,
      maxChars: 500_000,
    },
    timeoutMs: 30_000,
  });
}

async function assistantMessageCount(page: Page): Promise<number> {
  try {
    const history = await readHistory(page);
    return (history.messages ?? []).filter((message) => message.role === 'assistant').length;
  } catch {
    return -1;
  }
}

async function readLiveUsage(page: Page): Promise<WorkspaceLiveUsageResult['usage']> {
  const result = await hostInvoke<WorkspaceLiveUsageResult>(page, 'usage', 'live', {
    sessionKey: SESSION_KEY,
  });
  expect(result.success).toBe(true);
  return result.usage;
}

async function sendPromptAndWait(page: Page, turn: number): Promise<void> {
  const previousAssistantCount = await assistantMessageCount(page);
  const input = page.getByTestId('chat-composer-input');
  const send = page.getByTestId('chat-composer-send');

  await expect(input).toBeEnabled({ timeout: 90_000 });
  await input.fill(buildLivePrompt(turn));
  await expect(send).toBeEnabled();
  await send.click();

  await expect.poll(async () => assistantMessageCount(page), {
    intervals: [2_000, 5_000, 10_000],
    timeout: 180_000,
  }).toBeGreaterThan(previousAssistantCount);

  await expect.poll(async () => {
    const title = await send.getAttribute('title').catch(() => null);
    return title;
  }, {
    intervals: [1_000, 2_000, 5_000],
    timeout: 120_000,
  }).toBe('Send');
}

async function waitForUsageIncrease(
  page: Page,
  previousTotalTokens: number,
): Promise<WorkspaceLiveUsageResult['usage']> {
  await expect.poll(async () => {
    const usage = await readLiveUsage(page);
    return usage.totalTokens;
  }, {
    intervals: [1_000, 2_000, 5_000],
    timeout: 120_000,
  }).toBeGreaterThan(previousTotalTokens);

  return await readLiveUsage(page);
}

async function readPromptCacheStatus(
  page: Page,
  modelRef: string,
): Promise<PromptCacheStatusResult['assessment']> {
  const result = await hostInvoke<PromptCacheStatusResult>(page, 'usage', 'promptCacheStatus', {
    sessionKey: SESSION_KEY,
    modelRef,
  });
  expect(result.success).toBe(true);
  return result.assessment;
}

async function writeEvidence(evidence: LiveEvidence): Promise<string> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const latestPath = join(ARTIFACT_DIR, 'latest.json');
  const datedPath = join(
    ARTIFACT_DIR,
    `prompt-cache-live-${evidence.generatedAt.replace(/[:.]/g, '-')}.json`,
  );
  const content = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(latestPath, content, 'utf-8');
  await writeFile(datedPath, content, 'utf-8');
  return latestPath;
}

test.describe('Verse Claw prompt cache live model E2E', () => {
  test.skip(
    !LIVE_ENABLED,
    'Set CLAWX_LIVE_MODEL_E2E=1, CLAWX_LIVE_MODEL_REF, and a provider API key to run real model calls',
  );

  test('performs real model calls and exports prompt-cache metrics', async ({ launchElectronApp }, testInfo) => {
    test.setTimeout(420_000);

    const config = readLiveConfig();
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

      await configureLiveProvider(page, config);
      await ensureGatewayReady(page);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 90_000 });

      let usage = await readLiveUsage(page);
      let previousTotalTokens = usage.totalTokens;
      let completedTurns = 0;

      for (let turn = 1; turn <= config.turns; turn += 1) {
        await sendPromptAndWait(page, turn);
        usage = await waitForUsageIncrease(page, previousTotalTokens);
        previousTotalTokens = usage.totalTokens;
        completedTurns = turn;
      }

      const promptCache = await readPromptCacheStatus(page, config.runtimeModelRef);
      expect(usage.totalTokens).toBeGreaterThan(0);
      expect(promptCache.sessionKey).toBe(SESSION_KEY);
      expect(promptCache.hitRate === null || (promptCache.hitRate >= 0 && promptCache.hitRate <= 1)).toBe(true);

      const evidence: LiveEvidence = {
        version: 1,
        generatedAt: new Date().toISOString(),
        sessionKey: SESSION_KEY,
        provider: config.provider,
        requestedModelRef: config.requestedModelRef,
        runtimeModelRef: config.runtimeModelRef,
        modelId: config.modelId,
        turnsRequested: config.turns,
        turnsCompleted: completedTurns,
        ...(config.apiProtocol ? { apiProtocol: config.apiProtocol } : {}),
        baseUrlConfigured: Boolean(config.baseUrl),
        usage,
        promptCache,
        metrics: {
          cacheHitRate: promptCache.hitRate,
          lastTurnHitRate: promptCache.lastTurnHitRate,
          warmTurnHitRate: promptCache.warmTurnHitRate,
          lastTurnCacheReadTokens: promptCache.lastTurnCacheReadTokens,
          lastTurnCacheMissTokens: promptCache.lastTurnCacheMissTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          inputTokens: usage.inputTokens,
          totalTokens: usage.totalTokens,
          ...(promptCache.estimatedSavedUsd != null ? { estimatedSavedUsd: promptCache.estimatedSavedUsd } : {}),
          ...(promptCache.estimatedExtraCostUsd != null ? { estimatedExtraCostUsd: promptCache.estimatedExtraCostUsd } : {}),
          cacheBreakWarnings: promptCache.warningCount,
          cancelledBreaks: promptCache.cancelledBreakCount,
          confidence: promptCache.confidence,
          status: promptCache.status,
          providerStrategy: promptCache.providerStrategy,
        },
        artifactSafety: {
          apiKeyCaptured: false,
          apiKeySource: config.apiKeySource,
        },
      };

      const artifactPath = await writeEvidence(evidence);
      await testInfo.attach('prompt-cache-live-e2e', {
        path: artifactPath,
        contentType: 'application/json',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
