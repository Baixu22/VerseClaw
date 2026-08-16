// @vitest-environment node
// PCS-v1.2 W5 core: source catalog, assembly ledger, and route matrix.

import { describe, expect, it } from 'vitest';
import {
  assertPromptSourceCatalogHealthy,
  getPromptSourceCatalogEntry,
  RUNTIME_INTENSITY_HARNESS_BEHAVIOR_SOURCE,
  RUNTIME_INTENSITY_PROMPT_SOURCE,
  validatePromptSourceCatalog,
} from '../../openclaw_runtime/src/agents/prompt-governance/prompt-source-catalog';
import {
  clearPromptAssemblyLedgerForTests,
  recordRuntimeIntensityLedgerEntries,
  validatePromptAssemblyLedger,
} from '../../openclaw_runtime/src/agents/prompt-governance/prompt-assembly-ledger';
import {
  buildPromptAssemblyMatrix,
  validatePromptAssemblyMatrix,
} from '../../openclaw_runtime/src/agents/prompt-governance/prompt-assembly-matrix';
import { resolveRuntimeIntensityPolicy } from '../../openclaw_runtime/src/agents/intensity-policy';

describe('PromptSourceCatalog', () => {
  it('registers the runtime intensity prompt with a 400-char budget and no reducer', () => {
    const entry = getPromptSourceCatalogEntry(RUNTIME_INTENSITY_PROMPT_SOURCE);
    expect(entry).toMatchObject({
      owner: 'intensity-policy.ts',
      layer: 'L4-dynamic',
      cachePlacement: 'dynamic',
      budgetChars: 400,
      reducer: 'none',
    });
    expect(entry?.enforcementRefs).toContain('openclaw_runtime/src/agents/intensity-policy.ts');
  });

  it('registers harness behavior as a chars=0 runtime policy', () => {
    const entry = getPromptSourceCatalogEntry(RUNTIME_INTENSITY_HARNESS_BEHAVIOR_SOURCE);
    expect(entry).toMatchObject({
      kind: 'runtime-policy',
      budgetChars: 0,
      cachePlacement: 'none',
    });
  });

  it('passes the fail-closed catalog guard', () => {
    expect(validatePromptSourceCatalog()).toEqual([]);
    expect(() => assertPromptSourceCatalogHealthy()).not.toThrow();
  });
});

describe('PromptAssemblyLedger', () => {
  it('records intensity prompt/mode/behavior entries without storing raw prompt text', () => {
    clearPromptAssemblyLedgerForTests();
    const policy = resolveRuntimeIntensityPolicy({ thinkLevel: 'low' });

    recordRuntimeIntensityLedgerEntries({
      systemPrompt: 'raw system prompt that must not be persisted',
      promptMode: 'minimal',
      policy,
      requestedReasoning: 'low',
      effectiveReasoning: 'low',
      requestedIntensity: 'low',
      effectiveIntensity: 'low',
      intensitySource: 'explicit',
      policyAdherence: 'full',
    });

    const result = validatePromptAssemblyLedger();
    expect(result.unregisteredContributions).toEqual([]);
    expect(result.entries.map((entry) => entry.kind)).toEqual([
      'prompt-text',
      'prompt-mode-mutation',
      'behavior-policy',
    ]);
    expect(JSON.stringify(result)).not.toContain('raw system prompt');
  });

  it('rejects intensity prompt text over the catalog budget', () => {
    clearPromptAssemblyLedgerForTests();
    const policy = resolveRuntimeIntensityPolicy({ thinkLevel: 'low' });
    expect(() =>
      recordRuntimeIntensityLedgerEntries({
        systemPrompt: 'x',
        promptMode: 'full',
        policy: {
          ...policy,
          systemPromptLines: ['x'.repeat(401)],
        },
      }),
    ).toThrow('over budget');
  });
});

describe('PromptAssemblyMatrix', () => {
  it('covers deepseek alias routes and keeps intensity stable', () => {
    const matrix = buildPromptAssemblyMatrix();
    const deepseekCases = matrix.cases.filter((item) => item.provider === 'deepseek');
    expect(deepseekCases.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('deepseek:medium->high:R1-builtin'),
        expect.stringContaining('deepseek:xhigh->high:R1-builtin'),
        expect.stringContaining('deepseek:max->max:R1-builtin'),
      ]),
    );
    expect(validatePromptAssemblyMatrix(matrix)).toEqual([]);
  });

  it('keeps prompt-only adherence for CLI and plugin routes', () => {
    const matrix = buildPromptAssemblyMatrix();
    for (const item of matrix.cases) {
      if (item.route === 'R2-cli' || item.route === 'R3-plugin') {
        expect(item.adherence).toBe('prompt-only');
      }
    }
  });
});
