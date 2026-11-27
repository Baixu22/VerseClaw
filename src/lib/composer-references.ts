import type { Root, RootContent } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { evaluateExternalNavigationUrl } from '@shared/security/url-policy';
import { chatSecretRanges, maskChatSecrets } from './chat-display-text';
import { parseGitHubUrl, type GitHubLink } from './github-link';

export type DraftReferenceKind =
  | GitHubLink['type']
  | 'session'
  | 'path'
  | 'npm'
  | 'pypi'
  | 'crate'
  | 'docker'
  | 'figma'
  | 'linear'
  | 'jira'
  | 'arxiv'
  | 'video'
  | 'docs'
  | 'email'
  | 'ip'
  | 'cve'
  | 'website'
  | 'color'
  | 'size';

export type DraftReference = {
  kind: DraftReferenceKind;
  target: string;
  label: string;
  detail?: string;
  /** Optional raw display hint (e.g. hex color, hostname, badge tag). */
  badge?: string;
  /** Optional subtitle/path/owner context for rich cards. */
  sublabel?: string;
  /** Optional source range in the original prompt when extracted directly from flat text. */
  start?: number;
  end?: number;
};

export type PromptSpanKind = 'text' | 'secret' | 'skill' | 'reference' | 'md-syntax' | 'md-heading' | 'md-bold' | 'md-code' | 'md-quote';

export type PromptSpan =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'secret'; text: string; masked: string; start: number; end: number }
  | { kind: 'skill'; text: string; skillName: string; trailingSpace: string; start: number; end: number }
  | { kind: 'reference'; text: string; reference: DraftReference; start: number; end: number }
  | { kind: 'md-syntax' | 'md-heading' | 'md-bold' | 'md-code' | 'md-quote'; text: string; start: number; end: number };

export type SessionIndex = ReadonlyMap<string, { key: string; label: string } | null>;

const markdown = unified().use(remarkParse).freeze();

