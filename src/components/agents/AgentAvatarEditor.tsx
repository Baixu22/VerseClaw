import { useEffect, useMemo, useState } from 'react';
import { Dices, RotateCcw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AGENT_AVATAR_BACKGROUNDS,
  defaultAgentAvatarPreset,
} from '@shared/agent-avatar';
import { AGENT_AVATAR_STYLES, type AgentAvatarPreset, type AgentSummary } from '@shared/types/agent';
import { AgentAvatar } from './AgentAvatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

function freshSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function seedCandidates(seed: string): string[] {
  return [seed, `${seed}:2`, `${seed}:3`, `${seed}:4`];
}

function freshSeedCandidates(): string[] {
  return Array.from({ length: 4 }, () => freshSeed());
}

export function AgentAvatarEditor({
  agent,
  saving,
  onSave,
  onReset,
}: {
  agent: AgentSummary;
  saving: boolean;
  onSave: (preset: AgentAvatarPreset) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const initialPreset = useMemo(
    () => agent.avatar?.preset ?? defaultAgentAvatarPreset(agent.id),
    [agent.avatar?.preset, agent.id],
  );
  const [preset, setPreset] = useState<AgentAvatarPreset>(initialPreset);
  const [candidates, setCandidates] = useState<string[]>(() => seedCandidates(initialPreset.seed));

  useEffect(() => {
    setPreset(initialPreset);
    setCandidates(seedCandidates(initialPreset.seed));
  }, [initialPreset]);

  const regenerate = () => {
    const nextCandidates = freshSeedCandidates();
    setCandidates(nextCandidates);
    setPreset((current) => ({ ...current, seed: nextCandidates[0] }));
  };

  const preview = {
    kind: 'dicebear' as const,
    source: 'config' as const,
    preset,
    revision: `${preset.style}:${preset.seed}:${preset.backgroundColor}`,
  };

  return (
    <section className="rounded-2xl border border-black/5 bg-black/[0.025] p-4 dark:border-white/5 dark:bg-white/[0.035]">
      <div className="flex items-start gap-4">
        <AgentAvatar agentId={agent.id} name={agent.name} avatar={preview} size={64} alt={t('avatar.previewAlt', { name: agent.name })} />
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg font-normal tracking-tight text-foreground">{t('avatar.title')}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('avatar.description')}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('avatar.style')}</Label>
          <Select value={preset.style} onValueChange={(style) => setPreset((current) => ({ ...current, style: style as AgentAvatarPreset['style'] }))}>
            <SelectTrigger data-testid="agent-avatar-style" className="bg-surface-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_AVATAR_STYLES.map((style) => <SelectItem key={style} value={style}>{style}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t('avatar.background')}</Label>
          <div className="flex min-h-10 flex-wrap items-center gap-2">
            {AGENT_AVATAR_BACKGROUNDS.map((color) => (
              <button
                key={color}
                type="button"
                data-testid={`agent-avatar-color-${color.slice(1)}`}
                aria-label={t('avatar.backgroundColor', { color })}
                onClick={() => setPreset((current) => ({ ...current, backgroundColor: color }))}
                className={cn(
                  'h-7 w-7 rounded-full border-2 transition-transform hover:scale-105',
                  preset.backgroundColor === color ? 'border-primary ring-2 ring-primary/20' : 'border-background ring-1 ring-border',
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Label>{t('avatar.candidates')}</Label>
        <div className="grid grid-cols-4 gap-2" data-testid="agent-avatar-candidates">
          {candidates.map((seed, index) => {
            const candidatePreset = { ...preset, seed };
            const candidateAvatar = {
              kind: 'dicebear' as const,
              source: 'config' as const,
              preset: candidatePreset,
              revision: `${candidatePreset.style}:${candidatePreset.seed}:${candidatePreset.backgroundColor}`,
            };
            const selected = seed === preset.seed;
            return (
              <button
                key={seed}
                type="button"
                data-testid={`agent-avatar-candidate-${index + 1}`}
                aria-pressed={selected}
                aria-label={t('avatar.candidateAlt', { index: index + 1 })}
                onClick={() => setPreset((current) => ({ ...current, seed }))}
                className={cn(
                  'flex min-w-0 items-center justify-center rounded-xl border bg-surface-input p-2 transition-colors',
                  selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40',
                )}
              >
                <AgentAvatar agentId={agent.id} name={agent.name} avatar={candidateAvatar} size={48} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={regenerate} disabled={saving}>
          <Dices className="mr-1.5 h-4 w-4" />{t('avatar.regenerate')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onReset()} disabled={saving}>
          <RotateCcw className="mr-1.5 h-4 w-4" />{t('avatar.reset')}
        </Button>
        <Button type="button" size="sm" data-testid="agent-avatar-save" onClick={() => void onSave(preset)} disabled={saving}>
          <Save className="mr-1.5 h-4 w-4" />{t('avatar.save')}
        </Button>
      </div>
    </section>
  );
}
