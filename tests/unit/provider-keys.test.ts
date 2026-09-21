import { describe, expect, it } from 'vitest';
import {
  OPENAI_CODEX_RUNTIME_PROVIDER_KEY,
  buildMultiInstanceProviderApiKeySecretRef,
  filterActiveProviderKeysForUi,
  getMultiInstanceProviderApiKeyEnvVar,
  getOpenClawProviderKeyForType,
  isMultiInstanceProviderType,
  isOpenClawOAuthPluginProviderKey,
  resolveOpenClawProviderKey,
} from '@electron/utils/provider-keys';

describe('provider-keys', () => {
  it('maps OpenAI browser OAuth accounts to the openai-codex runtime key', () => {
    expect(resolveOpenClawProviderKey({
      vendorId: 'openai',
      id: 'openai-personal',
      authMode: 'oauth_browser',
    })).toBe(OPENAI_CODEX_RUNTIME_PROVIDER_KEY);

    expect(resolveOpenClawProviderKey({
      vendorId: 'openai',
      id: 'openai-personal',
      authMode: 'api_key',
    })).toBe('openai');
  });

  it('keeps custom multi-instance hashing behavior', () => {
    expect(getOpenClawProviderKeyForType('custom', 'my-local')).toBe('custom-mylocal');
  });

  it('treats openai-codex as an OAuth plugin provider key', () => {
    expect(isOpenClawOAuthPluginProviderKey('openai-codex')).toBe(true);
  });

  it('drops bare openai from the UI list when only openai-codex OAuth is active', () => {
    expect(filterActiveProviderKeysForUi(['openai', 'openai-codex', 'anthropic'])).toEqual([
      'openai-codex',
      'anthropic',
    ]);
  });

  it('keeps openai in the UI list when an API key is configured alongside Codex OAuth', () => {
    expect(filterActiveProviderKeysForUi(['openai', 'openai-codex'], {
      hasConfiguredOpenAiApiKey: true,
    })).toEqual(['openai', 'openai-codex']);
  });

  it('derives a runtime-resolvable env SecretRef for custom and ollama runtime keys', () => {
    expect(isMultiInstanceProviderType('custom')).toBe(true);
    expect(isMultiInstanceProviderType('openai')).toBe(false);
    expect(getMultiInstanceProviderApiKeyEnvVar('custom-senseaud')).toBe('CUSTOM_SENSEAUD_API_KEY');
    expect(getMultiInstanceProviderApiKeyEnvVar('ollama-ollamafd')).toBe('OLLAMA_OLLAMAFD_API_KEY');
    expect(buildMultiInstanceProviderApiKeySecretRef('custom-senseaud')).toEqual({
      source: 'env',
      provider: 'default',
      id: 'CUSTOM_SENSEAUD_API_KEY',
    });
    expect(buildMultiInstanceProviderApiKeySecretRef('custom-senseaud').id).toMatch(/^[A-Z][A-Z0-9_]{0,127}$/);
  });
});
