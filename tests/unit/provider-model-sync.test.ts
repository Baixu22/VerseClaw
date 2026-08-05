import { describe, expect, it } from 'vitest';
import { getOpenClawProviderKey, getProviderModelRef } from '@electron/services/providers/provider-runtime-sync';
import type { ProviderConfig } from '@electron/utils/secure-storage';

function providerConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'provider-id',
    name: 'Provider',
    type: 'moonshot',
    enabled: true,
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider model sync helpers', () => {
  it('uses stable runtime keys for built-in and multi-instance providers', () => {
    expect(getOpenClawProviderKey('moonshot', 'moonshot')).toBe('moonshot');
    expect(getOpenClawProviderKey('custom', 'custom-123')).toBe('custom-custom12');
    expect(getOpenClawProviderKey('ollama', 'ollama')).toBe('ollama-ollama');
    expect(getOpenClawProviderKey('minimax-portal-cn', 'minimax-cn')).toBe('minimax-portal');
  });

  it('normalizes explicit model IDs into runtime model refs', () => {
    expect(getProviderModelRef(providerConfig({
      type: 'moonshot',
      id: 'moonshot',
      model: 'kimi-k2.6',
    }))).toBe('moonshot/kimi-k2.6');
    expect(getProviderModelRef(providerConfig({
      type: 'moonshot',
      id: 'moonshot',
      model: 'moonshot/kimi-k2.6',
    }))).toBe('moonshot/kimi-k2.6');
  });

  it('keeps multi-instance models scoped to their derived runtime key', () => {
    expect(getProviderModelRef(providerConfig({
      type: 'custom',
      id: 'custom-123',
      model: 'model-v1',
    }))).toBe('custom-custom12/model-v1');
  });

  it('falls back to the current registered default model', () => {
    expect(getProviderModelRef(providerConfig({
      type: 'modelstudio',
      id: 'modelstudio',
      model: undefined,
    }))).toBe('modelstudio/qwen3.6-plus');
  });
});
