import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../openclaw_runtime/src/agents/runtime';
import type { CvkCompilerFixtureInput } from '../../openclaw_runtime/src/context-engine/cvk/compiler';
import {
  CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
  createContextRuntimeKitShadowProvider,
  runContextRuntimeKitShadowPilot,
} from '../../openclaw_runtime/src/context-engine/cvk/shadow-provider';
import {
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeRegistryDiagnostic,
} from '../../openclaw_runtime/src/runtime-core/registries';

function loadFixture(): CvkCompilerFixtureInput {
  const fixturePath = join(process.cwd(), 'tests/fixtures/context-runtime-kit/compiler.fixture.json');
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as CvkCompilerFixtureInput;
}

const enabledConfig = {
  runtime: {
    contextRuntimeKit: { shadow: true },
  },
};

describe('Context Runtime Kit shadow provider', () => {
  it('keeps prompt messages byte-equivalent when the feature is off', async () => {
    const messages = [
      { role: 'user', content: 'Keep legacy prompt authoritative.' },
      { role: 'assistant', content: 'No CRK projection should be injected.' },
    ] as AgentMessage[];
    const baselinePromptText = messages.map((message) => message.content).join('\n');

    const result = await runContextRuntimeKitShadowPilot({
      config: {},
      legacyMessages: messages,
      legacyPromptText: baselinePromptText,
      fixtureInput: loadFixture(),
      tokenBudget: 80,
    });

    expect(result.enabled).toBe(false);
    expect(result.legacyMessages).toBe(messages);
    expect(result.legacyPromptText).toBe(baselinePromptText);
    expect(result.providerResult).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        status: 'skipped',
        reason: 'flag_disabled',
        metadata: expect.objectContaining({
          shadowOnly: true,
          legacyAuthoritative: true,
          promptTextUnchanged: true,
        }),
      }),
    ]);
  });

  it('emits shadow diagnostics without changing prompt messages', async () => {
    const messages = [
      { role: 'user', content: 'Produce CRK diagnostics only.' },
      { role: 'assistant', content: 'Legacy messages stay in place.' },
    ] as AgentMessage[];
    const provider = createContextRuntimeKitShadowProvider({ fixtureInput: loadFixture() });
    const result = await provider.getContext({
      taskId: 'shadow-test',
      tokenBudget: 120,
      metadata: { legacyMessages: messages as never },
    });

    expect(isRuntimeContextProviderManifest(provider.manifest)).toBe(true);
    expect(provider.manifest).toMatchObject({
      id: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
      shadowOnly: true,
      enabledByDefault: false,
    });
    expect(isRuntimeContextProviderResult(result)).toBe(true);
    if (!Array.isArray(result)) {
      expect(result.metadata).toMatchObject({
        shadowOnly: true,
        legacyAuthoritative: true,
      });
      expect(result.metadata?.resourceMap).toEqual(expect.arrayContaining([
        expect.objectContaining({ resourceId: 'toolset:local.shell@v1' }),
      ]));
      expect(result.metadata?.compactViews).toEqual(expect.arrayContaining([
        expect.objectContaining({ resourceId: 'toolset:local.shell@v1' }),
      ]));
      expect(result.metadata?.retrievalPlan).toEqual(expect.arrayContaining([
        expect.objectContaining({
          resourceId: 'toolset:local.shell@v1',
          selector: 'schema:tool.run_shell.required',
        }),
      ]));
      expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
      expect(result.diagnostics[0]?.metadata).toMatchObject({
        shadowOnly: true,
        legacyAuthoritative: true,
      });
    }
    expect(messages.map((message) => message.content)).toEqual([
      'Produce CRK diagnostics only.',
      'Legacy messages stay in place.',
    ]);
  });

  it('reports omitted resources and reasons in the shadow budget report', async () => {
    const result = await runContextRuntimeKitShadowPilot({
      config: enabledConfig,
      legacyMessages: [{ role: 'user', content: 'Budget diagnostics only.' }] as AgentMessage[],
      legacyPromptText: 'Budget diagnostics only.',
      fixtureInput: loadFixture(),
      tokenBudget: 1,
    });

    expect(result.enabled).toBe(true);
    expect(result.providerResult?.metadata?.budgetReport).toMatchObject({
      omittedResources: expect.arrayContaining([
        expect.objectContaining({
          resourceId: 'toolset:local.shell@v1',
          reason: 'budget_exceeded',
        }),
      ]),
    });
  });

  it('isolates provider failure without changing legacy execution', async () => {
    const messages = [{ role: 'user', content: 'Provider may fail.' }] as AgentMessage[];
    const result = await runContextRuntimeKitShadowPilot({
      config: enabledConfig,
      legacyMessages: messages,
      legacyPromptText: 'Provider may fail.',
      fixtureInput: loadFixture(),
      artifactFactory: () => {
        throw new Error('fixture compiler unavailable');
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.legacyMessages).toBe(messages);
    expect(result.legacyPromptText).toBe('Provider may fail.');
    expect(result.providerResult?.status).toBe('fallback');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        providerId: CONTEXT_RUNTIME_KIT_SHADOW_PROVIDER_ID,
        status: 'fallback',
        reason: 'provider_error',
        metadata: expect.objectContaining({
          legacyAuthoritative: true,
          shadowOnly: true,
          promptTextUnchanged: true,
        }),
      }),
    ]);
  });
});
