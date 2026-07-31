import { ExternalLink, Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';

interface GitHubLinkInfo {
  type: 'repo' | 'issue' | 'pr' | 'commit' | 'profile' | 'other';
  owner: string;
  repo?: string;
  id?: string;
}

function parseGitHubUrl(url: string): GitHubLinkInfo | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./i, '') !== 'github.com') return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    const owner = parts[0];
    const second = parts[1];

    if (parts.length === 2) {
      return { type: 'repo', owner, repo: second };
    }
    if (parts.length >= 3) {
      const third = parts[2];
      if (third === 'issues' && parts[3]) {
        return { type: 'issue', owner, repo: second, id: `#${parts[3]}` };
      }
      if (third === 'pull' && parts[3]) {
        return { type: 'pr', owner, repo: second, id: `#${parts[3]}` };
      }
      if (third === 'commit' && parts[3]) {
        return { type: 'commit', owner, repo: second, id: parts[3].substring(0, 7) };
      }
      return { type: 'other', owner, repo: second };
    }
    return { type: 'profile', owner };
  } catch {
    return null;
  }
}

export function GitHubCard({ url }: { url: string }) {
  const { t } = useTranslation('chat');
  const info = parseGitHubUrl(url);
  if (!info) return null;

  const label = info.type === 'repo'
    ? `${info.owner}/${info.repo}`
    : info.type === 'profile'
      ? info.owner
      : `${info.owner}/${info.repo} ${info.id}`;

  const typeLabel = t(`githubCard.type.${info.type}`, info.type);

  return (
    <button
      type="button"
      onClick={() => void hostApi.shell.openExternal(url)}
      className={cn(
        'group inline-flex max-w-full items-center gap-2.5 rounded-lg border border-conversation px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/10',
      )}
    >
      <Github className="h-4 w-4 shrink-0 text-foreground/70" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{typeLabel}</span>
      </span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/**
 * Check if a URL points to GitHub. Used in markdown link components to
 * decide whether to render inline or as a GitHubCard.
 */
export function isGitHubUrl(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.hostname.replace(/^www\./i, '') === 'github.com';
  } catch {
    return false;
  }
}

export function getGitHubCardLabel(href: string): string | null {
  const info = parseGitHubUrl(href);
  if (!info) return null;
  return info.type === 'repo'
    ? `${info.owner}/${info.repo}`
    : `${info.owner}/${info.repo}`;
}
