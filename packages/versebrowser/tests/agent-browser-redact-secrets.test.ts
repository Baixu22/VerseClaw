import { describe, expect, it } from 'vitest';
import {
  redactSecretsInText,
  redactSecretsInValue,
  redactToolResultPayload,
  isSensitiveNetworkName,
  REDACTED,
} from '../src/security/redact-secrets.ts';

describe('m4-vault redactSecretsInText', () => {
  it('redacts password/token/api_key key-value pairs', () => {
    const input = 'login ok password=supersecret token: abc.def.ghi api_key="AKIA123"';
    const out = redactSecretsInText(input);
    expect(out).not.toContain('supersecret');
    expect(out).not.toContain('abc.def.ghi');
    expect(out).not.toContain('AKIA123');
    expect(out).toContain(REDACTED);
  });

  it('redacts Bearer/Basic headers and JWTs', () => {
    const out = redactSecretsInText(
      'Authorization: Bearer sk-live-abcdef123456\njwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwxyz012345',
    );
    expect(out).not.toContain('sk-live-abcdef123456');
    expect(out).toContain('[REDACTED_JWT]');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'navigated to https://example.test/path';
    expect(redactSecretsInText(text)).toBe(text);
  });

  it('treats the short aliases as name components, not raw substrings', () => {
    // C96/TF-0123: the shared predicate feeds the URL / console / network / audit key checks, and a
    // raw substring test redacted `?consider=...`, `?president=...` etc. (measured 2026-10-14).
    for (const name of ['consider', 'president', 'residue', 'pinto', 'inside', 'beside', 'opinion', 'siding', 'residency']) {
      expect(isSensitiveNetworkName(name), name).toBe(false);
    }
    // Component names still match, and a bare alias still matches.
    for (const name of ['session', 'sid', 'csrf', 'xsrf', 'otp', 'pin', 'x-session-id', 'csrf_token', '_csrf']) {
      expect(isSensitiveNetworkName(name), name).toBe(true);
    }
  });

  it('stays linear on a long delimiter-free token (no catastrophic backtracking)', () => {
    // C96/TF-0123: the quoted key/value rule used an unbounded `[\w.-]+` key group followed by
    // `\s*[:=]`, which backtracks at every start position on a single long token. Measured
    // 2026-10-14: 20,000 chars took 0.24 s and 80,000 took 4.3 s (quadratic); a 1.2 MB single-token
    // tool result hung the whole MCP envelope. The key group is now capped at 256 chars.
    for (const n of [20_000, 80_000]) {
      const long = 'z'.repeat(n);
      const started = Date.now();
      const out = redactSecretsInText(long);
      expect(out).toBe(long);
      expect(Date.now() - started, `n=${n}`).toBeLessThan(1500);
    }
    // Real key shapes are unaffected, including the ones the old rule already handled.
    expect(redactSecretsInText('password="hunter2"')).toBe('password="[REDACTED]"');
    expect(redactSecretsInText('{"api_key":"AKIA1"}')).toBe('{"api_key":"[REDACTED]"}');
    expect(redactSecretsInText('normal="keep me"')).toBe('normal="keep me"');
  });

  it('does not redact English words that merely contain a short alias', () => {
    // C96/TF-0123: the line-start rule used the substring alias check, so `sid`/`pin` inside
    // ordinary words redacted whole lines (measured 2026-10-14).
    for (const word of ['consider', 'president', 'residue', 'pinto', 'inside', 'beside', 'opinion']) {
      const line = `${word}: legitimate prose value`;
      expect(redactSecretsInText(line), word).toBe(line);
    }
    // A real credential name still fires, including compound names.
    expect(redactSecretsInText('sid: abc123')).toBe('sid: [REDACTED]');
    expect(redactSecretsInText('X-Api-Key: abc123')).toBe('X-Api-Key: [REDACTED]');
  });

  it('redacts the network-alias and field-family names the inline rules omitted', () => {
    // C96/TF-0123: the inline rules consulted SECRET_KEY_PATTERN only, so these kept their values
    // in every form (measured 2026-10-14) while token/api_key/private_key were redacted.
    for (const key of ['cookie', 'session', 'sid', 'csrf', 'xsrf', 'otp', 'pin', 'auth']) {
      expect(redactSecretsInText(`${key}=VALUE-${key}`), key).not.toContain(`VALUE-${key}`);
    }
    for (const key of ['session', 'sid', 'csrf', 'xsrf', 'otp', 'pin']) {
      const quoted = redactSecretsInText(`{"${key}": "VALUE-${key}"}`);
      expect(quoted, key).not.toContain(`VALUE-${key}`);
    }
    // A structured key: the aliases must match the whole name, so the documented non-secret
    // sessionId identifier keeps its value while a bare `session` is redacted.
    expect(redactSecretsInValue({ sessionId: 's-1' }).sessionId).toBe('s-1');
    expect(redactSecretsInValue({ session: 'abc', sid: 'abc', otp: '482915', pin: '7788' }))
      .toEqual({ session: REDACTED, sid: REDACTED, otp: REDACTED, pin: REDACTED });
    // Verdict booleans stay untouched.
    expect(redactSecretsInValue({ passed: false, bypass: true }).passed).toBe(false);
  });

  it('redacts session/CSRF/cookie URL query params via the canonical name list', () => {
    const sensitive = ['sid', 'session', 'csrf', 'xsrf', 'cookie', 'credential', 'private_key'];
    for (const name of sensitive) {
      const out = redactSecretsInText(`https://example.test/cb?${name}=leaked-value`);
      expect(out, name).not.toContain('leaked-value');
      expect(out, name).toContain(`${name}=***`);
    }
    const harmless = 'https://example.test/list?q=harmless&page=2';
    expect(redactSecretsInText(harmless)).toBe(harmless);
  });

  it('masks entire auth/cookie lines and quoted secrets, preserving verdict fields', () => {
    const input = 'X-Custom-Auth: tiny\nSet-Cookie: arbitrary=fixture-secret; Path=/\npassed=false bypass=true password="two secret words"';
    const out = redactSecretsInText(input);
    for (const secret of ['tiny', 'fixture-secret', 'two secret words']) expect(out).not.toContain(secret);
    expect(out).toContain('passed=false bypass=true');
    expect(redactSecretsInText(out)).toBe(out);
  });
});

