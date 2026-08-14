// R4: 验证器与 runtime 必须共用同一份认证解析结果(同源断言)。
// Electron 保存时的验证探针(electron/services/providers/provider-validation.ts)与
// 真实请求的 runtime 解析(openclaw_runtime/src/agents/provider-request-auth.ts)
// 必须产出逐字节相同的认证 header/query——禁止"验证通过但真实请求用另一套格式"。
import { describe, expect, it } from 'vitest';
import {
  appendProviderRequestAuthQuery,
  providerRequestAuthHeaders,
  providerRequestAuthQuery,
  resolveProviderRequestAuth,
} from '@openclaw/provider-request-auth';
import {
  applyProviderValidationAuthQuery,
  buildProviderValidationAuth,
} from '@electron/services/providers/provider-validation';

const cases = [
  {
    label: 'bearer',
    auth: { mode: 'bearer' as const },
    apiKey: 'sk-test-bearer',
  },
  {
    label: 'custom-header with prefix',
    auth: { mode: 'custom-header' as const, headerName: 'X-API-Key', prefix: 'ApiKey ' },
    apiKey: 'k1',
  },
  {
    label: 'custom-header bare',
    auth: { mode: 'custom-header' as const, headerName: 'X-Tenant-Key' },
    apiKey: 'k2',
  },
  {
    label: 'query',
    auth: { mode: 'query' as const, parameterName: 'key' },
    apiKey: 'k3?&',
  },
];

describe('validator and runtime share one auth resolution source', () => {
  for (const entry of cases) {
    it(`produces identical outbound auth for ${entry.label}`, () => {
      const validatorAuth = buildProviderValidationAuth(entry.auth, entry.apiKey);
      const runtimeResolved = resolveProviderRequestAuth({
        auth:
          entry.auth.mode === 'bearer'
            ? { mode: 'authorization-bearer', token: entry.apiKey }
            : entry.auth.mode === 'custom-header'
              ? {
                  mode: 'header',
                  headerName: entry.auth.headerName,
                  value: entry.apiKey,
                  prefix: entry.auth.prefix,
                }
              : { mode: 'query', parameterName: entry.auth.parameterName, value: entry.apiKey },
      });

      // 逐字段断言:验证器产出的 header/query 与 runtime 共享解析器的输出完全一致。
      expect(validatorAuth.headers ?? undefined).toEqual(providerRequestAuthHeaders(runtimeResolved));
      expect(validatorAuth.query ?? undefined).toEqual(providerRequestAuthQuery(runtimeResolved));
    });
  }

  it('applies the same URL query appending for query auth', () => {
    const auth = { mode: 'query' as const, parameterName: 'key' };
    const apiKey = 'sk q?&';
    const base = 'https://example.com/v1/models?page=1';
    const runtimeResolved = resolveProviderRequestAuth({
      auth: { mode: 'query', parameterName: 'key', value: apiKey },
    });
    expect(applyProviderValidationAuthQuery(base, auth, apiKey)).toBe(
      appendProviderRequestAuthQuery(base, runtimeResolved),
    );
  });

  it('keeps "none" free of any auth header or query (no bearer fallback)', () => {
    const validatorAuth = buildProviderValidationAuth({ mode: 'none' }, 'sk-none');
    expect(validatorAuth.headers).toEqual({});
    expect(validatorAuth.query).toBeUndefined();
    expect(
      applyProviderValidationAuthQuery('https://example.com/v1/models', { mode: 'none' }, 'sk-none'),
    ).toBe('https://example.com/v1/models');
  });
});
