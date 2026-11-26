export type GitHubLink = {
  type: 'repo' | 'issue' | 'pr' | 'commit' | 'profile' | 'file' | 'release' | 'other';
  label: string;
  detail?: string;
};

export function parseGitHubUrl(href: string): GitHubLink | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !/^(www\.)?github\.com$/.test(url.hostname)) return null;
  const [owner, name, section, id, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner) return null;
  if (!name) return { type: 'profile', label: owner };
  const repo = `${owner}/${name.replace(/\.git$/, '')}`;
  if (!section) return { type: 'repo', label: repo };
  if ((section === 'issues' || section === 'pull') && /^\d+$/.test(id ?? '')) {
    return { type: section === 'pull' ? 'pr' : 'issue', label: `${repo} #${id}` };
  }
  if (section === 'commit' && id) return { type: 'commit', label: `${repo} ${id.slice(0, 7)}` };
  if (section === 'blob' && rest.length) {
    const lines = /^#L\d+(?:-L\d+)?$/.test(url.hash) ? ' ' + url.hash.slice(1) : '';
    return { type: 'file', label: rest.at(-1)! + lines, detail: [repo, id, ...rest].join('/') };
  }
  if (section === 'releases' && id === 'tag' && rest.length) return { type: 'release', label: `${repo} · ${rest.join('/')}` };
  return { type: 'other', label: repo, detail: [section, id, ...rest].filter(Boolean).join('/') };
}
