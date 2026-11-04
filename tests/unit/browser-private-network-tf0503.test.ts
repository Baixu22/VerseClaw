import { describe, expect, it } from 'vitest';
import {
  classifyBrowserAddress,
  createBrowserPrivateNetworkApproval,
  decideBrowserNavigation,
} from '../../shared/agent-browser/private-network-policy';

const NOW = 1_770_000_000_000;

describe('TF-0503 browser private-network default deny', () => {
  it.each([
    ['http://127.0.0.1:18789/admin', 'loopback'],
    ['http://localhost:8080', 'local-name'],
    ['http://192.168.1.1', 'rfc1918'],
    ['http://10.0.0.5', 'rfc1918'],
    ['http://172.16.4.4', 'rfc1918'],
    ['http://169.254.169.254/latest/meta-data', 'link-local'],
    ['http://[::1]:9000', 'loopback'],
  ])('classifies %s as non-public (%s)', (url, expected) => {
    expect(classifyBrowserAddress(url)).toBe(expected);
  });

  it('treats a public https URL as public', () => {
    expect(classifyBrowserAddress('https://example.com/a')).toBe('public');
  });

  it('denies every private class by default when no approval exists', () => {
    for (const url of [
      'http://127.0.0.1:18789',
      'http://localhost:8080',
      'http://192.168.1.1',
      'http://10.0.0.5',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]:9000',
    ]) {
      const decision = decideBrowserNavigation({ url, sessionId: 's1', now: NOW });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('private-network-default-deny');
    }
  });

  it('allows a private origin only with a live approval bound to session and origin', () => {
    const approval = createBrowserPrivateNetworkApproval({
      sessionId: 's1', origin: 'http://127.0.0.1:18789', now: NOW, grantedBy: 'agent',
    });
    expect(decideBrowserNavigation({ url: 'http://127.0.0.1:18789/x', sessionId: 's1', approvals: [approval], now: NOW }).allowed).toBe(true);
    // wrong session
    expect(decideBrowserNavigation({ url: 'http://127.0.0.1:18789/x', sessionId: 's2', approvals: [approval], now: NOW }).allowed).toBe(false);
    // wrong origin
    expect(decideBrowserNavigation({ url: 'http://127.0.0.1:9999/x', sessionId: 's1', approvals: [approval], now: NOW }).allowed).toBe(false);
    // expired
    expect(decideBrowserNavigation({ url: 'http://127.0.0.1:18789/x', sessionId: 's1', approvals: [approval], now: NOW + 10 * 60 * 1000 + 1 }).allowed).toBe(false);
  });

  it('never allows an approval to leak across sessions or become global', () => {
    const approval = createBrowserPrivateNetworkApproval({
      sessionId: 's1', origin: 'http://10.0.0.5', now: NOW, grantedBy: 'agent',
    });
    expect(decideBrowserNavigation({ url: 'http://10.0.0.5/a', sessionId: 'other', approvals: [approval], now: NOW }).allowed).toBe(false);
    expect(decideBrowserNavigation({ url: 'http://10.0.0.6/a', sessionId: 's1', approvals: [approval], now: NOW }).allowed).toBe(false);
  });

  it('never lets the first-party preview exception cover non-loopback ranges', () => {
    const firstPartyOrigins = ['http://169.254.169.254', 'http://10.0.0.5', 'http://192.168.1.1', 'http://127.0.0.1:18789'];
    // metadata / RFC1918 claims are refused even when named as first-party
    for (const url of ['http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/internal', 'http://192.168.1.1/router']) {
      const decision = decideBrowserNavigation({ url, sessionId: 's-fp', firstPartyOrigins, now: NOW });
      expect(decision.allowed, url).toBe(false);
    }
    // loopback is the only class the preview exception can cover
    expect(
      decideBrowserNavigation({
        url: 'http://127.0.0.1:18789/preview',
        sessionId: 's-fp',
        firstPartyOrigins,
        now: NOW,
      }),
    ).toMatchObject({ allowed: true, reason: 'first-party-preview' });
  });

  it('public URLs bypass approval entirely and need none', () => {
    expect(decideBrowserNavigation({ url: 'https://example.com', sessionId: 's1', now: NOW }).allowed).toBe(true);
  });

  it('requires a grant when any DNS answer is private beyond loopback, even for a persisted local preview', () => {
    const url = 'http://preview.internal/';
    const input = { url, sessionId: 'preview', firstPartyOrigins: ['http://preview.internal'] };
    expect(decideBrowserNavigation({ ...input, resolvedAddresses: ['127.0.0.1'] })).toMatchObject({ allowed: true, reason: 'first-party-preview' });
    for (const addresses of [
      ['169.254.169.254'], ['127.0.0.1', '192.168.1.2'], ['192.168.1.2', '127.0.0.1'],
    ]) {
      expect(decideBrowserNavigation({ ...input, resolvedAddresses: addresses }).allowed).toBe(false);
    }
  });
});
