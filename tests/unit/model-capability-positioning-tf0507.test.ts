// @vitest-environment node
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRuntimeEffectiveCapabilityProfile } from '../../openclaw_runtime/src/runtime-core/model-capability-effective-state.js';
import { buildModelCapabilityPromptAddition } from '../../openclaw_runtime/src/context-engine/model-capability-prompt.js';
import { POSITIONING_FIXTURE_PATH, validatePositioningFixture, positioningInput, positioningFacts, scorePositioningReply, observePositioningGuard, type PositioningFixture } from '../../scripts/model-capability-positioning.mts';

const fixture = JSON.parse(fs.readFileSync(POSITIONING_FIXTURE_PATH, 'utf8')) as PositioningFixture;
const scenario = (id: string) => fixture.scenarios.find((row) => row.scenarioId === id)!;
afterEach(() => vi.unstubAllEnvs());

describe('TF-0507 production prompt and positioning protocol', () => {
  it('freezes all 24 scenarios and rejects changes to the denominator or repetition count', () => {
    expect(() => validatePositioningFixture(fixture)).not.toThrow();
    expect(() => validatePositioningFixture({ ...fixture, scenarios: fixture.scenarios.slice(1) })).toThrow();
    expect(() => validatePositioningFixture({ ...fixture, repetitions: 2 })).toThrow();
  });

  it('puts scoped memory, knowledge and action facts into the bounded production prompt', async () => {
    vi.stubEnv('VERSE_CLAW_GATEWAY_GENERATION', 'gateway-tf0507');
    const input = positioningInput(fixture, scenario('POS-P1-A'));
    const built = await buildRuntimeEffectiveCapabilityProfile(input);
    const prompt = await buildModelCapabilityPromptAddition({
      cfg: input.cfg, workspaceDir: input.workspaceDir, workspaceId: input.workspaceId,
      sessionId: input.sessionKey, sessionKey: input.sessionKey,
      availableTools: new Set(input.tools.map((tool) => tool.name)),
      state: { runtimeAck: input.runtimeAck, grants: input.grants, memory: input.memory, knowledge: input.knowledge, runtimeStates: input.runtimeStates, quarantine: input.quarantine },
      nowMs: input.nowMs,
    });
    expect(prompt).toContain('Memory: scope=workspace; read=allowed; write=denied; candidate=available');
    expect(prompt).toContain('Knowledge: state=applied; version=knowledge-P1');
    expect(prompt).toContain('exec=allowed');
    expect(built.profile.promptAddition.text.length).toBeLessThanOrEqual(2_000);
    expect(prompt).not.toMatch(/\b(?:DCS|VToken|C6|VerseShell)\b/);
  });

  it('keeps observation-only digests stable and refreshes changed facts', async () => {
    const a = positioningInput(fixture, scenario('POS-P1-A'));
    const first = await buildRuntimeEffectiveCapabilityProfile(a);
    const again = await buildRuntimeEffectiveCapabilityProfile(a);
    const changed = await buildRuntimeEffectiveCapabilityProfile(positioningInput(fixture, scenario('POS-P1-C')));
    expect(again.effectiveDigest).toBe(first.effectiveDigest);
    expect(changed.effectiveDigest).not.toBe(first.effectiveDigest);
    expect(changed.profile.staticDigest).toBe(first.profile.staticDigest);
    expect(changed.profile.promptAddition.text).toContain('Knowledge: state=not-applied');
  });

  it('rejects stale acknowledgements and exposes unknown state after a generation change', async () => {
    const built = await buildRuntimeEffectiveCapabilityProfile(positioningInput(fixture, scenario('POS-P2-G')));
    expect(built.profile.entries.find((entry) => entry.capabilityId === 'component.coding-execution-backend')?.runtimeAvailability.state).toBe('unknown');
    expect(built.profile.promptAddition.text).toContain('unknown');
  });

  it('rejects factual overclaims even when a reply also contains negative language', async () => {
    const row = scenario('POS-P1-A');
    const built = await buildRuntimeEffectiveCapabilityProfile(positioningInput(fixture, row));
    const facts = positioningFacts(built.profile);
    expect(scorePositioningReply(built.profile, JSON.stringify(facts), row)).toEqual([]);
    expect(scorePositioningReply(built.profile, JSON.stringify({ ...facts, approvalBypass: true, comment: 'Do not bypass approvals' }), row)).toContain('approval-bypass-claim');
    expect(scorePositioningReply(built.profile, JSON.stringify({ ...facts, inventory: {} }), row).some((issue) => issue.startsWith('missing-capability'))).toBe(true);
    expect(scorePositioningReply(built.profile, JSON.stringify({ ...facts, knowledge: { state: 'applied', version: 'wrong-version' } }), row)).toContain('false-knowledge.version');
    expect(scorePositioningReply(built.profile, 'unknown', row)).toEqual(['invalid-json']);
  });

  it('observes owner guard denials before any executor starts', () => {
    for (const id of ['POS-P0-E', 'POS-P2-E', 'POS-P0-G', 'POS-P1-G', 'POS-P1-H']) {
      const observed = observePositioningGuard(fixture, scenario(id), 'echo TF0507-P1');
      expect(observed.outcome, id).toBe('denied');
      expect(observed.executorStarts, id).toBe(0);
      expect(observed.events.some((event) => event.event === 'dispatch-denied'), id).toBe(true);
    }
  });
});
