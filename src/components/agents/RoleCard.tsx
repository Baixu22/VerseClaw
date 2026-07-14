// Role card for the RolesOrchestrationPanel: shows a role contract with
// effort-tone badge, tool count, and (when selected) a detailed expansion with
// the tool allowlist grid, permission trio, and a compiled-SOUL preview.
//
// Visual language mirrors the project design tokens (globals.css):
// - selected card: border-primary bg-primary/5
// - idle card: border-transparent bg-black/5 dark:bg-white/5 hover lift
// - tool chips: bg-surface-input font-mono text-2xs
// - permission icons use status-color convention (*-700 dark:*-400)
import { useState } from 'react';
import { ChevronDown, FileText, Globe, Terminal, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { effortTone, toneClasses } from '@/lib/role-visuals';
import { hostApi } from '@/lib/host-api';
import { RoleBadge } from './AgentAvatar';

export type RoleCardData = {
  name: string;
  displayName: string;
  description?: string;
  rolePrompt: string;
  tools: string[];
  effort: string;
  permissions?: { filesystem?: string; network?: string; commands?: string[] };
  tags?: string[];
  /** Role origin (Area 1): 'built-in' ships with the runtime, 'config' is user-defined. */
  origin?: 'built-in' | 'config';
};

type RoleCardProps = {
  role: RoleCardData;
  selected: boolean;
  onSelect: () => void;
  /** Translation helper that returns a localized string with inline default. */
  tt: (key: string, defaultValue: string, vars?: Record<string, unknown>) => string;
};

function permissionTone(value: string | undefined, kind: 'filesystem' | 'network'): string {
  if (!value) return 'text-muted-foreground';
  if (kind === 'filesystem') {
    if (value === 'read') return 'text-emerald-700 dark:text-emerald-400';
    if (value === 'read-write' || value === 'write') return 'text-amber-700 dark:text-amber-400';
    return 'text-muted-foreground';
  }
  // network
  if (value === 'none') return 'text-emerald-700 dark:text-emerald-400';
  if (value === 'limited') return 'text-amber-700 dark:text-amber-400';
  if (value === 'full') return 'text-red-700 dark:text-red-400';
  return 'text-muted-foreground';
}

export function RoleCard({ role, selected, onSelect, tt }: RoleCardProps) {
  const [soulOpen, setSoulOpen] = useState(false);
  const [soulLoading, setSoulLoading] = useState(false);
  const [soulText, setSoulText] = useState<string | null>(null);
  const tone = effortTone(role.effort);

  const loadSoul = async () => {
    if (soulText !== null) {
      setSoulOpen((prev) => !prev);
      return;
    }
    setSoulLoading(true);
    try {
      const result = await hostApi.gateway.rpc<{ soul?: string }>('roles.get', { name: role.name });
      const soul = (result as { soul?: string })?.soul ?? '';
      setSoulText(soul);
      setSoulOpen(true);
    } catch {
      setSoulText('');
      setSoulOpen(true);
    } finally {
      setSoulLoading(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'text-left rounded-xl border p-3 transition-colors w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-transparent bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <RoleBadge roleName={role.name} size={22} />
          <span className="font-medium text-sm truncate">{role.displayName}</span>
          {role.origin && (
            <span
              data-testid={`role-origin-badge-${role.origin}`}
              className={cn(
                'text-2xs rounded-md px-1 py-0.5 shrink-0',
                role.origin === 'config'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-surface-input text-muted-foreground',
              )}
            >
              {role.origin === 'config'
                ? tt('roles.originCustom', 'Custom')
                : tt('roles.originBuiltIn', 'Built-in')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-2xs text-muted-foreground tabular-nums">
            {role.tools.length} {tt('roles.toolsUnit', 'tools')}
          </span>
          <Badge variant="secondary" className={cn('text-2xs rounded-full', toneClasses(tone).tint, 'border')}>
            {role.effort}
          </Badge>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
        {role.description || role.rolePrompt}
      </p>

      {/* Expanded detail */}
      {selected && (
        <div className="mt-2 pt-2 border-t border-black/5 dark:border-white/5 space-y-2">
          {/* Tool allowlist grid */}
          {role.tools.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {role.tools.map((tool) => (
                <span
                  key={tool}
                  className="text-2xs font-mono rounded-md bg-surface-input px-1.5 py-0.5 text-muted-foreground"
                >
                  {tool}
                </span>
              ))}
            </div>
          )}

          {/* Permission trio */}
          {role.permissions && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
              <span className={cn('flex items-center gap-1', permissionTone(role.permissions.filesystem, 'filesystem'))}>
                <FileText className="h-3 w-3" />
                <span>{role.permissions.filesystem ?? '—'}</span>
              </span>
              <span className={cn('flex items-center gap-1', permissionTone(role.permissions.network, 'network'))}>
                <Globe className="h-3 w-3" />
                <span>{role.permissions.network ?? '—'}</span>
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Terminal className="h-3 w-3" />
                <span>{role.permissions.commands?.length ?? 0}</span>
              </span>
            </div>
          )}

          {/* SOUL preview toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-2xs px-2 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              void loadSoul();
            }}
            disabled={soulLoading}
          >
            <ShieldCheck className="h-3 w-3 mr-1" />
            {tt('roles.viewContract', 'View contract')}
            <ChevronDown className={cn('h-3 w-3 ml-0.5 transition-transform', soulOpen && 'rotate-180')} />
          </Button>

          {soulOpen && soulText !== null && (
            <pre className="font-mono text-2xs text-muted-foreground bg-surface-input rounded-xl p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
              {soulText || tt('roles.soulEmpty', '(no compiled output)')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default RoleCard;
