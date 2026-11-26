import {
  ArrowUpRight,
  BookOpen,
  Box,
  Braces,
  Check,
  CircleDot,
  Container,
  Copy,
  ExternalLink,
  Figma,
  FileCode2,
  GitCommitHorizontal,
  Github,
  GitPullRequest,
  Globe,
  Mail,
  MessagesSquare,
  Package,
  PlayCircle,
  Server,
  ShieldAlert,
  Tag,
  Ticket,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/components/tool-ui/shared/use-copy-to-clipboard';
import type { DraftReference, DraftReferenceKind } from '@/lib/composer-references';
import { hostApi } from '@/lib/host-api';

const icons: Record<Exclude<DraftReferenceKind, 'color' | 'size'>, LucideIcon> = {
  repo: Github,
  other: Github,
  profile: Github,
  issue: CircleDot,
  pr: GitPullRequest,
  commit: GitCommitHorizontal,
  file: FileCode2,
  release: Tag,
  session: MessagesSquare,
  path: FileCode2,
  npm: Package,
  pypi: Braces,
  crate: Box,
  docker: Container,
  figma: Figma,
  linear: Ticket,
  jira: Ticket,
  arxiv: FileText,
  video: PlayCircle,
  docs: BookOpen,
  email: Mail,
  ip: Server,
  cve: ShieldAlert,
  website: Globe,
};

function KindMark({ reference }: { reference: DraftReference }) {
  if (reference.kind === 'color') {
    return (
      <span
        className="draft-color-swatch"
        style={{ backgroundColor: reference.target }}
      />
    );
  }
  if (reference.kind === 'size') {
    const [w, h] = reference.target.split('x').map(Number);
    const maxDim = 16;
    const width = Math.max(4, Math.round(maxDim * Math.min(1, w / h)));
    const height = Math.max(4, Math.round(maxDim * Math.min(1, h / w)));
    return (
      <span
        className="draft-size-sample"
        style={{ width, height }}
      />
    );
  }
  const Icon = icons[reference.kind];
  return <Icon size={15} strokeWidth={1.7} />;
}

function draftKindKey(kind: DraftReferenceKind): string {
  return ['repo', 'other', 'profile', 'issue', 'pr', 'commit', 'file', 'release'].includes(kind)
    ? 'githubCard.type.' + kind
    : 'composer.draftKinds.' + kind;
}

function isCopyableKind(kind: DraftReferenceKind): boolean {
  return kind === 'color' || kind === 'size' || kind === 'email' || kind === 'linear';
}

export function DraftReferenceRow({
  reference,
  openSession,
  openFile,
}: {
  reference: DraftReference;
  openSession?: (key: string) => void;
  openFile?: (path: string) => void;
}) {
  const { t } = useTranslation('chat');
  const { copiedId, copy } = useCopyToClipboard();
  const { kind, target, label, detail, badge, sublabel } = reference;
  const isUrl = /^https?:\/\//i.test(target);
  const copyable = isCopyableKind(kind) || (kind === 'ip' && !isUrl);
  const local = kind === 'path' || kind === 'session';
  const kindName = t(draftKindKey(kind));
  const copied = copiedId === target;

  const onClick = () => {
    if (kind === 'session') openSession?.(target);
    else if (kind === 'path') openFile?.(target);
    else if (copyable) void copy(label, target);
    else if (isUrl) void hostApi.shell.openExternal(target).catch(() => toast.error(t('resources.media.openFailed')));
    else void copy(label, target);
  };

  const actionable = kind === 'session' ? !!openSession : kind === 'path' ? !!openFile : true;
  const ActionIcon = copyable
    ? (copied ? Check : Copy)
    : local
      ? ArrowUpRight
      : ExternalLink;

  const metaDetail = sublabel && sublabel !== label && sublabel !== kindName
    ? sublabel
    : detail && detail !== kindName && detail !== label
      ? detail
      : undefined;
  const typeDetail = (kind === 'size' || (badge && /^v\d/.test(badge))) ? badge : kindName;

  const contents = (
    <>
      <span className="draft-reference-mark" aria-hidden="true">
        <KindMark reference={reference} />
      </span>
      <span className="draft-reference-text">
        <span className="draft-reference-title">{label}</span>
        {metaDetail && kind !== 'size' && kind !== 'color' && kind !== 'session' && <span className="draft-reference-detail">{metaDetail}</span>}
      </span>
      {kind !== 'session' && <span className="draft-reference-kind">{typeDetail}</span>}
      {actionable && (
        <ActionIcon className="draft-reference-action" aria-hidden="true" size={13} />
      )}
    </>
  );

  const description = [kindName, label, metaDetail].filter(Boolean).join(' · ');

  if (!actionable) {
    return (
      <span className="draft-reference-row" data-kind={kind} title={description}>
        {contents}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="draft-reference-row"
      data-kind={kind}
      data-copied={copied ? 'true' : undefined}
      onClick={onClick}
      title={description}
      aria-label={copyable ? t('composer.draftCopyValue', { value: label }) : `${kindName} · ${label}`}
    >
      {contents}
    </button>
  );
}
