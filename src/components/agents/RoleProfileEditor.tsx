/**
 * RoleProfileEditor — Structured agent role editor that compiles to SOUL.md
 * Uses shadcn-style Select for styled dropdowns.
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AgentRoleProfile } from '@shared/types/agent';

const ROLE_OPTIONS = [
  { labelKey: 'roleProfile.roles.general', value: '通用助手' },
  { labelKey: 'roleProfile.roles.coding', value: '代码助手' },
  { labelKey: 'roleProfile.roles.writing', value: '写作伙伴' },
  { labelKey: 'roleProfile.roles.devops', value: 'DevOps' },
  { labelKey: 'roleProfile.roles.review', value: '代码审查' },
  { labelKey: 'roleProfile.roles.architecture', value: '架构设计' },
  { labelKey: 'roleProfile.roles.analysis', value: '数据分析' },
  { labelKey: 'roleProfile.roles.custom', value: '自定义' },
];

const VERBOSITY_OPTIONS: { value: AgentRoleProfile['verbosity']; labelKey: string; hintKey: string }[] = [
  { value: 'concise', labelKey: 'roleProfile.verbosity.concise', hintKey: 'roleProfile.verbosityHint.concise' },
  { value: 'balanced', labelKey: 'roleProfile.verbosity.balanced', hintKey: 'roleProfile.verbosityHint.balanced' },
  { value: 'detailed', labelKey: 'roleProfile.verbosity.detailed', hintKey: 'roleProfile.verbosityHint.detailed' },
];

const TONE_OPTIONS: { value: AgentRoleProfile['tone']; labelKey: string; hintKey: string }[] = [
  { value: 'friendly', labelKey: 'roleProfile.tone.friendly', hintKey: 'roleProfile.toneHint.friendly' },
  { value: 'direct', labelKey: 'roleProfile.tone.direct', hintKey: 'roleProfile.toneHint.direct' },
  { value: 'formal', labelKey: 'roleProfile.tone.formal', hintKey: 'roleProfile.toneHint.formal' },
  { value: 'casual', labelKey: 'roleProfile.tone.casual', hintKey: 'roleProfile.toneHint.casual' },
];

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const { t } = useTranslation('agents');
  const [input, setInput] = useState('');

  const addTag = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInput('');
  }, [input, tags, onChange]);

  const removeTag = useCallback((tag: string) => void onChange(tags.filter((t) => t !== tag)), [tags, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          placeholder={placeholder}
          className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="sm" onClick={addTag}
              className="rounded-xl h-9 px-3 bg-transparent border-black/10 dark:border-white/10">
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('roleProfile.addTag')}</TooltipContent>
        </Tooltip>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Tooltip key={tag}>
              <TooltipTrigger asChild>
                <Badge variant="secondary"
                  className="rounded-full px-3 py-1 gap-1 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                  onClick={() => removeTag(tag)}>
                  {tag}<X className="h-3 w-3" />
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{t('roleProfile.removeTag', { tag })}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

interface RoleProfileEditorProps {
  profile: AgentRoleProfile;
  onChange: (profile: AgentRoleProfile) => void;
  disabled?: boolean;
}

export function RoleProfileEditor({ profile, onChange, disabled }: RoleProfileEditorProps) {
  const { t } = useTranslation('agents');
  const update = useCallback((patch: Partial<AgentRoleProfile>) => onChange({ ...profile, ...patch }), [profile, onChange]);
  const currentRoleValue = profile.customRole ? '自定义' : profile.role;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium text-foreground/80">{t('roleProfile.displayName')}</Label>
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent>{t('roleProfile.displayNameTooltip')}</TooltipContent>
            </Tooltip>
          </div>
          <Input value={profile.displayName} onChange={(e) => update({ displayName: e.target.value })}
            placeholder={t('roleProfile.displayNamePlaceholder')} disabled={disabled}
            className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium text-foreground/80">{t('roleProfile.role')}</Label>
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent>{t('roleProfile.roleTooltip')}</TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={currentRoleValue}
            onValueChange={(value) => {
              if (value === '自定义') update({ role: value, customRole: '' });
              else update({ role: value, customRole: undefined });
            }}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 w-full rounded-xl border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-4 text-sm focus:ring-2 focus:ring-primary/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {profile.role === '自定义' && (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground/80">{t('roleProfile.customRole')}</Label>
          <Input value={profile.customRole || ''} onChange={(e) => update({ customRole: e.target.value })}
            placeholder={t('roleProfile.customRolePlaceholder')} disabled={disabled}
            className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-semibold text-foreground/80">{t('roleProfile.replyStyle')}</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>{t('roleProfile.replyStyleTooltip')}</TooltipContent>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t('roleProfile.verbosityLabel')}</Label>
            <div className="flex gap-2">
              {VERBOSITY_OPTIONS.map((opt) => (
                <Tooltip key={opt.value}>
                  <TooltipTrigger asChild>
                    <Button type="button" variant={profile.verbosity === opt.value ? 'secondary' : 'outline'} size="sm"
                      disabled={disabled} className="rounded-full px-3 h-8"
                      onClick={() => update({ verbosity: opt.value })}>{t(opt.labelKey)}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{t(opt.hintKey)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t('roleProfile.toneLabel')}</Label>
            <div className="flex gap-2">
              {TONE_OPTIONS.map((opt) => (
                <Tooltip key={opt.value}>
                  <TooltipTrigger asChild>
                    <Button type="button" variant={profile.tone === opt.value ? 'secondary' : 'outline'} size="sm"
                      disabled={disabled} className="rounded-full px-3 h-8"
                      onClick={() => update({ tone: opt.value })}>{t(opt.labelKey)}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{t(opt.hintKey)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('roleProfile.language')}</Label>
          <Input value={profile.language} onChange={(e) => update({ language: e.target.value })}
            placeholder={t('roleProfile.languagePlaceholder')} disabled={disabled}
            className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium text-foreground/80">{t('roleProfile.expertise')}</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>{t('roleProfile.expertiseTooltip')}</TooltipContent>
          </Tooltip>
        </div>
        <TagInput tags={profile.expertise} onChange={(tags) => update({ expertise: tags })}
          placeholder={t('roleProfile.expertisePlaceholder')} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium text-foreground/80">{t('roleProfile.limitations')}</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>{t('roleProfile.limitationsTooltip')}</TooltipContent>
          </Tooltip>
        </div>
        <TagInput tags={profile.limitations} onChange={(tags) => update({ limitations: tags })}
          placeholder={t('roleProfile.limitationsPlaceholder')} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium text-foreground/80">{t('roleProfile.backstory')}</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>{t('roleProfile.backstoryTooltip')}</TooltipContent>
          </Tooltip>
        </div>
        <Textarea value={profile.backstory} onChange={(e) => update({ backstory: e.target.value })}
          placeholder={t('roleProfile.backstoryPlaceholder')} disabled={disabled} rows={3}
          className="rounded-xl bg-black/5 dark:bg-white/5 border-transparent resize-none" />
      </div>
    </div>
  );
}

export default RoleProfileEditor;
