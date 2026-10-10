// @vitest-environment node
/**
 * Companion to issue #130: removing `--token` from the Gateway launch args is
 * only safe because the runtime treats `OPENCLAW_GATEWAY_TOKEN` as a first-class
 * token-auth source. These tests pin that, so a future edit cannot make the
 * env-only launch path silently unauthenticated.
 */
import { describe, expect, it } from 'vitest';
import { resolveGatewayAuth } from '../../openclaw_runtime/src/gateway/auth-resolve';
import { ensureGatewayStartupAuth } from '../../openclaw_runtime/src/gateway/startup-auth';

const ENV_TOKEN = 'synthetic-env-only-gateway-token-7b31';

describe('env-only gateway token auth (#130)', () => {
  it('resolves token mode from the environment when no config token exists', () => {
    const auth = resolveGatewayAuth({ authConfig: {}, env: { OPENCLAW_GATEWAY_TOKEN: ENV_TOKEN } });

    expect(auth.mode).toBe('token');
    expect(auth.token).toBe(ENV_TOKEN);
    expect(auth.modeSource).toBe('token');
  });

  it('keeps token mode when config declares mode=token without a token value', () => {
    const auth = resolveGatewayAuth({
      authConfig: { mode: 'token' },
      env: { OPENCLAW_GATEWAY_TOKEN: ENV_TOKEN },
    });

    expect(auth.mode).toBe('token');
    expect(auth.token).toBe(ENV_TOKEN);
    expect(auth.modeSource).toBe('config');
  });

  it('does not mint a replacement token when the env token satisfies startup auth', async () => {
    const result = await ensureGatewayStartupAuth({
      cfg: {},
      env: { OPENCLAW_GATEWAY_TOKEN: ENV_TOKEN },
    });

    expect(result.auth.mode).toBe('token');
    expect(result.auth.token).toBe(ENV_TOKEN);
    expect(result.generatedToken).toBeUndefined();
    expect(result.persistedGeneratedToken).toBe(false);
    expect(result.cfg.gateway?.auth?.token).toBeUndefined();
  });

  it('still lets a config token win over the environment (precedence unchanged)', async () => {
    const result = await ensureGatewayStartupAuth({
      cfg: { gateway: { auth: { mode: 'token', token: 'config-token-value' } } },
      env: { OPENCLAW_GATEWAY_TOKEN: ENV_TOKEN },
    });

    expect(result.auth.mode).toBe('token');
    expect(result.auth.token).toBe('config-token-value');
    expect(result.generatedToken).toBeUndefined();
  });
});
