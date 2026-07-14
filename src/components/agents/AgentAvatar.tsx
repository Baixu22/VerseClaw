import { useMemo, useState } from 'react';
import { Bot, CheckCircle2, FileText, Search, ShieldCheck, TestTube2, Wrench } from 'lucide-react';
import { defaultAgentAvatarView, renderAgentAvatarDataUri } from '@shared/agent-avatar';
import type { AgentAvatarView } from '@shared/types/agent';
import { cn } from '@/lib/utils';
import { roleTone, toneClasses } from '@/lib/role-visuals';
import characterImg from '@/assets/logo+character.png';
import characterDarkImg from '@/assets/logo+character-dark.png';

type AgentAvatarProps = {
  agentId: string;
  name: string;
  avatar?: AgentAvatarView;
  size?: number;
  alt?: string;
  className?: string;
};

export function AgentAvatar({ agentId, name, avatar, size = 32, alt = '', className }: AgentAvatarProps) {
  const resolvedAvatar = avatar ?? defaultAgentAvatarView(agentId);
  const avatarKey = `${resolvedAvatar.kind}:${resolvedAvatar.revision ?? ''}:${resolvedAvatar.uri ?? ''}`;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const failed = failedKey === avatarKey;
  const markFailed = () => setFailedKey(avatarKey);
  const dicebearUri = useMemo(() => {
    if (!resolvedAvatar.preset || (resolvedAvatar.kind !== 'dicebear' && resolvedAvatar.kind !== 'fallback')) return null;
    return renderAgentAvatarDataUri(agentId, resolvedAvatar.preset, Math.max(64, size * 2));
  }, [agentId, resolvedAvatar.kind, resolvedAvatar.preset, size]);
  const uri = resolvedAvatar.kind === 'image' ? resolvedAvatar.uri : dicebearUri;
  const initials = name.trim().slice(0, 2).toUpperCase() || 'AI';
  const classes = cn(
    'relative shrink-0 overflow-hidden rounded-full bg-surface-input ring-1 ring-border',
    className,
  );
  const style = { width: size, height: size };

  if (resolvedAvatar.kind === 'brand' && !failed) {
    return (
      <span className={classes} style={style} data-testid={`agent-avatar-${agentId}`}>
        <img src={characterImg} alt={alt} className="block h-full w-full object-cover dark:hidden" onError={markFailed} />
        <img src={characterDarkImg} alt={alt} className="hidden h-full w-full object-cover dark:block" onError={markFailed} />
      </span>
    );
  }

  return (
    <span className={classes} style={style} data-testid={`agent-avatar-${agentId}`}>
      {!failed && uri ? (
        <img src={uri} alt={alt} draggable={false} className="h-full w-full object-cover" onError={markFailed} />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-primary/10 text-[0.65em] font-semibold text-primary">
          {initials}
        </span>
      )}
    </span>
  );
}

function RoleIcon({ roleName, className }: { roleName: string; className?: string }) {
  const normalized = roleName.toLowerCase();
  if (normalized.includes('test')) return <TestTube2 className={className} />;
  if (normalized.includes('review') || normalized.includes('verify')) return <CheckCircle2 className={className} />;
  if (normalized.includes('security')) return <ShieldCheck className={className} />;
  if (normalized.includes('doc')) return <FileText className={className} />;
  if (normalized.includes('explor') || normalized.includes('research')) return <Search className={className} />;
  if (normalized.includes('implement') || normalized.includes('coder')) return <Wrench className={className} />;
  return <Bot className={className} />;
}

export function RoleBadge({ roleName, size = 18, className }: { roleName: string; size?: number; className?: string }) {
  const tone = toneClasses(roleTone(roleName));
  return (
    <span
      title={roleName}
      aria-label={roleName}
      className={cn('flex shrink-0 items-center justify-center rounded-full border-2 border-background shadow-sm', tone.tint, tone.text, className)}
      style={{ width: size, height: size }}
      data-testid={`role-badge-${roleName}`}
    >
      <RoleIcon roleName={roleName} className="h-[55%] w-[55%]" />
    </span>
  );
}


export function AgentRoleIdentity({
  agentId,
  name,
  avatar,
  roleName,
  size = 32,
  className,
}: {
  agentId: string;
  name: string;
  avatar?: AgentAvatarView;
  roleName: string;
  size?: number;
  className?: string;
}) {
  const badgeSize = Math.max(14, Math.round(size * 0.48));
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
      data-testid={`agent-role-identity-${agentId}`}
    >
      <AgentAvatar agentId={agentId} name={name} avatar={avatar} size={size} />
      <RoleBadge
        roleName={roleName}
        size={badgeSize}
        className="absolute -bottom-0.5 -right-0.5"
      />
    </span>
  );
}
