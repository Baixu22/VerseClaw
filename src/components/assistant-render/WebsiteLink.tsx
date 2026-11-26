import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { maskChatSecrets } from '@/lib/chat-display-text';
import { hostApi } from '@/lib/host-api';
import { sanitizeResourceUrl } from '@/pages/Chat/conversation-resources';
import { linkPreviewRequestUrl } from '@shared/security/link-preview';

type Props = { url: string; children?: ReactNode; testId?: string };
const previewDelayMs = 500;
const faviconData = /^data:image\/(?:png|jpeg|x-icon);base64,/i;
const thumbnailData = /^data:image\/(?:png|jpeg);base64,/i;

function WebsiteIcon({ origin }: { origin?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [icon, setIcon] = useState<string>();
  useEffect(() => {
    if (!origin || !ref.current) return;
    let active = true;
    const load = async () => {
      try {
        const result = await hostApi.media.linkPreview(origin, 'favicon');
        if (active && result?.favicon && faviconData.test(result.favicon)) setIcon(result.favicon);
      } catch {
        // The globe still identifies the link when the site has no usable icon.
      }
    };
    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void load();
    });
    observer.observe(ref.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [origin]);
  return <span ref={ref} className="chat-website-icon" aria-hidden="true">
    {icon ? <img src={icon} alt="" data-testid="chat-website-favicon" onError={() => setIcon(undefined)} /> : <Globe />}
  </span>;
}

export function WebsiteLink(props: Props) {
  return <WebsiteLinkContent key={props.url} {...props} />;
}

function WebsiteLinkContent({ url, children, testId = 'chat-resource-website-link' }: Props) {
  const { t } = useTranslation('chat');
  const { displayUrl, openUrl } = sanitizeResourceUrl(url);
  const visibleLabel = typeof children === 'string' ? maskChatSecrets(children) : children;
  const label = !visibleLabel || children === url ? displayUrl ?? maskChatSecrets(url) : visibleLabel;
  const requestUrl = openUrl && displayUrl === openUrl ? linkPreviewRequestUrl(openUrl) : null;
  const previewUrl = requestUrl?.href;
  const origin = requestUrl?.origin;
  const [hovered, setHovered] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>();

  useEffect(() => {
    if (!hovered || !previewUrl || thumbnail !== undefined) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await hostApi.media.linkPreview(previewUrl);
        if (active) setThumbnail(result?.thumbnail && thumbnailData.test(result.thumbnail) ? result.thumbnail : null);
      } catch {
        if (active) setThumbnail(null);
      }
    }, previewDelayMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [hovered, previewUrl, thumbnail]);

  if (!displayUrl) return <span>{label}</span>;
  if (!openUrl) return <span data-testid={testId}>{label}</span>;
  const contents = <><WebsiteIcon origin={origin} />{label}</>;

  const open = () => void hostApi.shell.openExternal(openUrl).catch(() => toast.error(t('resources.media.openFailed')));
  if (displayUrl !== openUrl) {
    return <button type="button" className="chat-website-link" data-testid={testId} onClick={open}>{contents}</button>;
  }

  const link = <a href={openUrl} target="_blank" rel="noopener noreferrer" className="chat-website-link" data-testid={testId}
    onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open();
    }}>{contents}</a>;
  if (!previewUrl) return link;
  return <Tooltip delayDuration={0} disableHoverableContent onOpenChange={setHovered}>
    <TooltipTrigger asChild>{link}</TooltipTrigger>
    {thumbnail && <TooltipContent side="top" align="start" sideOffset={6} collisionPadding={10}
      className="chat-website-preview min-h-0 p-0" aria-label={t('resources.link.previewImage')}>
      <img src={thumbnail} alt="" data-testid="chat-link-preview-image" onError={() => setThumbnail(null)} />
    </TooltipContent>}
  </Tooltip>;
}
