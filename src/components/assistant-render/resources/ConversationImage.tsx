/**
 * The one resolver for images that are not already on an attachment: Markdown,
 * galleries, and content blocks.
 *
 *   inline (data:, blob:)  -> shown directly
 *   Gateway or local path  -> Main's `media.thumbnails`, as attachments use
 *   remote http(s)         -> never loaded; CSP `img-src` has no http(s) by design,
 *                             so the user gets a labelled placeholder and an open path
 *   anything else, or an image that fails to decode -> explicit unavailable state
 *
 * Markup stays phrasing content (span, button) because Markdown wraps images in <p>.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Copy, ExternalLink, Globe, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatFileSize } from '@/components/assistant-ui/attachment';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import {
  classifyResourceUrl,
  imageMimeFromLocation,
  isInlineImageUrl,
  sanitizeResourceUrl,
  type ResourceLocation,
} from '@/pages/Chat/conversation-resources';
import { ImageLightbox } from './ImageLightbox';

export type ConversationImageVariant = 'inline' | 'tile';

type Resolved =
  | { url: string; status: 'ready'; src: string; filePath?: string }
  | { url: string; status: 'unavailable' };

function locationOf(url: string | undefined): ResourceLocation | null {
  if (!url) return null;
  if (isInlineImageUrl(url)) return { kind: 'data', url };
  const location = classifyResourceUrl(url);
  // A data: URL that is not an image has no business in an <img>.
  return location?.kind === 'data' ? null : location;
}

function useResolvedImage(url: string | undefined, location: ResourceLocation | null, mimeType: string | undefined): Resolved | null {
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!url || !location) return undefined;
    let cancelled = false;
    const entry = location.kind === 'gateway'
      ? { gatewayUrl: location.url, mimeType: mimeType ?? imageMimeFromLocation(location) }
      : location.kind === 'path'
        ? { filePath: location.path, mimeType: mimeType ?? imageMimeFromLocation(location) }
        : null;
    if (!entry) return undefined;
    hostApi.media.thumbnails({ paths: [entry] })
      .then((thumbnails) => {
        if (cancelled) return;
        const result = thumbnails[entry.gatewayUrl ?? entry.filePath ?? ''];
        setResolved(result?.preview
          ? {
              url,
              status: 'ready',
              src: result.preview,
              filePath: location.kind === 'path' ? location.path : result.resolvedPath,
            }
          : { url, status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setResolved({ url, status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [location, mimeType, url]);

  return resolved?.url === url ? resolved : null;
}

function Placeholder({
  variant,
  status,
  label,
  detail,
  icon,
  children,
}: {
  variant: ConversationImageVariant;
  status: string;
  label: string;
  detail?: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-2.5 rounded-lg border border-border bg-black/[0.02] px-3 py-2 text-left align-top dark:bg-white/[0.03]',
        variant === 'tile' && 'h-full w-full flex-col justify-center gap-1 border-0 bg-transparent px-2 py-1 text-center',
      )}
      data-testid="chat-resource-image"
      data-status={status}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words text-xs font-medium text-foreground', variant === 'tile' && 'line-clamp-2 font-normal text-muted-foreground')}>
          {label}
        </span>
        {detail && (
          <span className="block truncate text-2xs text-muted-foreground" title={detail}>{detail}</span>
        )}
      </span>
      {children && <span className="flex shrink-0 items-center">{children}</span>}
    </span>
  );
}

export function ConversationImage({
  url,
  alt,
  mimeType,
  omitted = false,
  bytes,
  variant = 'inline',
}: {
  url?: string;
  alt?: string;
  mimeType?: string;
  /** History kept only the size of this image. */
  omitted?: boolean;
  bytes?: number;
  variant?: ConversationImageVariant;
}) {
  const { t } = useTranslation('chat');
  const location = useMemo(() => locationOf(url), [url]);
  const resolved = useResolvedImage(url, location, mimeType);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const name = alt?.trim() || t('resources.image.untitled');

  if (omitted) {
    return (
      <Placeholder
        variant={variant}
        status="omitted"
        icon={<ImageIcon className="h-4 w-4" />}
        label={name}
        detail={bytes
          ? t('resources.image.omittedWithSize', { size: formatFileSize(bytes) })
          : t('resources.image.omitted')}
      />
    );
  }

  if (location?.kind === 'remote') {
    const remote = sanitizeResourceUrl(location.url);
    return (
      <Placeholder
        variant={variant}
        status="remote"
        icon={<Globe className="h-4 w-4" />}
        label={alt?.trim() || t('resources.image.remote')}
        detail={variant === 'tile' ? undefined : remote.displayUrl}
      >
        {remote.openUrl && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            title={t('resources.link.open')}
            aria-label={t('resources.link.open')}
            onClick={() => {
              void hostApi.shell.openExternal(remote.openUrl!).catch(() => {
                toast.error(t('resources.media.openFailed'));
              });
            }}
            data-testid="chat-resource-open-external"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
        {remote.displayUrl && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            title={t('resources.link.copy')}
            aria-label={t('resources.link.copy')}
            onClick={() => {
              void navigator.clipboard.writeText(remote.displayUrl!).then(() => toast.success(t('resources.link.copied')));
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </Placeholder>
    );
  }

  const src = location?.kind === 'data'
    ? location.url
    : resolved?.status === 'ready' ? resolved.src : undefined;
  const isResolving = !src && !resolved && (location?.kind === 'gateway' || location?.kind === 'path');

  if (isResolving) {
    return (
      <Placeholder
        variant={variant}
        status="loading"
        icon={<Loader2 className="h-4 w-4 animate-spin" />}
        label={t('resources.image.loading')}
      />
    );
  }

  if (!src || failedSrc === src) {
    return (
      <Placeholder
        variant={variant}
        status="unavailable"
        icon={<AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
        label={t('resources.image.unavailable')}
        detail={alt?.trim() || undefined}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          'cursor-zoom-in overflow-hidden rounded-lg',
          variant === 'tile' ? 'block h-full w-full rounded-none' : 'inline-block max-w-full align-top',
        )}
        aria-label={t('resources.image.view', { name })}
        onClick={() => setLightboxOpen(true)}
        data-testid="chat-resource-image"
        data-status="ready"
      >
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          onError={() => setFailedSrc(src)}
          className={cn('rounded-[inherit]', variant === 'tile' ? 'h-full w-full object-cover' : 'max-w-full')}
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox
          src={src}
          fileName={name}
          filePath={resolved?.status === 'ready' ? resolved.filePath : undefined}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
