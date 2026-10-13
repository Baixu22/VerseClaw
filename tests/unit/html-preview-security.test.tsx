import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import HtmlPreview from '@/components/file-preview/HtmlPreview';
import { HTML_PREVIEW_CSP, HTML_PREVIEW_SANDBOX } from '@shared/security/url-policy';

const registerHtmlPreviewDocument = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('@/lib/file-preview-client', () => ({
  registerHtmlPreviewDocument: (...args: unknown[]) => registerHtmlPreviewDocument(...args),
}));

describe('HtmlPreview security (P1-004)', () => {
  it('applies the hardened sandbox and serves the prepared document from the preview scheme', async () => {
    registerHtmlPreviewDocument.mockResolvedValue({
      ok: true,
      url: 'clawx-preview://document/token-1',
    });
    render(
      <HtmlPreview
        source="<html><body><script>window.x=1</script></body></html>"
        filePath="C:\\ws\\a.html"
        fileName="a.html"
      />,
    );

    const iframe = screen.getByTestId('html-preview-frame') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBe(HTML_PREVIEW_SANDBOX);

    // The prepared document still carries the preview CSP as defence in depth,
    // and Main re-sends it as a response header for the dedicated scheme.
    const prepared = registerHtmlPreviewDocument.mock.calls[0]?.[0] as string;
    expect(prepared).toContain(HTML_PREVIEW_CSP);
    expect(prepared).toContain('Content-Security-Policy');

    // The live frame must not be a local-scheme (CSP-inheriting) document.
    await waitFor(() => {
      expect(iframe.getAttribute('src')).toBe('clawx-preview://document/token-1');
    });
    expect(iframe.getAttribute('srcdoc')).toBeNull();
  });

  it('falls back to a sandboxed srcdoc render when the document cannot be registered', async () => {
    registerHtmlPreviewDocument.mockResolvedValue({ ok: false, error: 'tooLarge' });
    render(
      <HtmlPreview source="<html><body>hi</body></html>" filePath="C:\\ws\\a.html" fileName="a.html" />,
    );

    const iframe = screen.getByTestId('html-preview-frame') as HTMLIFrameElement;
    await waitFor(() => {
      expect(iframe.getAttribute('srcdoc') ?? '').toContain(HTML_PREVIEW_CSP);
    });
    expect(iframe.getAttribute('src')).toBeNull();
  });
});
