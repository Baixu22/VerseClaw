// @vitest-environment node
/**
 * A2b wiring: the session_start channel, its bounded behaviour, and its
 * fail-closed paths.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  computeContextExtraSystemPrompt,
  endContextOrchestratorTurn,
  finalizeContextOrchestratorTurn,
  getContextOrchestratorCollection,
  getLastContextOrchestratorLineage,
  resetContextOrchestratorLineageForTests,
} from '../../openclaw_runtime/src/context-engine/context-orchestrator';
import { resetContextCandidateCollectionsForTests } from '../../openclaw_runtime/src/context-engine/context-candidate';
import {
  SESSION_START_INJECTION_ENV,
  buildSessionStartInjectionCandidates,
  buildSessionStartInjectionPlanFromRequest,
  resolveSessionStartInjectionConfig,
} from '../../openclaw_runtime/src/context-engine/session-start-injection';
import {
  endTurnInjectionBudget,
  setTurnInjectionBudgetConfig,
} from '../../openclaw_runtime/src/context-engine/turn-injection-budget';
import {
  TURN_INJECTION_CHANNEL_POLICY,
  TURN_INJECTION_PRECEDENCE,
} from '../../openclaw_runtime/src/context-engine/turn-injection-budget';
import {
  SESSION_START_INJECTION_REQUEST_SCHEMA,
  type SessionStartInjectionRequest,
} from '../../shared/types/session-start-injection';

const HEADER = '[Startup context loaded by runtime]';
const LONG_PRELUDE = `${HEADER}\n${'y'.repeat(4000)}`;

const ON_CFG = { runtime: { contextBlock: { sessionStartInjection: { enabled: true } } } };

function request(overrides: Partial<SessionStartInjectionRequest> = {}): SessionStartInjectionRequest {
  const text = overrides.texts?.['startup-memory'] ?? LONG_PRELUDE;
  return {
    schema: SESSION_START_INJECTION_REQUEST_SCHEMA,
    sessionKey: 'agent:main:main',
    stage: 'fresh',
    facts: [
      { sourceId: 'startup-memory', available: true, chars: text.length },
      { sourceId: 'continuity-pack', available: false, chars: 0 },
      { sourceId: 'handoff-draft', available: false, chars: 0 },
      { sourceId: 'fork-inheritance', available: false, chars: 0 },
    ],
    texts: { 'startup-memory': text },
    ...overrides,
  };
}

async function runTurn(params: { turnId: string; cfg: unknown; sessionStart?: SessionStartInjectionRequest }) {
  const { extraSystemPrompt } = await computeContextExtraSystemPrompt(
    'BASE',
    params.cfg,
    {
      turnId: params.turnId,
      deferProjection: true,
      sessionKey: 'agent:main:main',
      ...(params.sessionStart ? { sessionStart: params.sessionStart } : {}),
    },
    { stages: ['memory'] },
  );
  const finalized = finalizeContextOrchestratorTurn({ turnId: params.turnId, messages: [] });
  const lineage = (getContextOrchestratorCollection(params.turnId)?.lineage ?? []).map((entry) => ({
    channel: entry.channel,
    reason: entry.reason,
    charsApplied: entry.charsApplied,
  }));
  const accounting = endTurnInjectionBudget(params.turnId);
  const orchestratorLineage = getLastContextOrchestratorLineage();
  endContextOrchestratorTurn(params.turnId);
  return {
    addition: finalized.projection.systemPromptAddition ?? '',
    prompt: extraSystemPrompt ?? '',
    candidateLineage: lineage,
    accounting,
    orchestratorLineage,
  };
}

beforeEach(() => {
  resetContextCandidateCollectionsForTests();
  resetContextOrchestratorLineageForTests();
});

describe('session_start channel declaration', () => {
  it('sits between knowledge and working memory', () => {
    const order = [...TURN_INJECTION_PRECEDENCE];
    expect(order).toContain('session_start');
    expect(order.indexOf('session_start')).toBe(order.indexOf('knowledge') + 1);
    expect(order.indexOf('session_start')).toBe(order.indexOf('working_memory') - 1);
  });

  it('carries a policy entry that does not decay', () => {
    expect(TURN_INJECTION_CHANNEL_POLICY.session_start.priority).toBeGreaterThan(
      TURN_INJECTION_CHANNEL_POLICY.working_memory.priority,
    );
    expect(TURN_INJECTION_CHANNEL_POLICY.session_start.priority).toBeLessThan(
      TURN_INJECTION_CHANNEL_POLICY.knowledge.priority,
    );
    expect(TURN_INJECTION_CHANNEL_POLICY.session_start.decayHalfLifeTurns).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('flag resolution', () => {
  it('is off by default and honours the config leaf', () => {
    expect(resolveSessionStartInjectionConfig({}, {}).enabled).toBe(false);
    expect(resolveSessionStartInjectionConfig(undefined, {}).enabled).toBe(false);
    expect(resolveSessionStartInjectionConfig(ON_CFG, {}).enabled).toBe(true);
    expect(resolveSessionStartInjectionConfig(ON_CFG, {}).budgetChars).toBeUndefined();
    expect(
      resolveSessionStartInjectionConfig(
        { runtime: { contextBlock: { sessionStartInjection: { enabled: true, budgetChars: 900 } } } },
        {},
      ).budgetChars,
    ).toBe(900);
  });

  it('honours the env override in both directions', () => {
    const env = { [SESSION_START_INJECTION_ENV]: '1' } as NodeJS.ProcessEnv;
    expect(resolveSessionStartInjectionConfig({}, env).enabled).toBe(true);
    const off = { [SESSION_START_INJECTION_ENV]: 'off' } as NodeJS.ProcessEnv;
    expect(resolveSessionStartInjectionConfig(ON_CFG, off).enabled).toBe(false);
    const junk = { [SESSION_START_INJECTION_ENV]: 'maybe' } as NodeJS.ProcessEnv;
    expect(resolveSessionStartInjectionConfig({}, junk).enabled).toBe(false);
  });

  it('fails closed on a malformed or throwing config', () => {
    expect(
      resolveSessionStartInjectionConfig({ runtime: { contextBlock: { sessionStartInjection: 'yes' } } }, {})
        .enabled,
    ).toBe(false);
    const throwing = {
      get runtime(): never {
        throw new Error('config exploded');
      },
    };
    expect(resolveSessionStartInjectionConfig(throwing, {}).enabled).toBe(false);
  });
});

describe('flag on', () => {
  it('injects a bounded system-prompt candidate charged to the ledger', async () => {
    const result = await runTurn({ turnId: 'wiring-on', cfg: ON_CFG, sessionStart: request() });
    expect(result.addition.startsWith(HEADER)).toBe(true);
    // 2800 is the default plan budget: the tail of a 4000-char owner text is cut.
    expect(result.addition.length).toBe(2800);
    expect(result.candidateLineage).toContainEqual({
      channel: 'session_start',
      reason: 'applied',
      charsApplied: 2800,
    });
    expect(result.accounting?.byChannel.session_start?.applied).toBe(2800);
    expect(result.orchestratorLineage?.sessionStart?.stage).toBe('fresh');
  });

  it('explains requested / applied / dropped per source in the lineage plan', async () => {
    const result = await runTurn({ turnId: 'wiring-plan', cfg: ON_CFG, sessionStart: request() });
    const plan = result.orchestratorLineage?.sessionStart;
    expect(plan?.budgetChars).toBe(2800);
    const startup = plan?.items.find((item) => item.sourceId === 'startup-memory');
    expect(startup).toMatchObject({
      included: true,
      reason: 'budget-partial',
      charsRequested: LONG_PRELUDE.length,
      charsApplied: 2800,
    });
    expect(startup?.detail).toContain('truncated ' + (LONG_PRELUDE.length - 2800) + ' chars');
    expect(plan?.items.find((item) => item.sourceId === 'continuity-pack')).toMatchObject({
      included: false,
      reason: 'not-available',
    });
  });

  it('is bounded by an explicit budget and slices to charsApplied exactly', () => {
    const text = `${HEADER}\n${'z'.repeat(500)}`;
    const req = request({ texts: { 'startup-memory': text }, budgetChars: 120 });
    const plan = buildSessionStartInjectionPlanFromRequest(req);
    const candidates = buildSessionStartInjectionCandidates(plan, req.texts);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.channel).toBe('session_start');
    expect(candidates[0]?.target).toBe('system_prompt');
    expect(candidates[0]?.text.length).toBe(120);
    expect(candidates[0]?.text).toBe(text.slice(0, 120));
  });

  it('injects nothing for an unproven stage even with facts present', async () => {
    const result = await runTurn({
      turnId: 'wiring-unknown',
      cfg: ON_CFG,
      sessionStart: request({ stage: 'unknown' }),
    });
    expect(result.addition).toBe('');
    expect(result.orchestratorLineage?.sessionStart?.items.every((item) => !item.included)).toBe(true);
    expect(
      result.orchestratorLineage?.sessionStart?.items.every(
        (item) => item.reason === 'fail-closed-unknown-stage',
      ),
    ).toBe(true);
    expect(result.orchestratorLineage?.sessionStartSkipReason).toBe('empty');
    expect(result.candidateLineage).toContainEqual({
      channel: 'session_start',
      reason: 'empty',
      charsApplied: 0,
    });
  });

  it('injects nothing for a continued session', async () => {
    const result = await runTurn({
      turnId: 'wiring-continued',
      cfg: ON_CFG,
      sessionStart: request({ stage: 'continued' }),
    });
    expect(result.addition).toBe('');
    expect(
      result.orchestratorLineage?.sessionStart?.items.every((item) => item.reason === 'stage-excluded'),
    ).toBe(true);
    expect(result.orchestratorLineage?.sessionStartSkipReason).toBe('empty');
  });

  it('is still enforced by the shared turn ledger, not only by the plan', async () => {
    // The plan grants 2800 chars; the turn ledger is squeezed to 100. The
    // candidate must be truncated by the ledger, and the plan must stay visible
    // as what was cut, so the two never disagree silently.
    setTurnInjectionBudgetConfig({ totalChars: 100 });
    try {
      const result = await runTurn({
        turnId: 'wiring-ledger',
        cfg: ON_CFG,
        sessionStart: request(),
      });
      expect(
        result.orchestratorLineage?.sessionStart?.items.find((i) => i.sourceId === 'startup-memory')
          ?.charsApplied,
      ).toBe(2800);
      expect(result.candidateLineage).toContainEqual({
        channel: 'session_start',
        reason: 'budget-truncate',
        charsApplied: 100,
      });
      expect(result.addition.length).toBe(100);
    } finally {
      setTurnInjectionBudgetConfig({ totalChars: undefined, dropAlertRatio: undefined });
    }
  });
  it('is cut by the context-enhancement kill switch', async () => {
    const result = await runTurn({
      turnId: 'wiring-kill-switch',
      cfg: {
        runtime: {
          contextEnhancement: { killSwitch: true },
          contextBlock: { sessionStartInjection: { enabled: true } },
        },
      },
      sessionStart: request(),
    });
    expect(result.addition).toBe('');
    expect(result.orchestratorLineage?.killSwitchEngaged).toBe(true);
    expect(result.orchestratorLineage?.sessionStartSkipReason).toBe('kill-switch');
    expect(result.candidateLineage).toContainEqual({
      channel: 'session_start',
      reason: 'kill-switch',
      charsApplied: 0,
    });
    expect(result.accounting?.charsApplied ?? 0).toBe(0);
  });
});