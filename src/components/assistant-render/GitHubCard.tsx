import { ExternalLink, Github, GitPullRequest, GitCommitHorizontal, CircleDot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '@/lib/host-api';

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
    if (!parts[0]) return null;
    const owner = parts[0];
    if (parts.length === 1) return { type: 'profile', owner };
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
      : `${info.owner}/${info.repo}${info.id ? ` ${info.id}` : ''}`;

  const typeLabel = t(`githubCard.type.${info.type}`, info.type);
  const Icon = info.type === 'pr' ? GitPullRequest : info.type === 'commit' ? GitCommitHorizontal : info.type === 'issue' ? CircleDot : Github;

  return (
    <button
      type="button"
      onClick={() => void hostApi.shell.openExternal(url)}
      className="git-surface git-link-card"
      title={url}
    >
      <span className="git-icon"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="git-link-label block font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{typeLabel}</span>
      </span>
      <ExternalLink className="git-link-external h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
