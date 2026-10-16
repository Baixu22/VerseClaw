import { describe, expect, it } from 'vitest';
import {
  AuditTrail,
  AUDIT_ACTIONS,
  auditEventFromHitl,
  createAuditEvent,
} from '../src/security/audit-trail';
import type { HitlAuditEvent } from '../src/engine/hitl-checkpoint';

describe('agent audit trail (draft-aligned fields)', () => {
  it('emits actor/action/resource/decision/timestamp', () => {
    const e = createAuditEvent({
      actor: { type: 'agent', id: 'grok' },
      action: 'browser.navigate',
      resource: { type: 'session', id: 's1' },
      decision: 'allow',
      sessionId: 's1',
      outcome: 'ok',
    });
    expect(e.schemaVersion).toBe(1);
    expect(e.id).toBeTruthy();
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(e.actor).toEqual({ type: 'agent', id: 'grok' });
    expect(e.action).toBe('browser.navigate');
    expect(e.resource).toEqual({ type: 'session', id: 's1' });
    expect(e.decision).toBe('allow');
  });

  it('redacts secret-looking detail keys and values', () => {
    const e = createAuditEvent({
      actor: { type: 'system', id: 'test' },
      action: 'auth.login',
      resource: { type: 'origin', id: 'https://x' },
      decision: 'allow',
      details: {
        password: 'hunter2',
        api_key: 'abc',
        note: 'ok',
        blob: 'sk-abcdefghijklmnopqrstuvwx',
        private_key: 'PRIVATE-MATERIAL',
        session: 'SESS-VALUE',
        sid: 'SID-VALUE',
        csrf: 'CSRF-VALUE',
        otp: '482915',
        pin: '7788',
        auth: 'AUTH-VALUE',
        bearerish: 'Authorization: Bearer sk-live-abcdefgh1234',
        jwtsh: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmno',
      },
    });
    expect(e.details?.password).toBe('[REDACTED]');
    expect(e.details?.api_key).toBe('[REDACTED]');
    expect(e.details?.blob).toBe('[REDACTED]');
    // The key list must cover the field-family and network-alias names too, not just the
    // `password`/`api_key`/`token` trio (measured 2026-10-14: these all reached `details`).
    for (const key of ['private_key', 'session', 'sid', 'csrf', 'otp', 'pin', 'auth'] as const) {
      expect(e.details?.[key], key).toBe('[REDACTED]');
    }
    // A credential shape under a benign key is caught by the shared free-text redactor.
    // The line-start name rule (name: value) wins here, so the whole tail is replaced.
    expect(e.details?.bearerish).toBe('Authorization: [REDACTED]');
    expect(e.details?.jwtsh).toBe('[REDACTED_JWT]');
    expect(e.details?.note).toBe('ok');
  });

  it('maps HITL pause/resume/deny into the shared schema', () => {
    const pause: HitlAuditEvent = {
      at: new Date().toISOString(),
      event: 'pause',
      sessionId: 's9',
      reason: 'captcha_human_required',
      detail: 'human must complete challenge',
    };
    const e = auditEventFromHitl(pause);
    expect(e.action).toBe(AUDIT_ACTIONS.hitlPause);
    expect(e.decision).toBe('pause');
    expect(e.reason).toBe('captcha_human_required');
    expect(e.actor.type).toBe('system');

    const deny = auditEventFromHitl({
      at: pause.at,
      event: 'deny',
      sessionId: 's9',
      detail: 'bad resume token',
    });
    expect(deny.decision).toBe('deny');
    expect(deny.action).toBe(AUDIT_ACTIONS.hitlDeny);
  });

  it('filters and exports NDJSON', () => {
    const t = new AuditTrail();
    t.record({
      actor: { type: 'agent', id: 'a' },
      action: 'browser.click',
      resource: { type: 'session', id: 's1' },
      decision: 'allow',
      sessionId: 's1',
    });
    t.record({
      actor: { type: 'agent', id: 'b' },
      action: 'capability.deny',
      resource: { type: 'tool', id: 'vb_open' },
      decision: 'deny',
      sessionId: 's2',
      reason: 'E_CAPABILITY_DENY',
    });
    expect(t.list({ sessionId: 's1' })).toHaveLength(1);
    expect(t.list({ decision: 'deny' })).toHaveLength(1);
    const lines = t.toNdjson().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).action).toBe('browser.click');
    expect(JSON.parse(lines[1]!).decision).toBe('deny');
  });

  it('caps the in-memory ring buffer', () => {
    const t = new AuditTrail({ limit: 3 });
    for (let i = 0; i < 5; i += 1) {
      t.record({
        actor: { type: 'system', id: 'x' },
        action: 'noop',
        resource: { type: 'session', id: 's' },
        decision: 'info',
        details: { i },
      });
    }
    expect(t.size).toBe(3);
    expect(t.list()[0]?.details?.i).toBe(2);
  });
});
