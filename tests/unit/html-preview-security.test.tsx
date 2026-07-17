import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import HtmlPreview from '@/components/file-preview/HtmlPreview';
import { HTML_PREVIEW_CSP, HTML_PREVIEW_SANDBOX } from '@shared/security/url-policy';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

describe('HtmlPreview security (P1-004)', () => {
  it('applies hardened sandbox and injects CSP into srcdoc', () => {
    const { container } = render(
      <HtmlPreview source="<html><body><script>window.x=1</script></body></html>" filePath="C:\\ws\\a.html" fileName="a.html" />,
    );
    const iframe = container.querySelector('iframe[data-testid="html-preview-frame"]') as HTMLIFrameElement | null;
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('sandbox')).toBe(HTML_PREVIEW_SANDBOX);
    expect(iframe?.getAttribute('srcdoc') ?? '').toContain(HTML_PREVIEW_CSP);
    expect(iframe?.getAttribute('srcdoc') ?? '').toContain('Content-Security-Policy');
  });
});