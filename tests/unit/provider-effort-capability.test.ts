// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  resolveProviderEffortCapability,
  resolveProviderReasoningEffort,
} from '../../openclaw_runtime/src/agents/provider-effort-capability';

describe('provider reasoning effort capability matrix', () => {
  it('uses the documented OpenAI effort vocabulary', () => {
    const capability = resolveProviderEffortCapability('openai');
    expect(capability.acceptedEfforts).toEqual([
      'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ]);
    expect(resolveProviderReasoningEffort({ provider: 'openai', requested: 'medium' })).toEqual({
      requested: 'medium',
      effective: 'medium',
      accepted: true,
      remapped: false,
    });
  });

  it('uses the documented Anthropic vocabulary without minimal', () => {
    const capability = resolveProviderEffortCapability('anthropic');
    expect(capability.acceptedEfforts).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(resolveProviderReasoningEffort({ provider: 'anthropic', requested: 'minimal' })).toEqual({
      requested: 'minimal',
      effective: 'low',
      accepted: false,
      remapped: true,
    });
  });

  it('uses the documented DeepSeek alias mapping', () => {
    expect(resolveProviderReasoningEffort({ provider: 'deepseek', requested: 'minimal' })).toEqual({
      requested: 'minimal',
      effective: 'low',
      accepted: true,
      remapped: true,
    });
    expect(resolveProviderReasoningEffort({ provider: 'deepseek', requested: 'low' })).toEqual({
      requested: 'low',
      effective: 'low',
      accepted: true,
      remapped: false,
    });
    expect(resolveProviderReasoningEffort({ provider: 'deepseek', requested: 'medium' })).toEqual({
      requested: 'medium',
      effective: 'high',
      accepted: true,
      remapped: true,
    });
    expect(resolveProviderReasoningEffort({ provider: 'deepseek', requested: 'xhigh' })).toEqual({
      requested: 'xhigh',
      effective: 'high',
      accepted: true,
      remapped: true,
    });
    expect(resolveProviderReasoningEffort({ provider: 'deepseek', requested: 'max' })).toEqual({
      requested: 'max',
      effective: 'max',
      accepted: true,
      remapped: false,
    });
  });

  it('falls back to an identity mapping for unknown providers', () => {
    expect(resolveProviderReasoningEffort({ provider: 'custom', requested: 'medium' })).toEqual({
      requested: 'medium',
      effective: 'medium',
      accepted: true,
      remapped: false,
    });
  });

  it('normalizes provider casing and blank values', () => {
    expect(resolveProviderEffortCapability(' DeepSeek ').provider).toBe('deepseek');
    expect(resolveProviderReasoningEffort({ provider: undefined, requested: 'low' })).toMatchObject({
      requested: 'low',
      effective: 'low',
    });
  });
});
