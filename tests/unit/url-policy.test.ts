import { describe, expect, it } from 'vitest';
import {
  evaluateExternalNavigationUrl,
  isAllowedExternalNavigationUrl,
  assertAllowedExternalNavigationUrl,
  HTML_PREVIEW_CSP,
  HTML_PREVIEW_SANDBOX,
  RENDERER_CSP,
} from '../../shared/security/url-policy';
import { isBrowserControlRestrictedUrl } from '../../shared/agent-browser/browser-control';

describe('url-policy (P1-004)', () => {
  it('allows only http/https external navigation', () => {
    expect(isAllowedExternalNavigationUrl('https://example.com/a')).toBe(true);
    expect(isAllowedExternalNavigationUrl('http://127.0.0.1:18789/')).toBe(true);
    expect(evaluateExternalNavigationUrl('https://example.com').ok).toBe(true);
  });

  it('rejects javascript/data/file/custom schemes', () => {
    const bad = [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///C:/Windows/System32/calc.exe',
      'vbscript:msgbox(1)',
      'ms-msdt:foo',
      'vscode://file/x',
      'about:blank',
      'blob:https://example.com/uuid',
      'not a url',
      '',
    ];
    for (const url of bad) {
      expect(isAllowedExternalNavigationUrl(url), url).toBe(false);
      expect(() => assertAllowedExternalNavigationUrl(url)).toThrow();
    }
  });

  it('rejects embedded credentials', () => {
    expect(isAllowedExternalNavigationUrl('https://user:pass@example.com/')).toBe(false);
  });

  it('agent browser restricted matrix blocks dangerous schemes and keeps webstore block', () => {
    expect(isBrowserControlRestrictedUrl('javascript:alert(1)')).toBe(true);
    expect(isBrowserControlRestrictedUrl('data:text/html,x')).toBe(true);
    expect(isBrowserControlRestrictedUrl('file:///tmp/x')).toBe(true);
    expect(isBrowserControlRestrictedUrl('chrome://settings')).toBe(true);
    expect(isBrowserControlRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isBrowserControlRestrictedUrl('https://example.com')).toBe(false);
  });

  it('exports CSP / sandbox controls for preview and renderer', () => {
    expect(HTML_PREVIEW_SANDBOX).not.toMatch(/allow-popups-to-escape-sandbox/);
    expect(HTML_PREVIEW_SANDBOX).not.toMatch(/allow-downloads/);
    expect(HTML_PREVIEW_CSP).toMatch(/default-src 'none'/);
    expect(RENDERER_CSP).toMatch(/default-src 'self'/);
    expect(RENDERER_CSP).toMatch(/object-src 'none'/);
  });
});