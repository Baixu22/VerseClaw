import { app } from 'electron';
import type {
  AgentDevCreateConversationPayload,
  AgentDevCreateProviderConfigPayload,
  AgentDevFeatureFlagsPayload,
  AgentDevHostApiCall,
  AgentDevMockReplayConfig,
  AgentDevMockReplayMode,
  AgentDevScenario,
  AgentDevScenarioId,
  AgentDevSeedConversation,
  AgentDevSeedProviderConfig,
  AgentDevSeedState,
  AgentDevTransportTraceEvent,
  AgentDevTransportTracePayload,
  AgentDevVisualPreset,
  JsonRecord,
  SettingsSnapshot,
} from '@shared/host-api/contract';
import {
  assertAgentDevFeatureFlagsPayload,
  assertAgentDevMockReplayConfig,
  assertAgentDevSeedStatePayload,
} from '@shared/host-api/agent-dev-schemas';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { getAllSettings, setSetting } from '../utils/store';
import { logger } from '../utils/logger';
import { buildSandboxStatus } from './sandbox-api';

type AgentDevApiContext = {
  gatewayManager: GatewayManager;
};

const MAX_CALLS = 500;
const MAX_TRANSPORT_EVENTS = 500;

const SCENARIOS: AgentDevScenario[] = [
  {
    id: 'chat-empty',
    route: '/',
    description: 'Empty chat session with setup skipped and no provider key.',
    seed: { conversations: [], providers: [] },
  },
  {
    id: 'chat-streaming',
    route: '/',
    description: 'Chat page with a synthetic in-progress assistant turn.',
    seed: { gatewayStatus: { state: 'running', gatewayReady: true } },
  },
  {
    id: 'models-heavy-usage',
    route: '/settings/models',
    description: 'Models page with dense token usage buckets for chart validation.',
    seed: { usageWindowDays: 30, modelCount: 12 },
  },
  {
    id: 'settings-provider-error',
    route: '/settings/models',
    description: 'Provider settings page with a validation error state.',
    seed: { providerError: 'invalid_api_key' },
  },
  {
    id: 'doctor-failed',
    route: '/settings/advanced',
    description: 'Advanced settings with a failed OpenClaw Doctor payload.',
    seed: { doctorExitCode: 1 },
  },
  {
    id: 'gateway-connecting',
    route: '/',
    description: 'Gateway connecting banner and retry affordances.',
    seed: { gatewayStatus: { state: 'starting', gatewayReady: false } },
  },
  {
    id: 'knowledge-drafts',
    route: '/knowledge',
    description: 'Knowledge hub with draft/proposal queues populated.',
    seed: { draftCount: 3, proposalCount: 2 },
  },
  {
    id: 'observability-trace-errors',
    route: '/observability',
    description: 'Observability page with errored traces and node diagnostics.',
    seed: { traceStatus: 'failed', diagnosticCount: 4 },
  },
];

const scenarioIds = new Set<string>(SCENARIOS.map((scenario) => scenario.id));

let seedState: AgentDevSeedState = createEmptySeedState();
let mockReplayMode: AgentDevMockReplayMode = 'off';
let mockReplayFixtures: AgentDevMockReplayConfig['fixtures'] = [];
const hostApiCalls: AgentDevHostApiCall[] = [];
const transportTraceEvents: AgentDevTransportTraceEvent[] = [];

function createEmptySeedState(): AgentDevSeedState {
  return {
    conversations: [],
    providers: [],
    featureFlags: readFlagEnv(),
    metadata: {},
    updatedAt: new Date().toISOString(),
  };
}

function isEnabled(): boolean {
  return process.env.VERSE_CLAW_E2E === '1'
    || process.env.CLAWX_AGENT_DEV === '1'
    || process.env.VERSE_CLAW_AGENT_DEV === '1'
    || process.env.NODE_ENV === 'development'
    || Boolean(process.env.VITE_DEV_SERVER_URL);
}

function requireEnabled(): void {
  if (!isEnabled()) {
    throw new Error('agentDev mutating APIs are available only in dev, E2E, or CLAWX_AGENT_DEV=1 mode');
  }
}

function readFlagEnv(): string[] {
  const raw = process.env.CLAWX_FLAGS || process.env.VERSE_CLAW_FLAGS || '';
  return raw
    .split(',')
    .map((flag) => flag.trim())
    .filter(Boolean);
}

function normalizeScenario(value: unknown): AgentDevScenarioId | undefined {
  return typeof value === 'string' && scenarioIds.has(value)
    ? value as AgentDevScenarioId
    : undefined;
}

function uniqueFlags(flags: string[]): string[] {
  return [...new Set(flags.map((flag) => flag.trim()).filter(Boolean))].sort();
}

function touchState(next: Partial<AgentDevSeedState>): AgentDevSeedState {
  seedState = {
    ...seedState,
    ...next,
    updatedAt: new Date().toISOString(),
  };
  return seedState;
}

