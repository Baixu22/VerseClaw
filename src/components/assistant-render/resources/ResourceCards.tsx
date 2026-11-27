import { Check, Copy, ExternalLink, FileQuestion, FolderOpen, PanelRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/components/tool-ui/shared/use-copy-to-clipboard';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { maskChatSecrets } from '@/lib/chat-display-text';
import { parseGitHubUrl } from '@/lib/github-link';
import { cn } from '@/lib/utils';
import {
  sanitizeResourceUrl,
  type ConversationResource,
  type ConversationUnknownResource,
} from '@/pages/Chat/conversation-resources';
import { openWorkspacePanel } from '@/stores/artifact-panel';
import { GitHubCard } from '../GitHubCard';
import { WebsiteLink } from '../WebsiteLink';
import { ConversationImage } from './ConversationImage';

function IconAction({
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

export function WebsiteLinkCard({
  url,
  title,
  description,
  allowSidePreview = false,
  inline = false,
}: {
  url: string;
  title?: string;
  description?: string;
  /** Only where the workspace panel is on screen. It loads nothing until the user acts there. */
  allowSidePreview?: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation('chat');
  const { copiedId, copy } = useCopyToClipboard();
  const { displayUrl, openUrl } = sanitizeResourceUrl(url);

  // A disallowed scheme or malformed target is not a link; keep the words visible.
  if (!displayUrl) {
    return <span className="break-words text-sm text-muted-foreground">{maskChatSecrets(title ?? url)}</span>;
  }
  if (openUrl && parseGitHubUrl(openUrl)?.type === 'repo') return <GitHubCard url={openUrl} />;

  return (
    <span className={cn('chat-website-resource', inline && 'chat-website-resource-inline')} data-testid="chat-resource-website-link">
      <span className="chat-website-resource-text">
        <WebsiteLink url={url} testId="chat-resource-open-external">{title}</WebsiteLink>
        {!inline && title && <span className="chat-website-resource-detail">{displayUrl}</span>}
        {description && <span className="chat-website-resource-detail">{maskChatSecrets(description)}</span>}
      </span>
      <span className="chat-website-resource-actions">
        {openUrl && allowSidePreview && (
          <IconAction
            label={t('resources.link.preview')}
            onClick={() => openWorkspacePanel({ panel: 'browser', view: 'live', url: openUrl })}
            testId="chat-resource-open-browser-panel"
          >
            <PanelRight className="h-3.5 w-3.5" />
          </IconAction>
        )}
        <IconAction label={t('resources.link.copy')} onClick={() => void copy(displayUrl, 'link')}>
          {copiedId === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </IconAction>
      </span>
    </span>
  );
}

function UnknownResourceCard({
  resource,
  onOpenFilePath,
}: {
  resource: ConversationUnknownResource;
  onOpenFilePath?: (path: string) => void;
}) {
  const { t } = useTranslation('chat');
  const { copiedId, copy } = useCopyToClipboard();
  const location = resource.displayUrl ?? resource.path;
  // Only fields already on the card; the raw payload is never copied.
  const details = [resource.title, resource.description, location, `${t('resources.unknown.typeLabel')}: ${resource.type}`]
    .filter(Boolean)
    .join('\n');

  return (
    <section
      className="w-[480px] max-w-full rounded-lg border border-dashed border-border bg-black/[0.02] px-3 py-2.5 dark:bg-white/[0.03]"
      aria-label={resource.title ?? t('resources.unknown.title')}
      data-testid="chat-resource-unknown"
      data-resource-type={resource.type}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground"><FileQuestion className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-xs font-medium text-foreground">{resource.title ?? t('resources.unknown.title')}</p>
          <p className="text-2xs text-muted-foreground">
            {t('resources.unknown.typeLabel')}: <span className="font-mono">{resource.type}</span>
            {' · '}
            {t('resources.unknown.hint')}
          </p>
          {resource.description && <p className="break-words text-xs text-muted-foreground">{resource.description}</p>}
          {location && <p className="truncate font-mono text-2xs text-muted-foreground" title={location}>{location}</p>}
        </div>
        <div className={cn('flex shrink-0 items-center')}>
          {resource.openUrl && (
            <IconAction
              label={t('resources.link.open')}
              onClick={() => {
                hostApi.shell.openExternal(resource.openUrl!).catch(() => {
                  toast.error(t('resources.media.openFailed'));
                });
              }}
              testId="chat-resource-open-external"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </IconAction>
          )}
          {resource.path && onOpenFilePath && (
            <IconAction label={t('resources.media.openInPanel')} onClick={() => onOpenFilePath(resource.path!)}>
              <FolderOpen className="h-3.5 w-3.5" />
            </IconAction>
          )}
          <IconAction label={t('resources.unknown.copy')} onClick={() => void copy(details, 'details')} testId="chat-resource-copy">
            {copiedId === 'details' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </IconAction>
        </div>
      </div>
    </section>
  );
}

export function ConversationResourceList({
  resources,
  onOpenFilePath,
  allowSidePreview = false,
}: {
  resources: ConversationResource[];
  onOpenFilePath?: (path: string) => void;
  allowSidePreview?: boolean;
}) {
  if (resources.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap gap-2" data-testid="chat-resource-list">
      {resources.map((resource) => {
        if (resource.kind === 'image') {
          return (
            <ConversationImage
              key={resource.key}
              url={resource.url}
              alt={resource.name}
              mimeType={resource.mimeType}
              omitted={resource.omitted}
              bytes={resource.bytes}
            />
          );
        }
        if (resource.kind === 'website-link') {
          return (
            <WebsiteLinkCard
              key={resource.key}
              url={resource.url}
              title={resource.title}
              description={resource.description}
              allowSidePreview={allowSidePreview}
            />
          );
        }
        return <UnknownResourceCard key={resource.key} resource={resource} onOpenFilePath={onOpenFilePath} />;
      })}
    </div>
  );
}