const tokens =
  /(?:https?:\/\/|(?<![\w./\\@-])www\.|github\.com\/|git@github\.com:)[^\s<>"'`()[\]，。；、！？：）】》]+|(?<![\w./\\-])(?:CVE-\d{4}-\d{4,7}\b|arXiv:\d{4}\.\d{4,5}(?:v\d+)?\b|[\w.+-]+@[a-z\d-]+(?:\.[a-z\d-]+)+|\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?|localhost:\d{1,5}(?:\/[^\s<>"'`()[\]，。；、！？：）】》]*)?|\d{2,5}\s*[x×]\s*\d{2,5}(?:\s*px)?(?![\w.])|#[\da-f]{3,8}(?![\w-])|(?:docker|crate|cargo|npm|pypi|github|repo):[^\s<>"'`()[\]，。；、！？：）】》]+|[A-Z]{2,10}-[1-9]\d{0,6}\b|(?:\.\/)?[\w@-]+(?:(?:==|[./\\:@#])[\w@-]+)*)/gi;

const fileName =
  /(?:\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|c|cpp|h|hpp|cs|rb|php|css|scss|less|vue|svelte|astro|json|jsonl|ya?ml|toml|ini|env|md|mdx|txt|html?|xml|sql|graphql|proto|sh|bash|zsh|ps1|bat|svg|png|jpe?g|webp|gif|ico|pdf|csv|xlsx?|docx?|pptx?|wasm|lock)|^(?:Dockerfile|Makefile|LICENSE|README|Procfile|Gemfile|Rakefile|CMakeLists\.txt))$/i;

const workspaceFolder =
  /^(?:src|lib|app|apps|docs|test|tests|packages|public|dist|build|scripts|assets|node_modules|electron|shared|harness|config|components|pages|hooks|stores|styles|utils|server|client|api|cmd|pkg|internal)\//i;

const DOCS_HOSTS = new Set([
  'developer.mozilla.org',
  'react.dev',
  'nextjs.org',
  'vitejs.dev',
  'typescriptlang.org',
  'tailwindcss.com',
  'nodejs.org',
  'docs.python.org',
  'doc.rust-lang.org',
  'go.dev',
  'kubernetes.io',
  'docs.docker.com',
  'platform.openai.com',
  'docs.anthropic.com',
  'ai.google.dev',
  'electronjs.org',
  'playwright.dev',
  'vitest.dev',
]);

const VIDEO_HOSTS = new Set([
  'youtube.com',
  'youtu.be',
  'bilibili.com',
  'b23.tv',
  'vimeo.com',
  'loom.com',
]);

function trimTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,;:!?。，；：！？）】》]+$/, '');
}

function isValidIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function fileReference(raw: string): DraftReference | undefined {
  const path = raw.replaceAll('\\', '/').replace(/^\.\//, '');
  const location = /^([^:#?]+?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L(\d+))?)?$/.exec(path);
  if (!location) return;
  const parts = location[1].split('/');
  if (parts.some((part) => !part || part === '..' || part === '.') || /[<>|"*\r\n]/.test(location[1])) return;
  const name = parts.at(-1)!;
  if (!fileName.test(name)) return;
  const line = location[2] ?? location[3];
  const suffix = line ? ':' + line + (location[4] ? '–' + location[4] : '') : '';
  const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
  return {
    kind: 'path',
    target: location[1],
    label: maskChatSecrets(name + suffix),
    detail: maskChatSecrets(location[1]),
    sublabel: dir ? maskChatSecrets(dir) : undefined,
    badge: name.includes('.') ? name.split('.').at(-1)?.toUpperCase() : 'FILE',
  };
}

function webReference(raw: string, title?: string): DraftReference | undefined {
  const approved = evaluateExternalNavigationUrl(raw);
  if (!approved.ok) return;
  const url = new URL(approved.href);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const resource = (
    kind: DraftReferenceKind,
    label: string,
    detail = host,
    extra?: { badge?: string; sublabel?: string },
  ): DraftReference => ({
    kind,
    target: url.href,
    label: maskChatSecrets(label),
    detail: maskChatSecrets(detail),
    badge: extra?.badge,
    sublabel: extra?.sublabel ? maskChatSecrets(extra.sublabel) : undefined,
  });

  // GitHub
  const github = parseGitHubUrl(url.href);
  if (github) {
    const [owner, repoName] = github.label.split(' ')[0].split('/');
    return resource(github.type, github.label, github.detail ?? 'github.com', {
      badge: github.type === 'repo' ? 'GitHub' : github.type.toUpperCase(),
      sublabel: github.detail ?? (repoName ? `${owner}/${repoName}` : 'github.com'),
    });
  }

  // npm
  if (host === 'npmjs.com' && parts[0] === 'package' && parts[1]) {
    const scopeLength = parts[1].startsWith('@') && parts[2] ? 2 : 1;
    const name = parts.slice(1, 1 + scopeLength).join('/');
    const version = parts[scopeLength + 1] === 'v' ? parts[scopeLength + 2] : undefined;
    return resource('npm', name, version ? `npm · v${version}` : 'npmjs.com', {
      badge: version ? `v${version}` : 'npm',
      sublabel: 'npmjs.com',
    });
  }

  // PyPI
  if (host === 'pypi.org' && parts[0] === 'project' && parts[1]) {
    const version = parts[2];
    return resource('pypi', parts[1], version ? `PyPI · ${version}` : 'pypi.org', {
      badge: version ? `v${version}` : 'PyPI',
      sublabel: 'pypi.org',
    });
  }

  // crates.io
  if (host === 'crates.io' && parts[0] === 'crates' && parts[1]) {
    const version = parts[2];
    return resource('crate', parts[1], version ? `crates.io · ${version}` : 'crates.io', {
      badge: version ? `v${version}` : 'Cargo',
      sublabel: 'crates.io',
    });
  }

  // Docker Hub / GHCR
  if (host === 'hub.docker.com' && (parts[0] === 'r' || parts[0] === '_') && parts[1]) {
    const image = parts[0] === '_' ? parts[1] : `${parts[1]}/${parts[2] ?? ''}`.replace(/\/$/, '');
    return resource('docker', image, 'hub.docker.com', { badge: 'Docker', sublabel: 'Docker Hub' });
  }

  // Figma
  if (host === 'figma.com' && /^(design|file|proto|board)$/.test(parts[0] ?? '') && parts[1]) {
    let name = parts[2] || 'Figma';
    try { name = decodeURIComponent(name); } catch { /* Preserve malformed slug verbatim. */ }
    const node = url.searchParams.get('node-id');
    return resource('figma', title || name.replace(/-/g, ' '), node && /^[\d:-]+$/.test(node) ? `Figma · ${node}` : 'Figma', {
      badge: parts[0] === 'board' ? 'FigJam' : 'Figma',
      sublabel: node && /^[\d:-]+$/.test(node) ? `node ${node}` : 'figma.com',
    });
  }

  // Linear
  if (host === 'linear.app' && parts[1] === 'issue' && parts[2]) {
    return resource('linear', title || parts[2], `Linear · ${parts[0]}`, {
      badge: 'Linear',
      sublabel: parts[0],
    });
  }

  // Jira
  if ((host.endsWith('.atlassian.net') || host.includes('jira')) && parts[0] === 'browse' && parts[1]) {
    return resource('jira', title || parts[1], `Jira · ${host}`, {
      badge: 'Jira',
      sublabel: host,
    });
  }

  // arXiv
  if (host === 'arxiv.org' && (parts[0] === 'abs' || parts[0] === 'pdf') && parts[1]) {
    const paperId = parts[1].replace(/\.pdf$/i, '');
    return resource('arxiv', title || `arXiv:${paperId}`, 'arxiv.org', {
      badge: 'arXiv',
      sublabel: parts[0] === 'pdf' ? 'PDF Paper' : 'Abstract',
    });
  }

  // Video platforms (YouTube, Bilibili, Loom, Vimeo)
  if (VIDEO_HOSTS.has(host) || host.endsWith('.youtube.com') || host.endsWith('.bilibili.com')) {
    let label = title || host;
    let sublabel = host;
    if (host.includes('youtube.com') && url.searchParams.get('v')) {
      label = title || `YouTube · ${url.searchParams.get('v')}`;
      sublabel = 'youtube.com';
    } else if (host === 'youtu.be' && parts[0]) {
      label = title || `YouTube · ${parts[0]}`;
      sublabel = 'youtu.be';
    } else if (host.includes('bilibili.com') && parts[0] === 'video' && parts[1]) {
      label = title || `Bilibili · ${parts[1]}`;
      sublabel = 'bilibili.com';
    } else if (host === 'loom.com' && parts[0] === 'share' && parts[1]) {
      label = title || `Loom · ${parts[1].slice(0, 8)}`;
      sublabel = 'loom.com';
    }
    return resource('video', label, sublabel, { badge: 'Video', sublabel });
  }

  // Documentation hosts
  if (DOCS_HOSTS.has(host) || host.startsWith('docs.') || parts[0] === 'docs') {
    const readablePath = parts.slice(0, 3).join('/');
    return resource('docs', title || host, readablePath ? `${host}/${readablePath}` : host, {
      badge: 'Docs',
      sublabel: readablePath ? `/${readablePath}` : host,
    });
  }

  // Localhost / IP URLs
  if (host === 'localhost' || host === '127.0.0.1' || isValidIpv4(host)) {
    const hostPort = url.port ? `${host}:${url.port}` : host;
    const pathPart = url.pathname === '/' ? '' : url.pathname;
    return resource('ip', title || hostPort, hostPort + pathPart, {
      badge: host === 'localhost' || host === '127.0.0.1' ? 'LOCAL' : 'IP',
      sublabel: pathPart || url.protocol.replace(':', '').toUpperCase(),
    });
  }

  // Generic website
  const pathPart = url.pathname === '/' ? '' : url.pathname;
  const cleanTitle = title || host;
  return resource('website', cleanTitle, host + pathPart, {
    badge: url.protocol === 'https:' ? 'HTTPS' : 'HTTP',
    sublabel: pathPart || host,
  });
}

function tokenReference(token: string, sessions: SessionIndex, prefix: string, standalone: boolean): DraftReference | undefined {
  const session = sessions.get(token);
  if (session) {
    return {
      kind: 'session',
      target: session.key,
      label: session.label,
      detail: token,
      badge: 'Session',
      sublabel: token,
    };
  }

  // Full URLs, www links and GitHub shorthand.
  if (/^(https?:\/\/|www\.|github\.com\/|git@github\.com:)/i.test(token)) {
    const cleaned = trimTrailingPunctuation(token).replace(/^git@github\.com:/i, 'github.com/');
    return webReference(/^https?:/i.test(cleaned) ? cleaned : 'https://' + cleaned);
  }

  // CVE identifiers
  if (/^CVE-\d{4}-\d{4,7}$/i.test(token)) {
    const id = token.toUpperCase();
    return {
      kind: 'cve',
      target: `https://nvd.nist.gov/vuln/detail/${id}`,
      label: id,
      detail: 'NVD Vulnerability',
      badge: 'CVE',
      sublabel: 'nvd.nist.gov',
    };
  }

  // arXiv shorthand: arXiv:2401.12345
  const arxivMatch = /^arXiv:(\d{4}\.\d{4,5}(?:v\d+)?)$/i.exec(token);
  if (arxivMatch) {
    return webReference(`https://arxiv.org/abs/${arxivMatch[1]}`);
  }

  // Package shorthands (npm, pypi, crate/cargo, docker) — check before email so pkg@1.2.3 is never treated as email.
  const packageText = /(?:\bnpm (?:install|i)|\b(?:pnpm|yarn|bun) add)\s+$/i.test(prefix)
    ? 'npm:' + token
    : /\b(?:pip3?|uv pip) install\s+$/i.test(prefix)
      ? 'pypi:' + token
      : /\bcargo add\s+$/i.test(prefix)
        ? 'crate:' + token
        : /\bdocker (?:pull|run)\s+$/i.test(prefix)
          ? 'docker:' + token
          : token;

  const npm = /^npm:((?:@[\w.-]+\/)?[a-z\d][\w.-]*)(?:@([\w.-]+))?$/i.exec(packageText);
  if (npm) return webReference('https://www.npmjs.com/package/' + npm[1] + (npm[2] ? '/v/' + npm[2] : ''));

  const pypi = /^pypi:([a-z\d][\w.-]*)(?:==([\w.-]+))?$/i.exec(packageText);
  if (pypi) return webReference('https://pypi.org/project/' + pypi[1] + '/' + (pypi[2] ? pypi[2] + '/' : ''));

  const crate = /^(?:crate|cargo):([a-z\d][\w-]*)(?:@([\w.-]+))?$/i.exec(packageText);
  if (crate) return webReference('https://crates.io/crates/' + crate[1] + (crate[2] ? '/' + crate[2] : ''));

  const docker = /^docker:((?:[\w.-]+\/)?[\w.-]+)(?::([\w.-]+))?$/i.exec(packageText);
  if (docker) {
    const img = docker[1];
    const tag = docker[2];
    const url = img.includes('/')
      ? `https://hub.docker.com/r/${img}`
      : `https://hub.docker.com/_/${img}`;
    return {
      kind: 'docker',
      target: url,
      label: tag ? `${img}:${tag}` : img,
      detail: tag ? `Docker · ${tag}` : 'Docker Hub',
      badge: tag || 'Docker',
      sublabel: 'hub.docker.com',
    };
  }

  // Email address (require real alphabetic TLD so pkg@1.2.3 never matches)
  if (/^[\w.+-]+@[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,24}$/i.test(token) && !token.startsWith('git@')) {
    return {
      kind: 'email',
      target: token,
      label: maskChatSecrets(token),
      detail: token.split('@')[1],
      badge: 'Email',
      sublabel: token.split('@')[1],
    };
  }

  // Localhost with port or IPv4(:port)
  if (/^localhost:\d{1,5}(?:\/.*)?$/i.test(token)) {
    const cleaned = trimTrailingPunctuation(token);
    return webReference(`http://${cleaned}`);
  }
  const ipMatch = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(token);
  if (ipMatch && isValidIpv4(ipMatch[1])) {
    const port = ipMatch[2] ? Number(ipMatch[2]) : undefined;
    if (port === undefined || (port >= 1 && port <= 65535)) {
      return {
        kind: 'ip',
        target: port ? `http://${token}` : token,
        label: token,
        detail: port ? `Port ${port}` : 'IPv4 Address',
        badge: ipMatch[1].startsWith('127.') || ipMatch[1].startsWith('10.') || ipMatch[1].startsWith('192.168.') ? 'LAN' : 'IP',
        sublabel: port ? `:${port}` : 'IPv4',
      };
    }
  }

  // GitHub owner/repo (#issue | @commit)
  const repo = /^(?:(?:github|repo):)?([\w-]+\/[\w.-]+)(?:#([1-9]\d*)|@([\da-f]{7,40}))?$/i.exec(token);
  if (repo) {
    const explicit =
      repo[2] ||
      repo[3] ||
      /^(github|repo):/i.test(token) ||
      /(?:\bgithub(?:\s+repo)?|\brepo(?:sitory)?|仓库|项目)[\s:：]*$/i.test(prefix);
    const repoContext =
      standalone || /(?:参考|参照|对照|对比|分析|查看|看下|看看|看|检查|学习|研究|调研|基于|借鉴|克隆|拉取|打开|接入|集成|\breview|\bclone|\bcheck|\binspect|\bopen|\buse)[\s:：]*$/i.test(prefix);
    if (explicit || (repoContext && !workspaceFolder.test(token) && !fileName.test(token))) {
      return webReference(
        'https://github.com/' +
          repo[1] +
          (repo[2] ? '/issues/' + repo[2] : repo[3] ? '/commit/' + repo[3] : ''),
      );
    }
  }

  // Linear / Jira ticket keys like ENG-123, CLAW-42 (avoid common false positives like UTF-8, HTTP-2, SHA-256, ES-2022)
  const ticketMatch = /^([A-Z]{2,8})-([1-9]\d{0,5})$/.exec(token);
  if (ticketMatch && !/^(?:UTF|ISO|HTTP|SHA|MD|ES|ECMA|RFC|JDK|PHP|NODE|WIN|MAC|ARM|X86|B2B|C2C|K8S|L10N|I18N|E2E|PR|QA|UI|UX|AI|ML|OS|IP|DB|IO|CI|CD|V1|V2|V3)$/.test(ticketMatch[1])) {
    const isTicketContext =
      standalone || /(?:issue|ticket|jira|linear|task|bug|fix|单号|工单|需求|任务|问题)[\s:：#]*$/i.test(prefix);
    if (isTicketContext || ticketMatch[1].length >= 3) {
      return {
        kind: 'linear',
        target: token,
        label: token,
        detail: `Issue · ${ticketMatch[1]}`,
        badge: 'Issue',
        sublabel: ticketMatch[1],
      };
    }
  }

  // Hex Color
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(token)) {
    if (/^#\d{3,4}$/.test(token) && !standalone && !/(?:color|colour|background|颜色|色|主色|背景)[\s:：]*$/i.test(prefix)) return;
    const color = token.toUpperCase();
    return {
      kind: 'color',
      target: color,
      label: color,
      detail: 'HEX',
      badge: 'Color',
    };
  }

  // Dimensions / Resolution (e.g. 1280x720, 1920×1080px)
  const size = /^(\d{2,5})\s*[x×]\s*(\d{2,5})(?:\s*px)?$/i.exec(token);
  if (size && +size[1] && +size[2]) {
    const w = +size[1];
    const h = +size[2];
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(w, h);
    const rw = w / d;
    const rh = h / d;
    const ratio = rw <= 32 && rh <= 32 ? `${rw}:${rh}` : `${(w / h).toFixed(2)}:1`;
    return {
      kind: 'size',
      target: `${w}x${h}`,
      label: `${w} × ${h}`,
      detail: `${ratio} · px`,
      badge: ratio,
    };
  }

  // Workspace file path
  if (token.includes('.') || fileName.test(token.split('/').at(-1)!)) return fileReference(token);
}

/** Extract structured references from Markdown prose, keeping fenced code blocks out of the resource list. */
export function collectDraftReferences(text: string, sessions: SessionIndex): DraftReference[] {
  if (!text.trim()) return [];
  const entries = new Map<string, DraftReference>();
  const definitions = new Map<string, string>();
  function add(ref: DraftReference | undefined) {
    if (!ref) return;
    const key = ref.kind + '\0' + ref.target + (ref.kind === 'path' ? '\0' + ref.label : '');
    if (!entries.has(key)) entries.set(key, ref);
  }
  function scan(value: string, exact = false) {
    const trimmed = value.trim();
    const secrets = chatSecretRanges(value);
    if (exact && !secrets.length && /[\s\\]/.test(trimmed) && /^(?:\.\/|[\w.-]+[\\/])/.test(trimmed)) {
      const file = fileReference(trimmed);
      if (file) {
        add(file);
        return;
      }
    }
    let secret = 0;
    for (const match of value.matchAll(tokens)) {
      if (exact && match[0] !== value) continue;
      while (secret < secrets.length && secrets[secret].end <= match.index) secret++;
      if (secrets[secret] && secrets[secret].start <= match.index) continue;
      add(
        tokenReference(
          match[0],
          sessions,
          value.slice(Math.max(0, match.index - 32), match.index),
          match[0] === trimmed,
        ),
      );
    }
  }
  function visit(node: Root | RootContent, collectDefinitions: boolean) {
    if (node.type === 'definition') {
      if (collectDefinitions && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
      return;
    }
    if (!collectDefinitions) {
      if (node.type === 'link' || node.type === 'linkReference') {
        const url = node.type === 'link' ? node.url : definitions.get(node.identifier);
        const label = node.children.length === 1 && node.children[0].type === 'text' ? node.children[0].value : undefined;
        if (url) add(webReference(url, label === url ? undefined : label) ?? fileReference(url));
        return;
      }
      if (node.type === 'text' || node.type === 'inlineCode') {
        scan(node.value, node.type === 'inlineCode');
        return;
      }
    }
    if ('children' in node) node.children.forEach((child) => visit(child, collectDefinitions));
  }
  // Most drafts are prose. Parse Markdown only when its boundaries affect extraction.
  if (!/[`~[<>\\]|^(?: {4}|\t)/m.test(text)) scan(text);
  else {
    const tree = markdown.parse(text);
    if (text.includes(']:')) visit(tree, true);
    visit(tree, false);
  }
  return [...entries.values()];
}

/**
 * Scan flat prompt text into non-overlapping spans for direct in-composer rich rendering
 * (secrets masked in-place, skill tokens highlighted, and recognized references decorated
 * with exact character positions so caret alignment in the editor remains 1:1).
 */
export function segmentPromptSpans(
  text: string,
  sessions: SessionIndex,
  skillRanges: ReadonlyArray<{ start: number; end: number }> = [],
): PromptSpan[] {
  if (!text) return [];
  const secrets = chatSecretRanges(text);

  type Candidate = PromptSpan & { priority: number };
  const candidates: Candidate[] = [];

  // Priority 3: secrets (highest - never leak a secret inside a link/token)
  for (const s of secrets) {
    const raw = text.slice(s.start, s.end);
    candidates.push({
      kind: 'secret',
      text: raw,
      masked: '•'.repeat(raw.length),
      start: s.start,
      end: s.end,
      priority: 3,
    });
  }

  // Priority 2: skill tokens
  for (const r of skillRanges) {
    const raw = text.slice(r.start, r.end);
    const label = raw.trimEnd();
    const trailingSpace = raw.slice(label.length);
    const skillName = label.startsWith('/') ? label.slice(1) : label;
    candidates.push({
      kind: 'skill',
      text: label,
      skillName,
      trailingSpace,
      start: r.start,
      end: r.end,
      priority: 2,
    });
  }

  // Find fenced code blocks to avoid decorating code examples as interactive links
  const fencedRanges: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\s*$|$)/gm)) {
    fencedRanges.push({ start: m.index, end: m.index + m[0].length });
  }
  const inFence = (pos: number) => fencedRanges.some((r) => pos >= r.start && pos < r.end);

  // Priority 1: inline references
  const trimmed = text.trim();
  for (const match of text.matchAll(tokens)) {
    const start = match.index;
    const raw = match[0];
    const end = start + raw.length;
    if (inFence(start)) continue;
    const ref = tokenReference(
      raw,
      sessions,
      text.slice(Math.max(0, start - 32), start),
      raw === trimmed,
    );
    if (!ref) continue;
    candidates.push({
      kind: 'reference',
      text: raw,
      reference: { ...ref, start, end },
      start,
      end,
      priority: 1,
    });
  }

  // Priority 0: lightweight 1:1 inline Markdown styling (never changes glyph widths so caret stays aligned)
  for (const match of text.matchAll(/^( {0,3}#{1,6}[ \t]+)(.+)$/gm)) {
    if (inFence(match.index)) continue;
    const markerStart = match.index;
    const markerEnd = markerStart + match[1].length;
    const titleEnd = markerEnd + match[2].length;
    candidates.push({ kind: 'md-syntax', text: match[1], start: markerStart, end: markerEnd, priority: 0 });
    candidates.push({ kind: 'md-heading', text: match[2], start: markerEnd, end: titleEnd, priority: 0 });
  }
  for (const match of text.matchAll(/^( {0,3}>[ \t]?)(.*)$/gm)) {
    if (inFence(match.index)) continue;
    const markerStart = match.index;
    const markerEnd = markerStart + match[1].length;
    const bodyEnd = markerEnd + match[2].length;
    candidates.push({ kind: 'md-syntax', text: match[1], start: markerStart, end: markerEnd, priority: 0 });
    if (match[2].length > 0) {
      candidates.push({ kind: 'md-quote', text: match[2], start: markerEnd, end: bodyEnd, priority: 0 });
    }
  }
  for (const match of text.matchAll(/^( {0,3}(?:[-*+] \[[ xX]\]|[-*+]|\d+[.)])[ \t]+)/gm)) {
    if (inFence(match.index)) continue;
    candidates.push({ kind: 'md-syntax', text: match[1], start: match.index, end: match.index + match[1].length, priority: 0 });
  }
  for (const match of text.matchAll(/(`)([^`\n]+)(`)/g)) {
    if (inFence(match.index)) continue;
    candidates.push({ kind: 'md-code', text: match[0], start: match.index, end: match.index + match[0].length, priority: 0 });
  }
  for (const match of text.matchAll(/(\*\*)([^*\n]+)(\*\*)/g)) {
    if (inFence(match.index)) continue;
    const s = match.index;
    candidates.push({ kind: 'md-syntax', text: match[1], start: s, end: s + 2, priority: 0 });
    candidates.push({ kind: 'md-bold', text: match[2], start: s + 2, end: s + 2 + match[2].length, priority: 0 });
    candidates.push({ kind: 'md-syntax', text: match[3], start: s + 2 + match[2].length, end: s + match[0].length, priority: 0 });
  }

  // Resolve overlaps: higher priority wins, then earlier start, then longer match
  candidates.sort((a, b) => b.priority - a.priority || a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const accepted: PromptSpan[] = [];
  for (const item of candidates) {
    if (accepted.some((other) => item.start < other.end && item.end > other.start)) continue;
    accepted.push(item);
  }
  accepted.sort((a, b) => a.start - b.start);

  const result: PromptSpan[] = [];
  let cursor = 0;
  for (const span of accepted) {
    if (span.start > cursor) {
      result.push({ kind: 'text', text: text.slice(cursor, span.start), start: cursor, end: span.start });
    }
    result.push(span);
    cursor = span.end;
  }
  if (cursor < text.length) {
    result.push({ kind: 'text', text: text.slice(cursor), start: cursor, end: text.length });
  }
  return result;
}
