import {
  BarChart3,
  Box,
  Clapperboard,
  FileSpreadsheet,
  Presentation,
  GraduationCap,
  Rocket,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { FileText } from '@/components/icons/codex-icons';

export type ComposerActionGroup = 'context' | 'skills' | 'office' | 'session';

export interface ComposerAction {
  id: string;
  group: ComposerActionGroup;
  labelKey: string;
  disabled?: boolean;
}

export interface OfficeAction {
  id: 'excel' | 'word' | 'ppt' | 'pitchDeck' | 'morph' | 'morph3d' | 'academic' | 'financial' | 'dashboard';
  icon: LucideIcon;
  labelKey: string;
  promptKey: string;
  preferredSkill: string;
  skillAliases: string[];
}

export const OFFICE_ACTIONS: OfficeAction[] = [
  {
    id: 'excel',
    icon: FileSpreadsheet,
    labelKey: 'composer.office.excel',
    promptKey: 'composer.office.prompts.excel',
    preferredSkill: 'officecli-xlsx',
    skillAliases: ['officecli-xlsx'],
  },
  {
    id: 'word',
    icon: FileText,
    labelKey: 'composer.office.word',
    promptKey: 'composer.office.prompts.word',
    preferredSkill: 'officecli-docx',
    skillAliases: ['officecli-docx'],
  },
  {
    id: 'ppt',
    icon: Presentation,
    labelKey: 'composer.office.ppt',
    promptKey: 'composer.office.prompts.ppt',
    preferredSkill: 'officecli-pptx',
    skillAliases: ['officecli-pptx'],
  },
  {
    id: 'pitchDeck',
    icon: Rocket,
    labelKey: 'composer.office.pitchDeck',
    promptKey: 'composer.office.prompts.pitchDeck',
    preferredSkill: 'officecli-pitch-deck',
    skillAliases: ['officecli-pitch-deck'],
  },
  {
    id: 'morph',
    icon: Clapperboard,
    labelKey: 'composer.office.morph',
    promptKey: 'composer.office.prompts.morph',
    preferredSkill: 'morph-ppt',
    skillAliases: ['morph-ppt'],
  },
  {
    id: 'morph3d',
    icon: Box,
    labelKey: 'composer.office.morph3d',
    promptKey: 'composer.office.prompts.morph3d',
    preferredSkill: 'morph-ppt-3d',
    skillAliases: ['morph-ppt-3d'],
  },
  {
    id: 'academic',
    icon: GraduationCap,
    labelKey: 'composer.office.academic',
    promptKey: 'composer.office.prompts.academic',
    preferredSkill: 'officecli-academic-paper',
    skillAliases: ['officecli-academic-paper'],
  },
  {
    id: 'financial',
    icon: TrendingUp,
    labelKey: 'composer.office.financial',
    promptKey: 'composer.office.prompts.financial',
    preferredSkill: 'officecli-financial-model',
    skillAliases: ['officecli-financial-model'],
  },
  {
    id: 'dashboard',
    icon: BarChart3,
    labelKey: 'composer.office.dashboard',
    promptKey: 'composer.office.prompts.dashboard',
    preferredSkill: 'officecli-data-dashboard',
    skillAliases: ['officecli-data-dashboard'],
  },
];

export function findOfficeSkill(
  action: OfficeAction,
  skills: QuickAccessSkillLike[],
): QuickAccessSkillLike | null {
  const aliases = new Set(action.skillAliases.map((alias) => alias.toLowerCase()));
  return skills.find((skill) => aliases.has(skill.name.toLowerCase())) ?? null;
}

export function getEnabledOfficeActions(
  skills: QuickAccessSkillLike[],
): Array<{ action: OfficeAction; skill: QuickAccessSkillLike }> {
  return OFFICE_ACTIONS
    .map((action) => {
      const skill = findOfficeSkill(action, skills);
      return skill ? { action, skill } : null;
    })
    .filter((entry): entry is { action: OfficeAction; skill: QuickAccessSkillLike } => Boolean(entry));
}

export interface QuickAccessSkillLike {
  name: string;
  description: string;
  source: 'workspace' | 'openclaw' | 'agents' | 'legacy';
  sourceLabel: string;
  manifestPath: string;
  baseDir: string;
}
