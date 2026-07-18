import { describe, expect, it } from 'vitest';
import {
  redactChannelFormValues,
  redactChannelSecretValue,
} from '../../electron/utils/channel-config';

describe('channel secret residual locks (P8-001 / F-SEC-001)', () => {
  it('redacts secret-shaped channel form fields for Renderer', () => {
    const canary = 'sk-canary-P8-001-MUST-NOT-LEAK-abcdef';
    const redacted = redactChannelFormValues({
      appId: 'cli_demo_app',
      appSecret: canary,
      botToken: canary,
      token: canary,
      webhookSecret: canary,
      enabled: 'true',
      displayName: 'demo',
    });

    expect(redacted.appId).toBe('cli_demo_app');
    expect(redacted.displayName).toBe('demo');
    expect(redacted.enabled).toBe('true');
    for (const key of ['appSecret', 'botToken', 'token', 'webhookSecret'] as const) {
      expect(redacted[key]).not.toContain(canary);
      expect(redacted[key]).toMatch(/^\?{4}/);
      expect(redacted[key].endsWith(canary.slice(-4))).toBe(true);
    }
  });

  it('never returns short plaintext secrets unmasked', () => {
    expect(redactChannelSecretValue('abcd')).toBe('????');
    expect(redactChannelSecretValue('')).toBe('');
    expect(redactChannelSecretValue('  ')).toBe('');
  });

  it('JSON serialization of redacted form does not embed canary plaintext', () => {
    const canary = 'tg-bot-canary-P8-001-xyzzy';
    const redacted = redactChannelFormValues({ botToken: canary, name: 'bot' });
    const blob = JSON.stringify(redacted);
    expect(blob).not.toContain(canary);
    expect(blob).toContain('bot');
  });
});
