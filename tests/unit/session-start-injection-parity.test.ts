// @vitest-environment node
/**
 * A2b parity gate: flag-off must be byte-identical to the feature not existing.
 *
 * The test is built so it can fail in the right way: the same fixture, with the
 * flag on, really does change the prompt (asserted first). If the wiring ever
 * ignored the flag, the parity assertions below would break.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  computeContextExtraSystemPrompt,
  endContextOrchestratorTurn,
  finalizeContextOrchestratorTurn,
  getContextOrchestratorCollection,
  resetContextOrchestratorLineageForTests,
} from '../../openclaw_runtime/src/context-engine/context-orchestrator';
import { resetContextCandidateCollectionsForTests } from '../../openclaw_runtime/src/context-engine/context-candidate';
import { endTurnInjectionBudget } from '../../openclaw_runtime/src/context-engine/turn-injection-budget';
import {
  SESSION_START_INJECTION_REQUEST_SCHEMA,
  type SessionStartInjectionRequest,
} from '../../shared/types/session-start-injection';

const BASE_PROMPT = 'BASE SYSTEM PROMPT';
const PRELUDE = `[Startup context loaded by runtime]\n${'daily-note '.repeat(240)}`;

const OFF_CFG = { runtime: { contextBlock: { sessionStartInjection: { enabled: false } } } };
const ON_CFG = { runtime: { contextBlock: { sessionStartInjection: { enabled: true } } } };

function request(): SessionStartInjectionRequest {
  return {
    schema: SESSION_START_INJECTION_REQUEST_SCHEMA,
    sessionKey: 'agent:main:main',
    stage: 'fresh',
    facts: [
      { sourceId: 'startup-memory', available: true, chars: PRELUDE.length },
      { sourceId: 'continuity-pack', available: false, chars: 0 },
      { sourceId: 'handoff-draft', available: false, chars: 0 },
      { sourceId: 'fork-inheritance', available: false, chars: 0 },
    ],
    texts: { 'startup-memory': PRELUDE },
  };
}

type TurnResult = {
  systemPrompt: string;
  messages: unknown;
  charsApplied: number;
  sessionStartReasons: string[];
};

async function runTurn(params: {
  turnId: string;
  cfg: unknown;
  sessionStart?: SessionStartInjectionRequest;
}): Promise<TurnResult> {
  const { extraSystemPrompt } = await computeContextExtraSystemPrompt(
    BASE_PROMPT,
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
  const sessionStartReasons = (getContextOrchestratorCollection(params.turnId)?.lineage ?? [])
    .filter((entry) => entry.channel === 'session_start')
    .map((entry) => entry.reason);
  const extra = extraSystemPrompt ?? '';
  const addition = finalized.projection.systemPromptAddition;
  const systemPrompt = addition ? `${extra}\n\n${addition}` : extra;
  const accounting = endTurnInjectionBudget(params.turnId);
  endContextOrchestratorTurn(params.turnId);
  return {
    systemPrompt,
    messages: finalized.projection.messages,
    charsApplied: accounting?.charsApplied ?? 0,
    sessionStartReasons,
  };
}

beforeEach(() => {
  resetContextCandidateCollectionsForTests();
  resetContextOrchestratorLineageForTests();
});

describe('session-start injection — flag-off parity', () => {
  it('proves the fixture would change the prompt when the flag is on', async () => {
    const on = await runTurn({ turnId: 'parity-on', cfg: ON_CFG, sessionStart: request() });
    expect(on.systemPrompt).not.toBe(BASE_PROMPT);
    expect(on.systemPrompt).toContain('[Startup context loaded by runtime]');
    expect(on.charsApplied).toBeGreaterThan(0);
  });

  it('keeps the prompt byte-identical when the flag is off', async () => {
    const absent = await runTurn({ turnId: 'parity-absent', cfg: OFF_CFG });
    const off = await runTurn({ turnId: 'parity-off', cfg: OFF_CFG, sessionStart: request() });
    expect(off.systemPrompt).toBe(absent.systemPrompt);
    expect(off.systemPrompt).toBe(BASE_PROMPT);
    expect(off.messages).toEqual(absent.messages);
    expect(off.charsApplied).toBe(0);
    expect(absent.charsApplied).toBe(0);
  });

  it('keeps the prompt byte-identical when the default config says nothing', async () => {
    const absent = await runTurn({ turnId: 'default-absent', cfg: {} });
    const off = await runTurn({ turnId: 'default-present', cfg: {}, sessionStart: request() });
    expect(off.systemPrompt).toBe(absent.systemPrompt);
    expect(off.charsApplied).toBe(0);
  });

  it('records why nothing was injected instead of staying silent', async () => {
    const off = await runTurn({ turnId: 'parity-reason', cfg: OFF_CFG, sessionStart: request() });
    expect(off.sessionStartReasons).toEqual(['flag-off']);
    expect(off.systemPrompt).not.toContain('[Startup context loaded by runtime]');
  });
});