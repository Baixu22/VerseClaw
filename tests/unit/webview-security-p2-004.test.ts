import { describe, expect, it } from 'vitest';
import {
  evaluateWebViewAttach,
  evaluateWebViewNavigation,
  evaluateWebViewPermission,
  evaluateWebViewSrc,
  WEBVIEW_CONTROL_PARTITION,
} from '@electron/utils/webview-security';

describe('webview security (P2-004 / F-ISO-002)', () => {
  it('allows only Gateway Control loopback src', () => {
    expect(evaluateWebViewSrc('http://127.0.0.1:18789/')).toMatchObject({
      allowed: true,
      kind: 'gateway-control',
    });
    expect(evaluateWebViewSrc('http://localhost:18789/control')).toMatchObject({ allowed: true });
    expect(evaluateWebViewSrc('about:blank')).toMatchObject({ allowed: true, kind: 'about-blank' });
  });

  it('denies unexpected hosts and schemes', () => {
    expect(evaluateWebViewSrc('https://evil.example/')).toMatchObject({
      allowed: false,
      code: 'disallowed-host',
    });
    expect(evaluateWebViewSrc('file:///C:/secret.html')).toMatchObject({
      allowed: false,
      code: 'disallowed-scheme',
    });
    expect(evaluateWebViewSrc('javascript:alert(1)')).toMatchObject({ allowed: false });
    expect(evaluateWebViewSrc('')).toMatchObject({ allowed: false, code: 'empty' });
  });

  it('hardens attach prefs and forbids guest preload / nodeIntegration', () => {
    const ok = evaluateWebViewAttach({
      src: 'http://127.0.0.1:18789/',
      nodeIntegration: false,
      contextIsolation: true,
    });
    expect(ok.allowed).toBe(true);
    expect(ok.prefs).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: WEBVIEW_CONTROL_PARTITION,
    });

    expect(evaluateWebViewAttach({
      src: 'http://127.0.0.1:18789/',
      nodeIntegration: true,
    }).allowed).toBe(false);

    expect(evaluateWebViewAttach({
      src: 'http://127.0.0.1:18789/',
      preload: 'C:/evil/preload.js',
    }).allowed).toBe(false);

    expect(evaluateWebViewAttach({
      src: 'https://evil.example/',
    }).allowed).toBe(false);
  });

  it('defaults permissions to deny and audits reason', () => {
    const media = evaluateWebViewPermission('media', 'http://127.0.0.1:18789/');
    expect(media.allowed).toBe(false);
    expect(media.reason).toMatch(/denied/i);

    const geo = evaluateWebViewPermission('geolocation');
    expect(geo.allowed).toBe(false);

    const untrusted = evaluateWebViewPermission('notifications', 'https://evil.example/');
    expect(untrusted.allowed).toBe(false);
  });

  it('blocks external navigation from webview', () => {
    expect(evaluateWebViewNavigation('http://127.0.0.1:18789/path')).toMatchObject({ allowed: true });
    expect(evaluateWebViewNavigation('https://example.com/')).toMatchObject({ allowed: false });
    expect(evaluateWebViewNavigation('javascript:alert(1)')).toMatchObject({ allowed: false });
  });
});