async function applySettingsPatch(settings?: SettingsSnapshot): Promise<string[]> {
  if (!settings || typeof settings !== 'object') return [];
  const applied: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    await setSetting(key as never, value as never);
    applied.push(`settings.${key}`);
  }
  return applied;
}

function normalizeConversation(payload: AgentDevCreateConversationPayload = {}): AgentDevSeedConversation {
  const now = new Date().toISOString();
  const id = typeof payload.id === 'string' && payload.id.trim()
    ? payload.id.trim()
    : `agent-dev-${Date.now().toString(36)}`;
  return {
    id,
    title: typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : 'Agent dev conversation',
    agentId: payload.agentId,
    workspacePath: payload.workspacePath,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    createdAt: now,
  };
}

function normalizeProvider(payload: AgentDevCreateProviderConfigPayload): AgentDevSeedProviderConfig {
  const provider = payload.provider;
  return {
    id: provider.id,
    name: provider.name || provider.id,
    type: provider.type || 'custom',
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiProtocol: provider.apiProtocol,
    hasApiKey: Boolean(payload.apiKey || provider.hasApiKey),
  };
}

function rememberCall(call: AgentDevHostApiCall): void {
  hostApiCalls.push(call);
  if (hostApiCalls.length > MAX_CALLS) {
    hostApiCalls.splice(0, hostApiCalls.length - MAX_CALLS);
  }
}

function rememberTransportEvent(event: AgentDevTransportTraceEvent): void {
  transportTraceEvents.push(event);
  if (transportTraceEvents.length > MAX_TRANSPORT_EVENTS) {
    transportTraceEvents.splice(0, transportTraceEvents.length - MAX_TRANSPORT_EVENTS);
  }
}

function safeJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function getVisualPreset(override?: AgentDevVisualPreset): AgentDevVisualPreset {
  const envEnabled = process.env.CLAWX_VISUAL_MODE === '1' || process.env.VERSE_CLAW_VISUAL_MODE === '1';
  return {
    enabled: envEnabled,
    width: Number(process.env.CLAWX_VISUAL_WIDTH || 1440),
    height: Number(process.env.CLAWX_VISUAL_HEIGHT || 900),
    theme: process.env.CLAWX_VISUAL_THEME === 'dark' ? 'dark' : 'light',
    language: ['en', 'zh', 'ja', 'ru'].includes(process.env.CLAWX_VISUAL_LANGUAGE || '')
      ? process.env.CLAWX_VISUAL_LANGUAGE as 'en' | 'zh' | 'ja' | 'ru'
      : 'en',
    reducedMotion: process.env.CLAWX_VISUAL_REDUCED_MOTION !== '0',
    ...seedState.visual,
    ...override,
  };
}

