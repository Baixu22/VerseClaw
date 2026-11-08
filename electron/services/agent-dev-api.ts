import { app } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  AgentDevWorkbenchEvidence,
  JsonRecord,
  SettingsSnapshot,
} from '@shared/host-api/contract';
import {
  createEmptyCostUsage,
  type AgentDevCostReport,
  type AgentDevCostUsage,
  type AgentDevSkillSandboxReport,
} from '@shared/agent-dev/trace-contract';
import {
  assertAgentDevFeatureFlagsPayload,
  assertAgentDevMockReplayConfig,
  assertAgentDevRecordScenarioPayload,
  assertAgentDevSeedStatePayload,
} from '@shared/host-api/agent-dev-schemas';
import {
  getAgentDevScenario,
  isAgentDevScenarioId,
  listAgentDevScenarios,
} from '@shared/agent-dev/scenarios';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import { getAllSettings, setSetting } from '../utils/store';
import { logger } from '../utils/logger';
import { buildSandboxStatus } from './sandbox-api';

type AgentDevApiContext = {
  gatewayManager: GatewayManager;
};

const MAX_CALLS = 500;
const MAX_TRANSPORT_EVENTS = 500;
const REDACTED = '[redacted]';
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|token|authorization|secret|password)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|rk|pk|ghp|github_pat)_[A-Za-z0-9_=-]{8,}\b/g,
  /\b(?:api[-_ ]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'"\s,;}]+/gi,
];

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
  return isAgentDevScenarioId(value) ? value : undefined;
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

function slugify(value: unknown): string {
  const slug = String(value || 'scenario')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'scenario';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeStringForArtifact(value: string): string {
  let output = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  const home = app.getPath('home');
  if (home) {
    output = output.replace(new RegExp(escapeRegExp(home), 'gi'), '~');
    output = output.replace(new RegExp(escapeRegExp(home.replaceAll('\\', '/')), 'gi'), '~');
  }
  return output;
}

function sanitizeForArtifact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForArtifact);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return sanitizeStringForArtifact(value);
    return value;
  }
  const output: JsonRecord = {};
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
    } else {
      output[key] = sanitizeForArtifact(entry);
    }
  }
  return output;
}

function addUsage(target: AgentDevCostUsage, usage: Partial<AgentDevCostUsage>): void {
  target.inputTokens += usage.inputTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  target.cacheTokens += usage.cacheTokens ?? 0;
  target.totalTokens += usage.totalTokens ?? 0;
  target.estimatedCost += usage.estimatedCost ?? 0;
}

function numberFromMetadata(metadata: JsonRecord | undefined, key: keyof AgentDevCostUsage): number {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function usageMetadata(value: unknown): JsonRecord {
  const usage = safeJsonRecord(value);
  const count = (...keys: string[]) => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    }
    return 0;
  };
  return {
    inputTokens: count('inputTokens', 'input'),
    outputTokens: count('outputTokens', 'output'),
    cacheTokens: count('cacheTokens') || count('cacheRead') + count('cacheWrite'),
    totalTokens: count('totalTokens', 'total'),
    estimatedCost: count('estimatedCost') || (() => {
      const total = safeJsonRecord(usage.cost).total;
      return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : 0;
    })(),
  };
}

