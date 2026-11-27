import { Github, GitPullRequest, GitCommitHorizontal, CircleDot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { hostApi } from '@/lib/host-api';
import { maskChatSecrets } from '@/lib/chat-display-text';
import { parseGitHubUrl } from '@/lib/github-link';

export function GitHubCard({ url }: { url: string }) {
  const { t } = useTranslation('chat');
  const info = parseGitHubUrl(url);
  if (!info) return null;

  const Icon = info.type === 'pr' ? GitPullRequest : info.type === 'commit' ? GitCommitHorizontal : info.type === 'issue' ? CircleDot : Github;
  const label = maskChatSecrets(info.label);

  return (
    <button type="button" className="chat-github-reference" data-testid="chat-resource-github-link" data-kind={info.type} title={label}
      onClick={async () => {
        try { await hostApi.shell.openExternal(url); }
        catch { toast.error(t('resources.media.openFailed')); }
      }}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
