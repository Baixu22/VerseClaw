import { describe, expect, it } from 'vitest';
import { Config, hydrateReachConfig } from './config.js';

describe('readonly Reach config', () => {
  it('prefers hydrated plugin credentials over environment values', () => {
    const config = new Config({
      values: { xueqiu_cookie: 'plugin-cookie' },
      env: { XUEQIU_COOKIE: 'env-cookie' },
    });

    expect(config.get('xueqiu_cookie')).toBe('plugin-cookie');
  });

  it('hydrates SecretInput values once before environment fallback', async () => {
    const resolvedPaths: string[] = [];
    const snapshot = await hydrateReachConfig({
      config: {},
      pluginConfig: {
        browserFallback: 'handoff',
        credentials: {
          xueqiuCookie: { source: 'env', provider: 'default', id: 'XUEQIU_SECRET' },
        },
      },
      env: { XUEQIU_COOKIE: 'env-cookie' },
      resolveSecret: async ({ path }) => {
        resolvedPaths.push(path);
        return { value: 'resolved-cookie' };
      },
    });

    expect(snapshot.get('browser_fallback')).toBe('handoff');
    expect(snapshot.get('xueqiu_cookie')).toBe('resolved-cookie');
    expect(resolvedPaths).toEqual(['plugins.entries.reach-readers.config.credentials.xueqiuCookie']);
  });

  it('uses compatible environment variables and defaults', () => {
    const config = new Config({
      env: {
        TWITTER_AUTH_TOKEN: 'auth-from-env',
        TWITTER_CT0: 'ct0-from-env',
      },
    });

    expect(config.get('twitter_auth_token')).toBe('auth-from-env');
    expect(config.get('twitter_ct0')).toBe('ct0-from-env');
    expect(config.get('browser_fallback')).toBe('auto');
    expect(config.get('browser_profile')).toBe('default');
  });

  it('has no mutation API and reports only configured state', () => {
    const config = new Config({
      values: {
        twitter_auth_token: 'super-secret-auth-prefix',
        twitter_ct0: 'super-secret-ct0-prefix',
      },
    });

    expect('save' in config).toBe(false);
    expect('set' in config).toBe(false);
    expect('delete' in config).toBe(false);
    expect(config.isConfigured('twitter_xreach')).toBe(true);
    expect(config.toDict()).toEqual({
      twitter_auth_token: 'configured',
      twitter_ct0: 'configured',
    });
    expect(JSON.stringify(config.toDict())).not.toContain('super-secret');
  });
});
