/**
 * Runtime Efficiency Host API
 *
 * P2 #161: exposes the Main-process efficiency sampler to the renderer.
 *
 * This is a read surface plus an explicit opt-out toggle. The renderer never
 * talks to the sampler directly, and it never sees a synthesized value: before
 * the first real sample the state reports `measured: false` with a null summary
 * so the UI can fail closed to "not sampled" instead of showing a healthy zero.
 *
 * Everything stays local. Nothing here uploads, and the toggle only starts or
 * stops the existing unref'd timer.
 */
import type {
  RuntimeEfficiencyShedState,
  RuntimeEfficiencyState,
  RuntimeEfficiencySummary,
} from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getSetting, setSetting } from '../utils/store';
import {
  getBackgroundWorkGateState,
  getEfficiencyShedState,
  getEfficiencySamples,
  getEfficiencySummary,
  isRuntimeEfficiencyRunning,
  startRuntimeEfficiency,
  stopRuntimeEfficiency,
} from './efficiency-orchestrator';

/** The documented default is enabled; only an explicit `false` disables. */
function normalizeEnabled(value: unknown): boolean {
  return value !== false;
}

async function readEnabled(): Promise<boolean> {
  try {
    return normalizeEnabled(await getSetting('efficiencySamplingEnabled'));
  } catch {
    // The store should always be available here; fall back to the default so a
    // read failure cannot silently disable sampling behind the user's back.
    return true;
  }
}

function toSummary(summary: ReturnType<typeof getEfficiencySummary>): RuntimeEfficiencySummary | null {
  // The sampler returns a zeroed summary before its first sample. Collapse that
  // to null so the renderer fails closed to "not sampled" instead of rendering
  // a healthy-looking zero.
  if (!summary || summary.sampleCount <= 0) {
    return null;
  }
  return { ...summary, latest: summary.latest ? { ...summary.latest } : null };
}

function toShedState(state: ReturnType<typeof getEfficiencyShedState>): RuntimeEfficiencyShedState | null {
  if (!state) {
    return null;
  }
  return { ...state, activeReasons: [...state.activeReasons] };
}

async function buildState(): Promise<RuntimeEfficiencyState> {
  const summary = toSummary(getEfficiencySummary());
  return {
    enabled: await readEnabled(),
    running: isRuntimeEfficiencyRunning(),
    measured: summary !== null,
    summary,
    samples: getEfficiencySamples(),
    shed: toShedState(getEfficiencyShedState()),
    backgroundWork: getBackgroundWorkGateState(),
  };
}

export function createEfficiencyApi(): CompleteHostServiceRegistry['efficiency'] {
  return {
    getState: () => buildState(),
    setEnabled: async (payload) => {
      const enabled = (payload as { enabled?: unknown } | undefined)?.enabled;
      if (typeof enabled !== 'boolean') {
        throw new Error('Invalid efficiency sampling payload: expected { enabled: boolean }');
      }
      await setSetting('efficiencySamplingEnabled', enabled);
      if (enabled) {
        startRuntimeEfficiency();
      } else {
        stopRuntimeEfficiency();
      }
      return buildState();
    },
  };
}
