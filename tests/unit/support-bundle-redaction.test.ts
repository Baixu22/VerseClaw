// @vitest-environment node
/**
 * FP-P1-06: support bundle redaction — the "prove the secret is gone" tests.
 *
 * The AC requires an assertion that a planted fake secret cannot be found in
 * the exported text, plus the hard lock "redaction failure ⇒ export failure"
 * via verifyRedaction.
 */
import { describe, expect, it } from 'vitest';
import {
  redactSupportBundleText,
  verifyRedaction,
} from '@electron/services/support-bundle';

const FAKE_SECRETS = [
  'sk-proj-abcdef1234567890abcdef1234567890',
  'sk-ant-api03-fakefakefakefakefake',
  'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
  'AKIAIOSFODNN7EXAMPLE',
  'xoxb-123456789-abcdefghijklmnop',
];

describe('FP-P1-06 redactSupportBundleText', () => {
  it('a planted fake API key CANNOT be found in the sanitized output', () => {
    for (const secret of FAKE_SECRETS) {
      const bundle = JSON.stringify({
        providers: [{ vendorId: 'openai', note: `key was ${secret}` }],
        log: `Authorization: Bearer ${secret}`,
      });
      const { sanitized } = redactSupportBundleText(bundle);
      expect(sanitized, `secret leaked: ${secret}`).not.toContain(secret);
      expect(verifyRedaction(sanitized)).toEqual([]);
      // Still valid JSON after redaction.
      expect(() => JSON.parse(sanitized)).not.toThrow();
    }
  });

  it('bearer tokens and env-style assignments are stripped', () => {
    const bundle = JSON.stringify({
      a: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
      b: 'OPENAI_API_KEY=supersecretvalue123',
      c: 'MY_SERVICE_TOKEN=tok_abcdef123456',
    });
    const { sanitized, findings } = redactSupportBundleText(bundle);
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIs');
    expect(sanitized).not.toContain('supersecretvalue123');
    expect(sanitized).not.toContain('tok_abcdef123456');
    // The names survive (useful), the values do not.
    expect(sanitized).toContain('OPENAI_API_KEY=[REDACTED:env-value]');
    expect(findings.find((f) => f.type === 'bearer-token')?.hits).toBeGreaterThan(0);
  });

  it('usernames in absolute paths are masked on both path styles', () => {
    const bundle = JSON.stringify({
      win: 'C:\\Users\\alice27\\project\\file.ts',
      posix: '/home/bob-dev/project/file.ts',
      mac: '/Users/carol.smith/project/file.ts',
    });
    const { sanitized } = redactSupportBundleText(bundle);
    expect(sanitized).not.toContain('alice27');
    expect(sanitized).not.toContain('bob-dev');
    expect(sanitized).not.toContain('carol.smith');
    expect(sanitized).toContain('[REDACTED:user]');
    expect(verifyRedaction(sanitized)).toEqual([]);
  });

  it('reports per-pattern hit counts without the hit values', () => {
    const { findings } = redactSupportBundleText(
      'sk-abcdefabcdefabcdef and sk-123456123456123456',
    );
    const keyFinding = findings.find((f) => f.type === 'openai-style-key');
    expect(keyFinding?.hits).toBe(2);
    // A findings entry is {type, hits} only — no captured values field exists.
    expect(Object.keys(keyFinding ?? {}).sort()).toEqual(['hits', 'type']);
  });

  it('clean input round-trips unchanged with zero hits', () => {
    const bundle = JSON.stringify({ ok: true, note: 'nothing secret here' });
    const { sanitized, findings } = redactSupportBundleText(bundle);
    expect(sanitized).toBe(bundle);
    expect(findings.every((f) => f.hits === 0)).toBe(true);
  });

  it('verifyRedaction flags text that still contains secrets (export must fail)', () => {
    expect(verifyRedaction('residual sk-abcdefabcdefabcdef here')).toContain('openai-style-key');
  });

  it('no source-code bodies concept: redaction placeholders never re-match patterns', () => {
    // Fixed-point property: redacting twice yields the same output.
    const bundle = JSON.stringify({
      k: 'sk-abcdefabcdefabcdef',
      p: 'C:\\Users\\dave\\x',
      e: 'FOO_SECRET=abcdefgh123',
      b: 'Bearer abcdefghijklmnop',
    });
    const once = redactSupportBundleText(bundle).sanitized;
    const twice = redactSupportBundleText(once).sanitized;
    expect(twice).toBe(once);
    expect(verifyRedaction(once)).toEqual([]);
  });
});