function buildCostReport(): AgentDevCostReport {
  const totals = createEmptyCostUsage();
  const byAgent: AgentDevCostReport['byAgent'] = {};
  const bySkill: AgentDevCostReport['bySkill'] = {};
  const hotPath: AgentDevCostReport['hotPath'] = [];

  const unique = new Map<string, AgentDevTransportTraceEvent>();
  for (const event of transportTraceEvents) {
    const key = typeof event.metadata?.usageKey === 'string' ? event.metadata.usageKey : event.id;
    unique.set(key, event);
  }
  const runSummaries = new Set([...unique.values()]
    .filter((event) => event.metadata?.usageScope === 'run')
    .map((event) => event.metadata?.runId));
  const messageCosts = new Map<unknown, number>();
  for (const event of unique.values()) {
    if (event.metadata?.usageScope === 'message') messageCosts.set(event.metadata.runId,
      (messageCosts.get(event.metadata.runId) ?? 0) + numberFromMetadata(event.metadata, 'estimatedCost'));
  }
  for (const event of unique.values()) {
    if (event.metadata?.usageScope === 'message' && runSummaries.has(event.metadata?.runId)) continue;
    const usage = {
      inputTokens: numberFromMetadata(event.metadata, 'inputTokens'),
      outputTokens: numberFromMetadata(event.metadata, 'outputTokens'),
      cacheTokens: numberFromMetadata(event.metadata, 'cacheTokens'),
      totalTokens: numberFromMetadata(event.metadata, 'totalTokens'),
      estimatedCost: numberFromMetadata(event.metadata, 'estimatedCost'),
    };
    if (event.metadata?.usageScope === 'run' && usage.estimatedCost === 0) {
      usage.estimatedCost = messageCosts.get(event.metadata.runId) ?? 0;
    }
    if (usage.totalTokens === 0) {
      usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheTokens;
    }
    if (usage.totalTokens === 0 && usage.estimatedCost === 0) continue;
    addUsage(totals, usage);

    const agent = typeof event.metadata?.agentId === 'string' ? event.metadata.agentId : 'unknown';
    byAgent[agent] ??= createEmptyCostUsage();
    addUsage(byAgent[agent], usage);

    const skill = typeof event.metadata?.skillId === 'string' ? event.metadata.skillId : undefined;
    if (skill) {
      bySkill[skill] ??= createEmptyCostUsage();
      addUsage(bySkill[skill], usage);
    }

    hotPath.push({
      label: event.label,
      requestId: event.requestId,
      totalTokens: usage.totalTokens,
      estimatedCost: usage.estimatedCost,
    });
  }

  hotPath.sort((left, right) => right.totalTokens - left.totalTokens);
  return {
    generatedAt: new Date().toISOString(),
    totals,
    byAgent,
    bySkill,
    hotPath: hotPath.slice(0, 20),
  };
}

function buildSkillSandboxReport(): AgentDevSkillSandboxReport {
  return {
    generatedAt: new Date().toISOString(),
    capabilityGate: {
      network: false,
      filesystem: false,
      'model-call': false,
      'channel-send': false,
    },
    budget: {
      tokenLimit: 10000,
      apiCallLimit: 25,
      executionMsLimit: 30000,
      memoryMbLimit: 256,
    },
    effects: transportTraceEvents
      .filter((event) => event.label === 'tool.completed' && event.metadata?.capability)
      .slice(-50)
      .map((event) => ({
        id: event.id,
        at: event.at,
        capability: event.metadata?.capability as 'filesystem' | 'network',
        label: event.label,
        allowed: event.metadata?.isError !== true,
        metadata: event.metadata,
      })),
  };
}

async function readProjectFile(path: string): Promise<string> {
  try {
    return await readFile(resolve(process.cwd(), path), 'utf8');
  } catch {
    return '';
  }
}

function extractAgentDevContractActions(contractText: string): string[] {
  const match = contractText.match(/agentDev:\s*\{([\s\S]*?)^\s{2}\};/m);
  if (!match) return [];
  return [...match[1].matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)]
    .map((entry) => entry[1])
    .sort();
}

function extractAgentDevFacadeActions(hostApiText: string): string[] {
  const match = hostApiText.match(/^\s{2}agentDev:\s*\{([\s\S]*?)^\s{2}\},/m);
  if (!match) return [];
  return [...match[1].matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)]
    .map((entry) => entry[1])
    .sort();
}

function extractAgentDevServiceActions(serviceText: string): string[] {
  return [...serviceText.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):\s*(?:async\s*)?(?:\(|\()/gm)]
    .map((entry) => entry[1])
    .sort();
}

function parseProjectJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function buildWorkbenchEvidence(): Promise<AgentDevWorkbenchEvidence> {
  const [contractText, hostApiText, serviceText, traceContractText, auditText, deepTestText] = await Promise.all([
    readProjectFile('shared/host-api/contract.ts'),
    readProjectFile('src/lib/host-api.ts'),
    readProjectFile('electron/services/agent-dev-api.ts'),
    readProjectFile('shared/agent-dev/trace-contract.ts'),
    readProjectFile('artifacts/agent-dev-audit/report.json'),
    readProjectFile('artifacts/agent-dev-deep-test/report.json'),
  ]);
  const contractActions = extractAgentDevContractActions(contractText);
  const facadeActions = extractAgentDevFacadeActions(hostApiText);
  const serviceActions = extractAgentDevServiceActions(serviceText);
  const auditReport = parseProjectJson(auditText);
  const deepTestReport = parseProjectJson(deepTestText);
  const evidenceInventory = Array.isArray(auditReport?.evidenceInventory)
    ? auditReport.evidenceInventory as Array<{ generated?: boolean; ageHours?: number | null }>
    : [];
  const generatedAges = evidenceInventory
    .filter((item) => item.generated && typeof item.ageHours === 'number')
    .map((item) => item.ageHours as number);
  const maxEvidenceAgeHours = typeof auditReport?.policy === 'object' && auditReport.policy !== null
    && typeof (auditReport.policy as { maxEvidenceAgeHours?: unknown }).maxEvidenceAgeHours === 'number'
    ? (auditReport.policy as { maxEvidenceAgeHours: number }).maxEvidenceAgeHours
    : null;
  const deepDecision = typeof deepTestReport?.decision === 'object' && deepTestReport.decision !== null
    ? deepTestReport.decision as { status?: unknown; requiredFullGates?: unknown }
    : null;

  return {
    generatedAt: new Date().toISOString(),
    scenarioCount: listAgentDevScenarios().length,
    evidenceAgeHours: generatedAges.length > 0 ? Math.max(...generatedAges) : null,
    maxEvidenceAgeHours,
    requiredFullGates: Array.isArray(deepDecision?.requiredFullGates)
      ? deepDecision.requiredFullGates.filter((entry): entry is string => typeof entry === 'string')
      : [],
    decisionStatus: typeof deepDecision?.status === 'string' ? deepDecision.status : null,
    artifactStatus: {
      workbench: existsSync(resolve(process.cwd(), 'artifacts', 'agent-dev-workbench')),
      quality: existsSync(resolve(process.cwd(), 'artifacts', 'agent-dev-quality')),
      channelConformance: existsSync(resolve(process.cwd(), 'artifacts', 'channel-conformance')),
      scenarioRecordings: existsSync(resolve(process.cwd(), 'artifacts', 'agent-dev-scenarios')),
    },
    hostApi: {
      contractActions,
      facadeActions,
      serviceActions,
      missingFacadeActions: contractActions.filter((action) => !facadeActions.includes(action)),
      missingServiceActions: contractActions.filter((action) => !serviceActions.includes(action)),
    },
    contracts: {
      traceTimeline: traceContractText.includes('AgentDevTraceEvent'),
      costReport: traceContractText.includes('AgentDevCostReport'),
      skillSandboxReport: traceContractText.includes('AgentDevSkillSandboxReport'),
      selectorContract: serviceText.includes('selectorContract:'),
    },
    gateCommands: {
      fastPr: [
        'pnpm agent-dev:fast',
      ],
      fullLocal: [
        'pnpm agent-dev:full-local',
        'pnpm run test:e2e:agent-dev-quality:run',
        'pnpm channel:conformance <channel-name>',
      ],
      nightlyRelease: [
        'pnpm agent-dev:deep-test',
        'pnpm run comms:replay',
        'pnpm run comms:compare',
        'pnpm run test:e2e',
      ],
    },
  };
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

  ctx.gatewayManager.on('chat:runtime-event', (event: ChatRuntimeEvent) => {
    const frame = event as ChatRuntimeEvent & { requestId?: string };
    rememberTransportEvent({
      id: `runtime:${event.runId}:${event.seq ?? transportTraceEvents.length}:${event.type}`,
      requestId: frame.requestId ?? event.runId,
      at: event.ts ?? Date.now(),
      layer: event.type.startsWith('tool.') ? 'tool' : 'runtime',
      direction: 'in',
      label: event.type,
      metadata: {
        runId: event.runId,
        sessionKey: event.sessionKey,
        agentId: event.sessionKey?.split(':')[1] ?? 'unknown',
        ...('name' in event ? { toolName: event.name } : {}),
        ...('name' in event && typeof event.name === 'string' ? {
          capability: ['read', 'write', 'edit', 'apply_patch', 'file.read', 'file.write', 'file.edit'].includes(event.name)
            ? 'filesystem' : ['web_fetch', 'web_search'].includes(event.name) ? 'network' : undefined,
        } : {}),
        observation: true,
        ...('isError' in event ? { isError: event.isError } : {}),
        ...(event.type === 'run.ended' && event.tokenUsage ? {
          ...usageMetadata(event.tokenUsage), usageKey: `run:${event.runId}`, usageScope: 'run',
        } : {}),
      },
    });
  });
  ctx.gatewayManager.on('chat:message', (payload) => {
    const frame = safeJsonRecord(payload);
    const envelope = safeJsonRecord(frame.message);
    const message = envelope.message ? safeJsonRecord(envelope.message) : envelope;
    const runId = typeof frame.runId === 'string' ? frame.runId
      : typeof envelope.runId === 'string' ? envelope.runId : undefined;
    const requestId = [frame.requestId, envelope.requestId, message.requestId, runId]
      .find((value): value is string => typeof value === 'string');
    const sessionKey = typeof frame.sessionKey === 'string' ? frame.sessionKey : envelope.sessionKey;
    const messageId = message.id ?? message.timestamp ?? envelope.seq ?? frame.seq;
    rememberTransportEvent({
      id: `chat:${runId ?? requestId ?? 'unknown'}:${messageId ?? transportTraceEvents.length}`,
      requestId,
      at: Date.now(),
      layer: 'model',
      direction: 'in',
      label: 'chat:message',
      metadata: {
        runId, sessionKey,
        agentId: typeof sessionKey === 'string' ? sessionKey.split(':')[1] : 'unknown',
        ...(message.usage && (messageId !== undefined || frame.state === 'final' || envelope.state === 'final') ? {
          ...usageMetadata(message.usage),
          usageKey: `message:${runId ?? requestId ?? sessionKey ?? 'unknown'}:${messageId ?? 'final'}`,
          usageScope: 'message',
        } : {}),
      },
    });
  });

  return {
    status: () => ({
      success: true,
      enabled: isEnabled(),
      scenarios: listAgentDevScenarios() as AgentDevScenario[],
      state: seedState,
      flags: seedState.featureFlags,
      mockReplay: {
        mode: mockReplayMode,
        fixtureCount: mockReplayFixtures?.length ?? 0,
        callCount: hostApiCalls.length,
      },
    }),
    scenarios: () => listAgentDevScenarios() as AgentDevScenario[],
    seedState: async (payload) => {
      requireEnabled();
      assertAgentDevSeedStatePayload(payload);
      const body = payload ?? {};
      const applied = await applySettingsPatch(body.settings);
      const scenario = normalizeScenario(body.scenario);
      const scenarioSeed = scenario ? getAgentDevScenario(scenario).seed : {};
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
    traceTimeline: (payload) => {
      const limit = typeof payload?.limit === 'number'
        ? Math.max(1, Math.min(Math.floor(payload.limit), MAX_TRANSPORT_EVENTS))
        : 100;
      const relatedRuns = new Set(transportTraceEvents
        .filter((event) => event.requestId === payload?.requestId && typeof event.metadata?.runId === 'string')
        .map((event) => event.metadata?.runId));
      const events = payload?.requestId
        ? transportTraceEvents.filter((event) => event.requestId === payload.requestId || relatedRuns.has(event.metadata?.runId))
        : transportTraceEvents;
      return { success: true, events: events.slice(-limit) };
    },
    costReport: () => ({ success: true, report: buildCostReport() }),
    skillSandboxReport: () => ({ success: true, report: buildSkillSandboxReport() }),
    workbenchEvidence: async () => ({ success: true, evidence: await buildWorkbenchEvidence() }),
    recordScenario: async (payload = {}) => {
      requireEnabled();
      assertAgentDevRecordScenarioPayload(payload);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const slug = slugify(payload.slug ?? seedState.scenario ?? 'scenario');
      const outDir = resolve(process.cwd(), 'artifacts', 'agent-dev-scenarios');
      const artifactPath = resolve(outDir, `${timestamp}-${slug}.scenario.json`);
      const scenario = sanitizeForArtifact({
        schema: 'clawx.agent-dev.scenario-recording.v1',
        capturedAt: new Date().toISOString(),
        route: payload.route ?? getAgentDevScenario(seedState.scenario ?? 'chat-empty').route,
        seedState,
        hostApiCalls: hostApiCalls.slice(-100),
        transportTrace: transportTraceEvents.slice(-100),
        featureFlags: seedState.featureFlags,
        language: payload.language,
        theme: payload.theme,
        visibleState: payload.visibleState,
        diagnostics: ctx.gatewayManager.getDiagnostics?.() ?? {},
        review: {
          required: true,
          promotionTargets: [
            'shared/agent-dev/scenarios.ts seed',
            'tests/e2e/<scenario>.spec.ts snapshot-backed E2E',
            'harness/specs/scenarios/<scenario>.md',
            'optional fixture under tests/e2e/fixtures when replay data is stable',
          ],
          validation: [
            'pnpm contract:check',
            'pnpm i18n:lint',
            'pnpm agent-dev:workbench',
            'targeted Playwright spec for the promoted scenario',
          ],
          redactionRules: [
            'keys matching token/apiKey/secret/password/authorization are replaced with [redacted]',
            'Bearer/Basic credentials and common API key prefixes in string values are replaced with [redacted]',
            'local home directory paths are rewritten to ~',
          ],
        },
      }) as JsonRecord;
      await mkdir(outDir, { recursive: true });
      await writeFile(artifactPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
      return { success: true, artifactPath, scenario };
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