describe('m4-vault redactSecretsInValue', () => {
  it('preserves verdict types and HAR arrays, masking name/value carriers in either key order', () => {
    const input = {
      passed: false, bypass: true, passCount: 3, pass: 'fixture-password', sessionId: 's-1',
      headers: [{ value: 'tiny', name: 'X-Custom-Auth' }, { name: 'X-Api-Key', value: 'short' }, { name: 'X-Trace', value: 'ordinary' }],
      cookies: [{ name: 'arbitrary', value: 'cookie-value' }],
    };
    const out = redactSecretsInValue(input);
    expect(out).toEqual({
      passed: false, bypass: true, passCount: 3, pass: REDACTED, sessionId: 's-1',
      headers: [{ value: REDACTED, name: 'X-Custom-Auth' }, { name: 'X-Api-Key', value: REDACTED }, { name: 'X-Trace', value: 'ordinary' }],
      cookies: [{ name: 'arbitrary', value: REDACTED }],
    });
    expect(input.headers[0].value).toBe('tiny');
    expect(redactSecretsInValue(out)).toEqual(out);
  });
  it('redacts secret-looking keys deeply', () => {
    const out = redactSecretsInValue({
      user: 'alice',
      password: 'hunter2',
      nested: { apiKey: 'xyz', note: 'password=hunter2' },
      list: [{ token: 't' }],
    }) as Record<string, unknown>;
    expect(out.user).toBe('alice');
    expect(out.password).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).apiKey).toBe(REDACTED);
    expect(String((out.nested as Record<string, unknown>).note)).not.toContain('hunter2');
    expect(((out.list as Array<Record<string, unknown>>)[0]!).token).toBe(REDACTED);
  });
});

describe('m4-vault redactToolResultPayload', () => {
  it('scrubs content, data, and error details', () => {
    const out = redactToolResultPayload({
      ok: false,
      content: 'auth failed password=hunter2',
      data: { headers: { authorization: 'Bearer secret-token-value' } },
      error: {
        code: 'E_AUTH',
        message: 'token=abc123secret',
        details: { password: 'p@ss' },
      },
    });
    expect(out.content).not.toContain('hunter2');
    expect(JSON.stringify(out.data)).not.toContain('secret-token-value');
    expect(out.error?.message).not.toContain('abc123secret');
    expect((out.error?.details as Record<string, unknown>).password).toBe(REDACTED);
  });
});
