// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { providerAccountToConfig, providerConfigToAccount } from '@electron/services/providers/provider-store';
import type { ProviderConfig } from '@electron/shared/providers/types';

describe('provider account capability persistence', () => {
  it('preserves declared model capabilities and request auth through the legacy account adapter', () => {
    const config: ProviderConfig = { id: 'scripted-model', name: 'Scripted model', type: 'custom', enabled: true,
      model: 'model', createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z',
      modelProfile: { supportsReasoning: true, supportsVision: false, contextWindow: 128000, maxTokens: 4096 },
      requestAuth: { mode: 'bearer' },
    };
    const account = providerConfigToAccount(config);
    expect(account.modelProfile).toEqual(config.modelProfile);
    const restored = providerAccountToConfig(account);
    expect(restored.modelProfile).toEqual(config.modelProfile);
    expect(restored.requestAuth).toEqual(config.requestAuth);
    expect(restored.modelProfile).not.toBe(account.modelProfile);
  });
});
