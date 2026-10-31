/**
 * Audio / video resource card: native player, metadata, and an explicit state for
 * everything that can go wrong. A resource never degrades to a silent icon; when
 * it cannot play, the card says why and keeps a way to open the file.
 */
import { useCallback, useState, type SyntheticEvent } from 'react';
import { AlertCircle, Copy, ExternalLink, Film, FolderOpen, Loader2, Music, PanelRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AttachmentName, formatFileSize } from '@/components/assistant-ui/attachment';
import { confirmAndOpenFile } from '@/components/file-preview/open-file-utils';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { mediaKindOf, sanitizeResourceUrl } from '@/pages/Chat/conversation-resources';
import type { AttachedFileMeta } from '@/stores/chat/types';
import { MEDIA_MAX_BYTES, useMediaObjectUrl, type MediaLoadState } from './use-media-object-url';

type PlaybackError = 'unsupported' | 'failed';

type DisplayStatus =
  | MediaLoadState['status']
  | PlaybackError
  | 'remote'
  | 'unavailable';

/** MEDIA_ERR_DECODE and MEDIA_ERR_SRC_NOT_SUPPORTED: format or file problems, not transient ones. */
function playbackErrorOf(code: number | undefined): PlaybackError {
  return code === 3 || code === 4 ? 'unsupported' : 'failed';
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function CardAction({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-muted-foreground"
      title={label}
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}

export function ConversationMediaCard({
  file,
  onOpen,
  autoLoad = false,
  className,
}: {
  file: AttachedFileMeta;
  onOpen?: (file: AttachedFileMeta) => void;
  /** The side panel is an explicit request, so it skips the size gate. */
  autoLoad?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('chat');
  const kind = mediaKindOf(file) ?? 'audio';
  const dataUrl = file.preview?.startsWith('data:') ? file.preview : undefined;
  const media = useMediaObjectUrl({
    filePath: file.filePath,
    gatewayUrl: file.gatewayUrl,
    mimeType: file.mimeType,
    autoLoad,
  });
  const [duration, setDuration] = useState<number | null>(null);
  const [playback, setPlayback] = useState<{ src: string; error: PlaybackError } | null>(null);

  const src = dataUrl ?? (media.state.status === 'ready' ? media.state.url : undefined);
  const playbackError = src && playback?.src === src ? playback.error : null;
  const remote = file.remoteUrl ? sanitizeResourceUrl(file.remoteUrl) : null;
  const hasLocalSource = Boolean(file.filePath || file.gatewayUrl);

  let status: DisplayStatus;
  if (remote) status = 'remote';
  else if (playbackError) status = playbackError;
  else if (dataUrl) status = 'ready';
  else if (!hasLocalSource) status = 'unavailable';
  else status = media.state.status;

  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    const value = event.currentTarget.duration;
    setDuration(Number.isFinite(value) && value > 0 ? value : null);
  }, []);
  const handleError = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    setPlayback({ src: event.currentTarget.currentSrc || event.currentTarget.src, error: playbackErrorOf(event.currentTarget.error?.code) });
  }, []);

  const size = media.size ?? (file.fileSize > 0 ? file.fileSize : undefined);
  const path = media.resolvedPath;
  const meta = [
    file.mimeType,
    size ? formatFileSize(size) : null,
    duration != null ? formatDuration(duration) : null,
  ].filter(Boolean).join(' · ');

  const handleOpenWithSystem = async () => {
    if (!path) return;
    try {
      await confirmAndOpenFile({ filePath: path, fileName: file.fileName, size, t });
    } catch {
      toast.error(t('resources.media.openFailed'));
    }
  };
  const handleReveal = () => {
    if (!path) return;
    hostApi.shell.showItemInFolder(path).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed'));
    });
  };
  const handleOpenRemote = () => {
    if (!remote?.openUrl) return;
    hostApi.shell.openExternal(remote.openUrl).catch(() => {
      toast.error(t('resources.media.openFailed'));
    });
  };
  const handleCopyRemote = () => {
    if (!remote?.displayUrl) return;
    void navigator.clipboard.writeText(remote.displayUrl).then(() => toast.success(t('resources.link.copied')));
  };

  const errorMessage = (): string | null => {
    switch (status) {
      case 'notFound': return t('resources.media.errors.notFound');
      case 'outsideSandbox': return t('resources.media.errors.outsideSandbox');
      case 'tooLarge': return t('resources.media.errors.tooLarge', {
        size: formatFileSize(size ?? 0),
        limit: formatFileSize(MEDIA_MAX_BYTES),
      });
      case 'unsupported': return t('resources.media.errors.unsupported');
      case 'failed': return t('resources.media.errors.failed');
      case 'unavailable': return t('resources.media.errors.unavailable');
      case 'remote': return t('resources.media.errors.remote');
      default: return null;
    }
  };
  const message = errorMessage();
  const canRetry = status === 'notFound' || status === 'failed' || status === 'unsupported';

  return (
    <section
      className={cn(
        'max-w-full rounded-lg border border-border bg-background/70 shadow-sm',
        kind === 'video' ? 'w-[520px]' : 'w-[420px]',
        className,
      )}
      aria-label={file.fileName}
      data-testid={`chat-resource-${kind}`}
      data-status={status}
    >
      <div className="flex min-h-12 items-center gap-3 px-3 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-black/5 text-muted-foreground dark:bg-white/10">
          {kind === 'video' ? <Film className="h-4 w-4" /> : <Music className="h-4 w-4" />}
        </div>
        <AttachmentName name={file.fileName} sublabel={meta} className="flex-1" />
        {file.isVoiceNote && (
          <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-2xs text-muted-foreground dark:bg-white/10">
            {t('resources.media.voiceNote')}
          </span>
        )}
        <div className="flex shrink-0 items-center">
          {path && onOpen && (
            <CardAction
              label={t('resources.media.openInPanel')}
              onClick={() => onOpen({ ...file, filePath: path })}
              testId="chat-resource-open-panel"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </CardAction>
          )}
          {path && (
            <CardAction label={t('resources.media.openWithSystem')} onClick={() => void handleOpenWithSystem()}>
              <ExternalLink className="h-3.5 w-3.5" />
            </CardAction>
          )}
          {path && (
            <CardAction label={t('resources.media.revealInFolder')} onClick={handleReveal}>
              <FolderOpen className="h-3.5 w-3.5" />
            </CardAction>
          )}
          {remote?.openUrl && (
            <CardAction label={t('resources.link.open')} onClick={handleOpenRemote} testId="chat-resource-open-external">
              <ExternalLink className="h-3.5 w-3.5" />
            </CardAction>
          )}
          {remote?.displayUrl && (
            <CardAction label={t('resources.link.copy')} onClick={handleCopyRemote}>
              <Copy className="h-3.5 w-3.5" />
            </CardAction>
          )}
        </div>
      </div>

      <div className="px-3 pb-3">
        {status === 'ready' && src && (kind === 'video' ? (
          <video
            key={src}
            controls
            preload="metadata"
            playsInline
            src={src}
            aria-label={file.fileName}
            className="max-h-80 w-full rounded-md bg-black"
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleError}
            data-testid="chat-resource-player"
          />
        ) : (
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            aria-label={file.fileName}
            className="h-10 w-full"
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleError}
            data-testid="chat-resource-player"
          />
        ))}

        {status === 'loading' && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('resources.media.loading')}
          </p>
        )}

        {media.state.status === 'awaitingLoad' && status === 'awaitingLoad' && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('resources.media.largeFile', { size: formatFileSize(media.state.size) })}</span>
            <Button type="button" variant="outline" size="sm" onClick={media.load} data-testid="chat-resource-load">
              {t('resources.media.load')}
            </Button>
          </div>
        )}

        {message && (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="chat-resource-message">
            <p
              role={status === 'remote' ? undefined : 'alert'}
              className={cn(
                'flex min-w-0 items-start gap-2 text-xs',
                status === 'remote' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400',
              )}
            >
              {status !== 'remote' && <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 break-words">{message}</span>
            </p>
            {canRetry && hasLocalSource && (
              <Button type="button" variant="ghost" size="sm" onClick={media.retry} data-testid="chat-resource-retry">
                {t('resources.media.retry')}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
