// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  isDangerousHostInheritedEnvVarName,
  sanitizeHostExecEnvWithDiagnostics,
} from '../../openclaw_runtime/src/infra/host-env-security';

const SECRET_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'CUSTOM_AUDIT_API_KEY',
  'OPENCLAW_GATEWAY_TOKEN',
  'GITHUB_TOKEN',
] as const;

describe('host exec environment credential boundary (#126)', () => {
  it('classifies provider, custom-provider and gateway credentials as inherited secrets', () => {
    for (const key of SECRET_KEYS) {
      expect(isDangerousHostInheritedEnvVarName(key), key).toBe(true);
    }
    expect(isDangerousHostInheritedEnvVarName('PATH')).toBe(false);
    expect(isDangerousHostInheritedEnvVarName('SystemRoot')).toBe(false);
  });

  it('removes application credentials from inherited child and override environments', () => {
    const baseEnv: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      APPDATA: process.env.APPDATA ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      PATHEXT: process.env.PATHEXT ?? '',
      SAFE_VALUE: 'visible',
    };
    for (const key of SECRET_KEYS) baseEnv[key] = 'SYNTHETIC_NOT_A_CREDENTIAL_108';

    const inherited = sanitizeHostExecEnvWithDiagnostics({ baseEnv });
    for (const key of SECRET_KEYS) expect(inherited.env, key).not.toHaveProperty(key);
    expect(inherited.env.SAFE_VALUE).toBe('visible');

    const overridden = sanitizeHostExecEnvWithDiagnostics({
      baseEnv: {},
      overrides: { OPENAI_API_KEY: 'SYNTHETIC', OPENCLAW_GATEWAY_TOKEN: 'SYNTHETIC', SAFE_VALUE: 'ok' },
    });
    expect(overridden.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(overridden.env).not.toHaveProperty('OPENCLAW_GATEWAY_TOKEN');
    expect(overridden.env.SAFE_VALUE).toBe('ok');
    expect(overridden.rejectedOverrideBlockedKeys).toEqual([
      'OPENAI_API_KEY',
      'OPENCLAW_GATEWAY_TOKEN',
    ]);
  });

  it('starts a real child with no synthetic credential visible', () => {
    const baseEnv: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      PATHEXT: process.env.PATHEXT ?? '',
    };
    for (const key of SECRET_KEYS) baseEnv[key] = 'SYNTHETIC_NOT_A_CREDENTIAL_108';
    const sanitized = sanitizeHostExecEnvWithDiagnostics({ baseEnv }).env;
    const script = `const keys=${JSON.stringify(SECRET_KEYS)}; process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key)=>[key, Object.prototype.hasOwnProperty.call(process.env,key)]))))`;
    const child = spawnSync(process.execPath, ['-e', script], {
      env: sanitized,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(Object.fromEntries(SECRET_KEYS.map((key) => [key, false])));
  });
});
