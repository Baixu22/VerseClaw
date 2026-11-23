import { describe, expect, it } from 'vitest';
import { compactModelName, describeModelRef, resolveModelBrand } from '@/lib/model-brand';

describe('composer model identity', () => {
  it.each([
    ['openrouter/deepseek/deepseek-r1', 'deepseek'],
    ['custom-account/x-ai/grok-4-fast-reasoning', 'grok'],
    ['openrouter/anthropic/claude-sonnet-4', 'claude'],
    ['custom-test/gemini-2.5-pro', 'gemini'],
    ['openrouter/qwen/qwen3-coder-480b', 'qwen'],
    ['ollama-1234abcd/default', 'ollama'],
    ['custom-1234abcd/default', null],
  ])('resolves %s by model family before provider', (ref, brand) => {
    expect(resolveModelBrand(ref)).toBe(brand);
  });

  it('preserves a complete long model name and its routing namespace', () => {
    const name = 'qwen3-coder-480b-a35b-instruct-long-context-preview:free';
    expect(describeModelRef(`openrouter/qwen/${name}`)).toEqual({ name, source: 'OpenRouter · qwen' });
  });

  it('uses short composer labels while retaining full model identities', () => {
    const full = 'openrouter/qwen/qwen3-coder-480b-a35b-instruct-long-context-preview:free';
    const display = describeModelRef(full);
    expect(compactModelName(display.name)).toBe('qwen3-coder-480b-a35b-i…');
    expect(Array.from(compactModelName(display.name))).toHaveLength(24);
    expect(describeModelRef(full)).toEqual(display);
    expect(compactModelName('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(compactModelName('claude-opus-4-5-20251101')).toBe('Opus 4.5');
    expect(compactModelName('gpt-6.1-sol')).toBe('GPT-6.1-sol');
    expect(compactModelName('deepseek-v4.1-flash')).toBe('DeepSeek v4.1-flash');
  });
});
