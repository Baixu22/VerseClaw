import { describe, expect, it } from 'vitest';
import { LegacyContextEngine } from '../../openclaw_runtime/src/context-engine/legacy';
import {
  buildLoopContextPack,
  formatLoopContextPackForPrompt,
} from '../../openclaw_runtime/src/agents/loop-context-pack';
import { isContextItem } from '../../openclaw_runtime/src/runtime-core';

describe('context shadow adapters', () => {
  it('keeps LoopContextPack shape unchanged when the shadow flag is off', () => {
    const input = {
      systemAppRules: ['System rule'],
      projectRules: ['Project rule'],
      initialConstraints: ['Initial constraint'],
      taskLedgerState: ['Task ledger state'],
    };

    const baseline = buildLoopContextPack(input as never);
    const flagOff = buildLoopContextPack({
      ...input,
      runtime: { contextProviders: { loopPackShadow: false } },
    });

    expect(flagOff).toEqual(baseline);
    expect(flagOff.contextItems).toBeUndefined();
  });

  it('emits LoopContextPack ContextItem shadows without changing prompt text', () => {
    const input = {
      systemAppRules: ['System rule'],
      relevantKnowledge: ['knowledge '.repeat(200)],
      budget: {
        totalTokens: 30,
        sectionTokens: { relevantKnowledge: 5 },
      },
    };
    const baseline = buildLoopContextPack(input as never);
    const shadow = buildLoopContextPack({
      ...input,
      runtime: { contextProviders: { loopPackShadow: true } },
    } as never);

    expect(formatLoopContextPackForPrompt(shadow)).toBe(formatLoopContextPackForPrompt(baseline));
    expect(shadow.contextItems?.every(isContextItem)).toBe(true);
    expect(shadow.contextItems?.[0]).toMatchObject({
      id: 'loop_context_pack:systemAppRules:systemAppRules:1',
      kind: 'instruction',
      source: 'system_app_rules',
      metadata: {
        sourceId: 'systemAppRules:systemAppRules:1',
        sourceKind: 'systemAppRules',
        tokenEstimate: 3,
        truncated: false,
        omitted: false,
      },
    });
    expect(shadow.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceKind: 'relevantKnowledge',
          truncated: true,
          omitted: true,
        }),
      }),
    ]));
  });

  it('emits LegacyContextEngine message ContextItem shadows without changing messages', async () => {
    const messages = [
      { role: 'user', content: 'Implement the feature.' },
      { role: 'assistant', content: 'Done with tests.' },
    ] as never;
    const flagOff = await new LegacyContextEngine().assemble({
      sessionId: 'session_1',
      messages,
    });
    const flagOn = await new LegacyContextEngine({
      runtime: { contextProviders: { shadow: true } },
    }).assemble({
      sessionId: 'session_1',
      messages,
    });

    expect(flagOff).toEqual({ messages, estimatedTokens: 0 });
    expect(flagOn.messages).toBe(messages);
    expect(flagOn.contextItems?.every(isContextItem)).toBe(true);
    expect(flagOn.contextItems?.[0]).toMatchObject({
      id: 'legacy_context_engine:message:1',
      kind: 'message',
      source: 'legacy_context_engine',
      text: 'Implement the feature.',
      metadata: {
        sourceId: 'legacy_context_engine:message:1',
        sourceKind: 'message',
        role: 'user',
        tokenEstimate: 6,
        truncated: false,
      },
    });
  });
});

