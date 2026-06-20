/**
 * RoleProfileEditor — Structured agent role editor that compiles to SOUL.md
 * Uses shadcn-style Select for styled dropdowns.
 */
import { useState, useCallback } from 'react';
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
  { label: '通用助手', value: '通用助手' },
  { label: '代码助手', value: '代码助手' },
  { label: '写作伙伴', value: '写作伙伴' },
  { label: 'DevOps', value: 'DevOps' },
  { label: '代码审查', value: '代码审查' },
  { label: '架构设计', value: '架构设计' },
  { label: '数据分析', value: '数据分析' },
  { label: '自定义', value: '自定义' },
];

const VERBOSITY_OPTIONS: { value: AgentRoleProfile['verbosity']; label: string; hint: string }[] = [
  { value: 'concise', label: '简洁', hint: '回复内容尽量简短' },
  { value: 'balanced', label: '适中', hint: '适度详细' },
  { value: 'detailed', label: '详细', hint: '充分解释每个回复' },
];

const TONE_OPTIONS: { value: AgentRoleProfile['tone']; label: string; hint: string }[] = [
  { value: 'friendly', label: '友好', hint: '温暖亲切的对话风格' },
  { value: 'direct', label: '直接', hint: '直截了当，不说废话' },
  { value: 'formal', label: '正式', hint: '专业正式的回复' },
  { value: 'casual', label: '口语化', hint: '轻松口语化的表达' },
];

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

function TagInput({ tags, onChange, placeholder }: TagInputProps) {
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
          <TooltipContent>添加标签</TooltipContent>
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
              <TooltipContent>{`点击移除 "${tag}"`}</TooltipContent>
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
  const update = useCallback((patch: Partial<AgentRoleProfile>) => onChange({ ...profile, ...patch }), [profile, onChange]);
  const currentRoleValue = profile.customRole ? '自定义' : profile.role;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium text-foreground/80">显示名称</Label>
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent>Agent 在对话中使用的显示名称</TooltipContent>
            </Tooltip>
          </div>
          <Input value={profile.displayName} onChange={(e) => update({ displayName: e.target.value })}
            placeholder="例如: 小助手" disabled={disabled}
            className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium text-foreground/80">角色</Label>
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent>定义 Agent 的核心定位和能力范围</TooltipContent>
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
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {profile.role === '自定义' && (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground/80">自定义角色</Label>
          <Input value={profile.customRole || ''} onChange={(e) => update({ customRole: e.target.value })}
            placeholder="例如: 前端架构顾问" disabled={disabled}
            className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-semibold text-foreground/80">回复风格</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>控制 Agent 回复的详细程度、语气和语言偏好</TooltipContent>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">详细程度</Label>
            <div className="flex gap-2">
              {VERBOSITY_OPTIONS.map((opt) => (
                <Tooltip key={opt.value}>
                  <TooltipTrigger asChild>
                    <Button type="button" variant={profile.verbosity === opt.value ? 'secondary' : 'outline'} size="sm"
                      disabled={disabled} className="rounded-full px-3 h-8"
                      onClick={() => update({ verbosity: opt.value })}>{opt.label}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{opt.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">语气</Label>
            <div className="flex gap-2">
              {TONE_OPTIONS.map((opt) => (
                <Tooltip key={opt.value}>
                  <TooltipTrigger asChild>
                    <Button type="button" variant={profile.tone === opt.value ? 'secondary' : 'outline'} size="sm"
                      disabled={disabled} className="rounded-full px-3 h-8"
                      onClick={() => update({ tone: opt.value })}>{opt.label}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{opt.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">语言偏好</Label>
          <Input value={profile.language} onChange={(e) => update({ language: e.target.value })}
            placeholder="例如: 中文思考，代码用英文" disabled={disabled}
            className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium text-foreground/80">擅长领域</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>列出 Agent 擅长的技能和知识领域</TooltipContent>
          </Tooltip>
        </div>
        <TagInput tags={profile.expertise} onChange={(tags) => update({ expertise: tags })}
          placeholder="输入后回车添加，例如: Python, TypeScript" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium text-foreground/80">不擅长（诚实声明）</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>诚实声明自己不擅长的领域，避免 Agent 在弱项上给出错误答案</TooltipContent>
          </Tooltip>
        </div>
        <TagInput tags={profile.limitations} onChange={(tags) => update({ limitations: tags })}
          placeholder="例如: CSS, 移动端开发" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium text-foreground/80">背景故事</Label>
          <Tooltip>
            <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent>可选: 描述 Agent 的身份背景和特殊经历，帮助建立更丰富的角色形象</TooltipContent>
          </Tooltip>
        </div>
        <Textarea value={profile.backstory} onChange={(e) => update({ backstory: e.target.value })}
          placeholder="可选: 描述 Agent 的身份背景..." disabled={disabled} rows={3}
          className="rounded-xl bg-black/5 dark:bg-white/5 border-transparent resize-none" />
      </div>
    </div>
  );
}

export default RoleProfileEditor;
