import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SENSITIVE_CAPTURE_POLICY,
  decideSensitiveCapture,
} from '../src/security/sensitive-capture-policy.ts';

describe('sensitive capture decision', () => {
  const at = Date.parse('2026-01-01T00:00:00.000Z');

  /**
   * `invalid-policy` was declared in the decision type but no branch ever returned it: a policy that
   * was present yet not an object (a host store handing back a string / number / array) was coerced
   * to `{}` and then judged by the permissive defaults, so the capture gate answered `allow` for a
   * value that is not a policy at all. Absent policy still means "no override, use the defaults".
   */
  it('fails closed with invalid-policy when the policy is present but not an object', () => {
    for (const [label, policy] of [
      ['string', 'whatever'],
      ['array', []],
      ['number', 42],
      ['true', true],
    ] as Array<[string, unknown]>) {
      const decision = decideSensitiveCapture({ policy, channel: 'screenshot', nowMs: at });
      expect(decision, label).toMatchObject({ allowed: false, code: 'invalid-policy' });
    }
    // Absent policy means "no override": the documented defaults still apply.
    expect(decideSensitiveCapture({ policy: undefined, channel: 'screenshot', nowMs: at }))
      .toMatchObject({ allowed: true, code: 'allow' });
    expect(decideSensitiveCapture({ policy: null, channel: 'screenshot', nowMs: at }))
      .toMatchObject({ allowed: true, code: 'allow' });
  });

  it('honours a real boolean kill switch and channel disable', () => {
    expect(decideSensitiveCapture({
      policy: { ...DEFAULT_SENSITIVE_CAPTURE_POLICY, killSwitch: true },
      channel: 'screenshot',
      nowMs: at,
    })).toMatchObject({ allowed: false, code: 'kill-switch' });

    expect(decideSensitiveCapture({
      policy: { channels: { screenshot: { enabled: false } } },
      channel: 'screenshot',
      nowMs: at,
    })).toMatchObject({ allowed: false, code: 'channel-disabled' });
  });

  it('keeps the documented grant rules for desktop automation', () => {
    expect(decideSensitiveCapture({ policy: DEFAULT_SENSITIVE_CAPTURE_POLICY, channel: 'desktopAutomation', nowMs: at }))
      .toMatchObject({ allowed: false, code: 'grant-required' });
    const granted = decideSensitiveCapture({
      policy: {
        channels: { desktopAutomation: { enabled: true, requireGrant: true } },
        grants: [{ id: 'g1', channel: 'desktopAutomation', grantedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z' }],
      },
      channel: 'desktopAutomation',
      grantId: 'g1',
      nowMs: at,
    });
    expect(granted).toMatchObject({ allowed: true, code: 'allow' });
    const expired = decideSensitiveCapture({
      policy: {
        channels: { desktopAutomation: { enabled: true, requireGrant: true } },
        grants: [{ id: 'g1', channel: 'desktopAutomation', grantedAt: '2026-01-01T00:00:00.000Z', expiresAt: 'not-a-date' }],
      },
      channel: 'desktopAutomation',
      grantId: 'g1',
      nowMs: at,
    });
    expect(expired).toMatchObject({ allowed: false, code: 'grant-expired' });
  });
});