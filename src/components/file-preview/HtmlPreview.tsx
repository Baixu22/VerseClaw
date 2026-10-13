/**
 * Sandboxed rendered HTML preview.
 *
 * HTML emitted by an agent is untrusted, so it is rendered inside an iframe
 * with a sandbox instead of being injected into the React tree. Scripts remain
 * allowed for simple demos, but popup escape, downloads, and same-origin access
 * are denied. A document CSP is injected as well.
 *
 * The prepared document is handed to the Main process, which serves it from the
 * dedicated `clawx-preview:` scheme. Rendering it through `srcdoc` would make
 * the frame inherit the renderer CSP (`script-src 'self'`); CSP policies are
 * intersected, so that inherited policy silently blocked every inline preview
 * script no matter what `HTML_PREVIEW_CSP` allowed (#132).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { registerHtmlPreviewDocument } from '@/lib/file-preview-client';
import { HTML_PREVIEW_CSP, HTML_PREVIEW_SANDBOX } from '@shared/security/url-policy';

export interface HtmlPreviewProps {
  source: string;
  filePath: string;
  fileName?: string;
  className?: string;
}

function dirnameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return '';
  return normalized.slice(0, idx + 1);
}

function pathToFileUrl(filePath: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = absolutePath
    .split('/')
    .map((segment, index) => (index === 0 ? '' : encodeURIComponent(segment)))
    .join('/');
  return `file://${encoded}`;
}

function injectPreviewGuards(source: string, filePath: string): string {
  const baseUrl = pathToFileUrl(dirnameOf(filePath));
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;
  const baseTag = baseUrl ? `<base href="${baseUrl}">` : '';
  const headInject = `${cspTag}${baseTag ? `\n${baseTag}` : ''}`;

  let html = source;
  if (baseUrl && /<base\s/i.test(html)) {
    // Keep author base; still inject CSP.
  } else if (baseUrl && /<head[\s>]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${headInject}`);
    return html;
  } else if (/<head[\s>]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${cspTag}`);
    return html;
  } else if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${headInject}</head>`);
  }
  return `<!doctype html><html><head>${headInject}</head><body>${html}</body></html>`;
}

export default function HtmlPreview({ source, filePath, fileName, className }: HtmlPreviewProps) {
  const { t } = useTranslation('chat');
  const srcDoc = useMemo(() => injectPreviewGuards(source, filePath), [source, filePath]);
  // The served URL is only trusted while it still matches the current source;
  // when the input changes the frame falls back to the sandboxed `srcdoc`.
  const documentKey = useMemo(() => `${filePath}\u0000${source}`, [filePath, source]);
  const [registered, setRegistered] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void registerHtmlPreviewDocument(srcDoc)
      .then((result) => {
        if (cancelled || !result.ok || !result.url) return;
        setRegistered({ key: documentKey, url: result.url });
      })
      .catch(() => {
        // Fall back to the sandboxed `srcdoc` render; scripts stay CSP-blocked.
      });
    return () => {
      cancelled = true;
    };
  }, [documentKey, srcDoc]);

  const previewUrl = registered?.key === documentKey ? registered.url : null;

  return (
    <div className={cn('h-full min-h-0 bg-white', className)}>
      <iframe
        data-testid="html-preview-frame"
        title={fileName ?? t('filePreview.html.title', 'HTML preview')}
        {...(previewUrl ? { src: previewUrl } : { srcDoc })}
        sandbox={HTML_PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        className="h-full w-full border-0 bg-white"
      />
    </div>
  );
}
