import type { AgentDevScenarioId } from '@shared/host-api/contract';

type HostApiReplayMode = 'off' | 'record' | 'replay';
type HostApiFixture = {
  module: string;
  action: string;
  payload?: unknown;
  result: unknown;
};
type HostApiCall = {
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
type AgentDevSnapshotInput = {
  route: string;
  language: string;
  theme: string;
  setupComplete: boolean;
  devModeUnlocked: boolean;
};
type AgentDevTestSurface = {
  hostApiCalls: HostApiCall[];
  hostApiReplay: {
    mode: HostApiReplayMode;
    fixtures: HostApiFixture[];
  };
  featureFlags: string[];
  devScenario: AgentDevScenarioId | null;
  visualMode: boolean;
  getSnapshot: () => AgentDevSnapshotInput & {
    activeElementTestId: string | null;
    visibleToasts: string[];
    activeModalTestId: string | null;
    featureFlags: string[];
    devScenario: AgentDevScenarioId | null;
    visualMode: boolean;
  };
  setHostApiReplay: (config: Partial<AgentDevTestSurface['hostApiReplay']>) => void;
  clearHostApiCalls: () => void;
  hasFlag: (flag: string) => boolean;
};

const REPLAY_STORAGE_KEY = 'clawx.agentDev.hostApiReplay';
const FLAGS_STORAGE_KEY = 'clawx.agentDev.flags';
const VALID_SCENARIOS = new Set<string>([
  'chat-empty',
  'chat-streaming',
  'models-heavy-usage',
  'settings-provider-error',
  'doctor-failed',
  'gateway-connecting',
  'knowledge-drafts',
  'observability-trace-errors',
]);

function query(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function readFlags(): string[] {
  const params = query();
  const raw = params.get('flags') || window.localStorage.getItem(FLAGS_STORAGE_KEY) || '';
  return [...new Set(raw.split(',').map((flag) => flag.trim()).filter(Boolean))].sort();
}

function readScenario(): AgentDevScenarioId | null {
  const value = query().get('devScenario');
  return value && VALID_SCENARIOS.has(value) ? value as AgentDevScenarioId : null;
}

function readReplayConfig(): AgentDevTestSurface['hostApiReplay'] {
  try {
    const raw = window.localStorage.getItem(REPLAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AgentDevTestSurface['hostApiReplay']>;
      return {
        mode: parsed.mode ?? 'off',
        fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : [],
      };
    }
  } catch {
    // Ignore invalid local dev data.
  }
  return { mode: 'off', fixtures: [] };
}

function getTestId(element: Element | null): string | null {
  if (!element) return null;
  return element.getAttribute('data-testid')
    ?? element.closest('[data-testid]')?.getAttribute('data-testid')
    ?? null;
}

function visibleText(selector: string): string[] {
  return [...document.querySelectorAll(selector)]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);
}

function getActiveModalTestId(): string | null {
  const candidates = [
    '[role="dialog"]',
    '[data-radix-dialog-content]',
    '[data-testid$="-dialog"]',
    '[data-testid$="-modal"]',
  ];
  for (const selector of candidates) {
    const id = getTestId(document.querySelector(selector));
    if (id) return id;
  }
  return null;
}

function scenarioRoute(scenario: AgentDevScenarioId | null): string | null {
  switch (scenario) {
    case 'models-heavy-usage':
    case 'settings-provider-error':
      return '/settings/models';
    case 'doctor-failed':
      return '/settings/advanced';
    case 'knowledge-drafts':
      return '/knowledge';
    case 'observability-trace-errors':
      return '/observability';
    case 'chat-empty':
    case 'chat-streaming':
    case 'gateway-connecting':
      return '/';
    default:
      return null;
  }
}

export function getAgentDevScenarioRoute(): string | null {
  return scenarioRoute(readScenario());
}

export function installAgentDevTestSurface(input: AgentDevSnapshotInput): void {
  if (typeof window === 'undefined') return;
  const existing = (window as unknown as { __CLAWX_TEST__?: Partial<AgentDevTestSurface> }).__CLAWX_TEST__;
  const featureFlags = readFlags();
  const devScenario = readScenario();
  const visualMode = query().get('visual') === '1' || query().get('visualMode') === '1';
  const hostApiReplay = existing?.hostApiReplay ?? readReplayConfig();
  const hostApiCalls = existing?.hostApiCalls ?? [];
  const surface: AgentDevTestSurface = {
    hostApiCalls,
    hostApiReplay,
    featureFlags,
    devScenario,
    visualMode,
    getSnapshot: () => ({
      ...input,
      activeElementTestId: getTestId(document.activeElement),
      visibleToasts: visibleText('[data-sonner-toast], [role="status"], [role="alert"]'),
      activeModalTestId: getActiveModalTestId(),
      featureFlags,
      devScenario,
      visualMode,
    }),
    setHostApiReplay: (config) => {
      surface.hostApiReplay = {
        mode: config.mode ?? surface.hostApiReplay.mode,
        fixtures: Array.isArray(config.fixtures) ? config.fixtures : surface.hostApiReplay.fixtures,
      };
      window.localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(surface.hostApiReplay));
    },
    clearHostApiCalls: () => {
      surface.hostApiCalls.length = 0;
    },
    hasFlag: (flag) => surface.featureFlags.includes(flag),
  };

  document.documentElement.dataset.agentDevScenario = devScenario ?? '';
  document.documentElement.dataset.visualMode = visualMode ? '1' : '0';
  document.documentElement.dataset.agentDevFlags = featureFlags.join(',');
  if (featureFlags.length > 0) {
    window.localStorage.setItem(FLAGS_STORAGE_KEY, featureFlags.join(','));
  }
  (window as unknown as { __CLAWX_TEST__?: AgentDevTestSurface }).__CLAWX_TEST__ = surface;
}

declare global {
  interface Window {
    __CLAWX_TEST__?: AgentDevTestSurface;
  }
}