export function createAgentDevApi(ctx: AgentDevApiContext): CompleteHostServiceRegistry['agentDev'] {
  ctx.gatewayManager.on('status', (status) => {
    rememberTransportEvent({
      id: `gateway-status-${Date.now().toString(36)}`,
      at: Date.now(),
      layer: 'gateway',
      direction: 'internal',
      label: `status:${status.state}`,
      metadata: { status: status as unknown as JsonRecord },
    });
  });
  ctx.gatewayManager.on('message', (message) => {
    rememberTransportEvent({
      id: `gateway-message-${Date.now().toString(36)}`,
      at: Date.now(),
      layer: 'gateway',
      direction: 'in',
      label: 'message',
      metadata: safeJsonRecord(message),
    });
  });

  return {
    status: () => ({
      success: true,
      enabled: isEnabled(),
      scenarios: SCENARIOS,
      state: seedState,
      flags: seedState.featureFlags,
      mockReplay: {
        mode: mockReplayMode,
        fixtureCount: mockReplayFixtures?.length ?? 0,
        callCount: hostApiCalls.length,
      },
    }),
    scenarios: () => SCENARIOS,
    seedState: async (payload) => {
      requireEnabled();
      assertAgentDevSeedStatePayload(payload);
      const body = payload ?? {};
      const applied = await applySettingsPatch(body.settings);
      const scenario = normalizeScenario(body.scenario);
      const scenarioSeed = scenario
        ? SCENARIOS.find((entry) => entry.id === scenario)?.seed ?? {}
        : {};
      const next = touchState({
        scenario,
        settings: body.settings ?? seedState.settings,
        conversations: body.conversations ?? seedState.conversations,
        providers: body.providers ?? seedState.providers,
        gatewayStatus: body.gatewayStatus ?? safeJsonRecord(scenarioSeed.gatewayStatus),
        featureFlags: body.featureFlags ? uniqueFlags(body.featureFlags) : seedState.featureFlags,
        visual: body.visual ?? seedState.visual,
        metadata: { ...seedState.metadata, ...safeJsonRecord(scenarioSeed), ...safeJsonRecord(body.metadata) },
      });
      return { success: true, enabled: true, state: next, applied };
    },
    resetState: () => {
      requireEnabled();
      seedState = createEmptySeedState();
      hostApiCalls.length = 0;
      transportTraceEvents.length = 0;
      mockReplayMode = 'off';
      mockReplayFixtures = [];
      return { success: true, enabled: true, state: seedState, applied: ['agentDev.reset'] };
    },
    createConversation: (payload) => {
      requireEnabled();
      const conversation = normalizeConversation(payload);
      const conversations = [
        ...seedState.conversations.filter((entry) => entry.id !== conversation.id),
        conversation,
      ];
      const state = touchState({ conversations });
      return { success: true, enabled: true, conversation, state };
    },
    createProviderConfig: (payload) => {
      requireEnabled();
      if (!payload?.provider?.id) {
        throw new Error('Invalid provider seed payload');
      }
      const provider = normalizeProvider(payload);
      const providers = [
        ...seedState.providers.filter((entry) => entry.id !== provider.id),
        provider,
      ];
      const state = touchState({ providers });
      return { success: true, enabled: true, provider, state };
    },
    configureMockReplay: (payload) => {
      requireEnabled();
      assertAgentDevMockReplayConfig(payload);
      mockReplayMode = payload.mode;
      mockReplayFixtures = Array.isArray(payload.fixtures) ? payload.fixtures : mockReplayFixtures;
      if (payload.clearCalls) hostApiCalls.length = 0;
      return {
        success: true,
        enabled: true,
        mode: mockReplayMode,
        fixtureCount: mockReplayFixtures?.length ?? 0,
        callCount: hostApiCalls.length,
      };
    },
    hostApiCalls: (payload) => {
      const limit = typeof payload?.limit === 'number'
        ? Math.max(1, Math.min(Math.floor(payload.limit), MAX_CALLS))
        : MAX_CALLS;
      return { success: true, calls: hostApiCalls.slice(-limit) };
    },
    featureFlags: () => ({ success: true, flags: seedState.featureFlags }),
    setFeatureFlags: (payload: AgentDevFeatureFlagsPayload) => {
      requireEnabled();
      assertAgentDevFeatureFlagsPayload(payload);
      const incoming = Array.isArray(payload.flags) ? payload.flags : [];
      const flags = payload.merge
        ? uniqueFlags([...seedState.featureFlags, ...incoming])
        : uniqueFlags(incoming);
      touchState({ featureFlags: flags });
      return { success: true, flags };
    },
    visualPreset: (payload) => {
      const preset = getVisualPreset(payload);
      if (payload) touchState({ visual: preset });
      return { success: true, preset };
    },
    diagnosticsSnapshot: async () => {
      const settings = await getAllSettings();
      const diagnostics = ctx.gatewayManager.getDiagnostics?.() ?? {};
      const gatewayStatus = ctx.gatewayManager.getStatus();
      return {
        success: true,
        snapshot: {
          capturedAt: Date.now(),
          app: {
            name: app.getName(),
            version: app.getVersion(),
            platform: process.platform,
            isPackaged: app.isPackaged,
          },
          agentDev: {
            enabled: isEnabled(),
            scenario: seedState.scenario,
            flags: seedState.featureFlags,
            visual: getVisualPreset(),
          },
          gateway: {
            status: gatewayStatus,
            diagnostics,
            capabilities: typeof ctx.gatewayManager.getCapabilitySnapshot === 'function'
              ? ctx.gatewayManager.getCapabilitySnapshot()
              : undefined,
          },
          settings: {
            theme: settings.theme,
            language: settings.language,
            devModeUnlocked: settings.devModeUnlocked,
            gatewayAutoStart: settings.gatewayAutoStart,
            roleMemoryEnabled: settings.roleMemoryEnabled,
          },
          sandbox: await buildSandboxStatus(),
          recentHostApiCalls: hostApiCalls.slice(-25),
          recentTransportTrace: transportTraceEvents.slice(-25),
          logTail: await logger.readLogFile(80),
        },
      };
    },
    transportTrace: (payload?: AgentDevTransportTracePayload) => {
      const limit = typeof payload?.limit === 'number'
        ? Math.max(1, Math.min(Math.floor(payload.limit), MAX_TRANSPORT_EVENTS))
        : 100;
      return { success: true, events: transportTraceEvents.slice(-limit) };
    },
    selectorContract: () => ({
      success: true,
      requiredAttributes: ['data-testid'],
      requiredSurfaces: [
        'main navigation',
        'page root',
        'primary action buttons',
        'modal/dialog roots',
        'toast-producing actions',
        'status banners',
        'list rows and repeated items',
      ],
      notes: [
        'Selectors must be stable across locales and themes.',
        'Prefer semantic test ids over CSS class or visible text locators for agent-authored E2E specs.',
      ],
    }),
  };
}

export function recordAgentDevHostApiCall(call: AgentDevHostApiCall): void {
  rememberCall(call);
}
