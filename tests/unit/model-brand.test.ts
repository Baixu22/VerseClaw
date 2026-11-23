import { describe, expect, it } from 'vitest';
import { describeModelRef, resolveModelBrand } from '@/lib/model-brand';

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
});
