import type { WorkspaceKnowledgeScope, WorkspacePermissionMode } from './workspace';

export type WorkModeId = 'plan' | 'build' | 'review' | 'docsData';

export type WorkModeStateWidget = 'planning' | 'build' | 'review' | 'docsData';

export type WorkModeResponseStyle = 'plan-first' | 'action-first' | 'findings-first' | 'artifact-first';

export type WorkModeKit =
  | 'reports'
  | 'sheets'
  | 'slides'
  | 'pdf'
  | 'research'
  | 'website'
  | 'design'
  | 'ops';

export type WorkModeArtifactType =
  | 'markdown'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'pptx'
  | 'pdf'
  | 'html'
  | 'image';

export type WorkModeQualityCheck =
  | 'preview'
  | 'export'
  | 'citations'
  | 'formulas'
  | 'charts'
  | 'responsive'
  | 'accessibility'
  | 'readability';

export type WorkModeCapabilityStatus =
  | 'ready'
  | 'missingSkill'
  | 'disabled'
  | 'runtimeUnavailable'
  | 'optionalExternal';

export type WorkModeToolBundle =
  | 'code'
  | 'git'
  | 'terminal'
  | 'browser'
  | 'docs'
  | 'sheets'
  | 'pdf'
  | 'memory';

export type WorkModeToolBundleConfig = Partial<Record<WorkModeId, WorkModeToolBundle[]>>;

export type WorkModeKitConfig = Partial<Record<WorkModeId, WorkModeKit[]>>;

export interface WorkModeKitDefinition {
  id: WorkModeKit;
  labelKey: string;
  descriptionKey: string;
  artifactTypes: WorkModeArtifactType[];
  requiredSkillSlugs: string[];
  optionalExternal: boolean;
  qualityChecks: WorkModeQualityCheck[];
  libraries: string[];
}

export interface WorkModeCapabilitySkill {
  id?: string;
  slug?: string;
  enabled?: boolean;
  marketplace?: {
    slug?: string;
  };
}

export interface WorkModeKitCapability {
  kit: WorkModeKit;
  status: WorkModeCapabilityStatus;
  artifactTypes: WorkModeArtifactType[];
  qualityChecks: WorkModeQualityCheck[];
  requiredSkillSlugs: string[];
  missingSkillSlugs: string[];
  disabledSkillSlugs: string[];
}

export type WorkModeCapabilitySummary = Record<WorkModeCapabilityStatus, number>;

export interface WorkModePreset {
  id: WorkModeId;
  labelKey: string;
  descriptionKey: string;
  recommendedPermissionMode: WorkspacePermissionMode;
  defaultKnowledgeScope: WorkspaceKnowledgeScope | 'current';
  responseStyle: WorkModeResponseStyle;
  stateWidgets: WorkModeStateWidget[];
  toolBundles: WorkModeToolBundle[];
  kits: WorkModeKit[];
  instruction: string;
}

export const WORK_MODE_IDS: WorkModeId[] = ['plan', 'build', 'review', 'docsData'];

export const WORK_MODE_KIT_IDS: WorkModeKit[] = [
  'reports',
  'sheets',
  'slides',
  'pdf',
  'research',
  'website',
  'design',
  'ops',
];

export const WORK_MODE_TOOL_BUNDLES: WorkModeToolBundle[] = [
  'code',
  'git',
  'terminal',
  'browser',
  'docs',
  'sheets',
  'pdf',
  'memory',
];

export const WORK_MODE_INSTALLABLE_SKILL_SLUGS = [
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'frontend-design',
  'web-artifacts-builder',
] as const;

export const WORK_MODE_KIT_DEFINITIONS: Record<WorkModeKit, WorkModeKitDefinition> = {
  reports: {
    id: 'reports',
    labelKey: 'workModes.kits.reports',
    descriptionKey: 'workModes.kitDescriptions.reports',
    artifactTypes: ['markdown', 'docx', 'pdf'],
    requiredSkillSlugs: ['docx'],
    optionalExternal: false,
    qualityChecks: ['preview', 'export', 'readability'],
    libraries: ['docx', 'mammoth', 'react-markdown'],
  },
  sheets: {
    id: 'sheets',
    labelKey: 'workModes.kits.sheets',
    descriptionKey: 'workModes.kitDescriptions.sheets',
    artifactTypes: ['xlsx', 'csv'],
    requiredSkillSlugs: ['xlsx'],
    optionalExternal: false,
    qualityChecks: ['preview', 'formulas', 'charts'],
    libraries: ['xlsx', 'exceljs'],
  },
  slides: {
    id: 'slides',
    labelKey: 'workModes.kits.slides',
    descriptionKey: 'workModes.kitDescriptions.slides',
    artifactTypes: ['pptx', 'pdf'],
    requiredSkillSlugs: ['pptx'],
    optionalExternal: false,
    qualityChecks: ['preview', 'export'],
    libraries: ['pptxgenjs'],
  },
  pdf: {
    id: 'pdf',
    labelKey: 'workModes.kits.pdf',
    descriptionKey: 'workModes.kitDescriptions.pdf',
    artifactTypes: ['pdf', 'markdown'],
    requiredSkillSlugs: ['pdf'],
    optionalExternal: false,
    qualityChecks: ['preview', 'citations'],
    libraries: ['pdfjs-dist', 'pdf-lib', 'pdf-parse'],
  },
  research: {
    id: 'research',
    labelKey: 'workModes.kits.research',
    descriptionKey: 'workModes.kitDescriptions.research',
    artifactTypes: ['markdown', 'html', 'pdf'],
    requiredSkillSlugs: [],
    optionalExternal: true,
    qualityChecks: ['citations', 'readability'],
    libraries: ['@mozilla/readability', 'turndown', 'cheerio'],
  },
  website: {
    id: 'website',
    labelKey: 'workModes.kits.website',
    descriptionKey: 'workModes.kitDescriptions.website',
    artifactTypes: ['html', 'image'],
    requiredSkillSlugs: ['web-artifacts-builder'],
    optionalExternal: false,
    qualityChecks: ['preview', 'responsive', 'accessibility'],
    libraries: ['playwright', 'lighthouse', 'axe-core'],
  },
  design: {
    id: 'design',
    labelKey: 'workModes.kits.design',
    descriptionKey: 'workModes.kitDescriptions.design',
    artifactTypes: ['html', 'image', 'pdf'],
    requiredSkillSlugs: ['frontend-design'],
    optionalExternal: false,
    qualityChecks: ['preview', 'responsive'],
    libraries: ['echarts', 'vega-lite', 'shiki'],
  },
  ops: {
    id: 'ops',
    labelKey: 'workModes.kits.ops',
    descriptionKey: 'workModes.kitDescriptions.ops',
    artifactTypes: ['markdown', 'csv'],
    requiredSkillSlugs: [],
    optionalExternal: true,
    qualityChecks: ['readability'],
    libraries: [],
  },
};

export const WORK_MODE_PRESETS: Record<WorkModeId, WorkModePreset> = {
  plan: {
    id: 'plan',
    labelKey: 'composer.workMode.plan',
    descriptionKey: 'composer.workModeDescription.plan',
    recommendedPermissionMode: 'plan',
    defaultKnowledgeScope: 'all',
    responseStyle: 'plan-first',
    stateWidgets: ['planning'],
    toolBundles: ['code', 'docs', 'memory'],
    kits: ['reports', 'research', 'ops'],
    instruction: 'Plan first. Clarify assumptions, risks, affected areas, and acceptance criteria. Do not imply that implementation has happened.',
  },
  build: {
    id: 'build',
    labelKey: 'composer.workMode.build',
    descriptionKey: 'composer.workModeDescription.build',
    recommendedPermissionMode: 'acceptEdits',
    defaultKnowledgeScope: 'current',
    responseStyle: 'action-first',
    stateWidgets: ['build'],
    toolBundles: ['code', 'git', 'terminal', 'browser'],
    kits: ['website', 'design'],
    instruction: 'Implement directly when the request is clear. Keep changes focused, verify them, and summarize what changed.',
  },
  review: {
    id: 'review',
    labelKey: 'composer.workMode.review',
    descriptionKey: 'composer.workModeDescription.review',
    recommendedPermissionMode: 'readOnly',
    defaultKnowledgeScope: 'wiki',
    responseStyle: 'findings-first',
    stateWidgets: ['review'],
    toolBundles: ['code', 'git', 'terminal'],
    kits: ['research', 'pdf'],
    instruction: 'Review first. Lead with findings ordered by severity, include concrete evidence, and avoid editing unless explicitly asked.',
  },
  docsData: {
    id: 'docsData',
    labelKey: 'composer.workMode.docsData',
    descriptionKey: 'composer.workModeDescription.docsData',
    recommendedPermissionMode: 'acceptEdits',
    defaultKnowledgeScope: 'all',
    responseStyle: 'artifact-first',
    stateWidgets: ['docsData'],
    toolBundles: ['docs', 'sheets', 'pdf', 'memory'],
    kits: ['reports', 'sheets', 'slides', 'pdf'],
    instruction: 'Prioritize documents, spreadsheets, PDFs, reports, structured summaries, and exportable artifacts.',
  },
};

export function normalizeWorkModeId(value: unknown): WorkModeId | undefined {
  return typeof value === 'string' && value in WORK_MODE_PRESETS ? value as WorkModeId : undefined;
}

export function resolveDefaultWorkMode(permissionMode?: WorkspacePermissionMode | null): WorkModeId {
  return permissionMode === 'plan' ? 'plan' : 'build';
}

export function normalizeWorkModeToolBundles(value: unknown, fallback: WorkModeToolBundle[]): WorkModeToolBundle[] {
  if (!Array.isArray(value)) return fallback;
  const allowed = new Set(WORK_MODE_TOOL_BUNDLES);
  const normalized: WorkModeToolBundle[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item as WorkModeToolBundle)) continue;
    if (!normalized.includes(item as WorkModeToolBundle)) {
      normalized.push(item as WorkModeToolBundle);
    }
  }
  return normalized;
}

export function normalizeWorkModeKits(value: unknown, fallback: WorkModeKit[]): WorkModeKit[] {
  if (!Array.isArray(value)) return fallback;
  const allowed = new Set(WORK_MODE_KIT_IDS);
  const normalized: WorkModeKit[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item as WorkModeKit)) continue;
    if (!normalized.includes(item as WorkModeKit)) {
      normalized.push(item as WorkModeKit);
    }
  }
  return normalized;
}

export function workModeKitsFromToolBundles(value: WorkModeToolBundle[]): WorkModeKit[] {
  const kits: WorkModeKit[] = [];
  const add = (kit: WorkModeKit) => {
    if (!kits.includes(kit)) kits.push(kit);
  };
  for (const bundle of value) {
    if (bundle === 'docs') {
      add('reports');
      add('slides');
    }
    if (bundle === 'sheets') add('sheets');
    if (bundle === 'pdf') add('pdf');
    if (bundle === 'browser') {
      add('research');
      add('website');
    }
    if (bundle === 'code') {
      add('website');
      add('design');
    }
    if (bundle === 'memory') add('research');
  }
  return kits;
}

function resolveConfiguredWorkModeKits(
  mode: WorkModeId,
  preset: WorkModePreset,
  toolBundleConfig?: WorkModeToolBundleConfig | null,
  kitConfig?: WorkModeKitConfig | null,
): WorkModeKit[] {
  if (kitConfig && Object.prototype.hasOwnProperty.call(kitConfig, mode)) {
    return normalizeWorkModeKits(kitConfig[mode], preset.kits);
  }
  if (toolBundleConfig && Object.prototype.hasOwnProperty.call(toolBundleConfig, mode)) {
    return workModeKitsFromToolBundles(normalizeWorkModeToolBundles(toolBundleConfig[mode], preset.toolBundles));
  }
  return preset.kits;
}

export function resolveWorkModePreset(
  value: unknown,
  permissionMode?: WorkspacePermissionMode | null,
  toolBundleConfig?: WorkModeToolBundleConfig | null,
  kitConfig?: WorkModeKitConfig | null,
): WorkModePreset {
  const mode = normalizeWorkModeId(value) ?? resolveDefaultWorkMode(permissionMode);
  const preset = WORK_MODE_PRESETS[mode];
  const configuredToolBundles = toolBundleConfig
    && Object.prototype.hasOwnProperty.call(toolBundleConfig, mode)
    ? normalizeWorkModeToolBundles(toolBundleConfig[mode], preset.toolBundles)
    : preset.toolBundles;
  return {
    ...preset,
    toolBundles: configuredToolBundles,
    kits: resolveConfiguredWorkModeKits(mode, preset, toolBundleConfig, kitConfig),
  };
}

function normalizedSkillKeys(skill: WorkModeCapabilitySkill): string[] {
  return [
    skill.id,
    skill.slug,
    skill.marketplace?.slug,
  ].flatMap((value) => (typeof value === 'string' && value.trim() ? [value.trim().toLowerCase()] : []));
}

function findSkillBySlug(
  skills: WorkModeCapabilitySkill[],
  slug: string,
): WorkModeCapabilitySkill | undefined {
  const normalizedSlug = slug.toLowerCase();
  return skills.find((skill) => normalizedSkillKeys(skill).includes(normalizedSlug));
}

export function resolveWorkModeKitCapabilities(
  kits: WorkModeKit[],
  skills: WorkModeCapabilitySkill[] = [],
  runtimeAvailable = true,
): WorkModeKitCapability[] {
  return kits.map((kit) => {
    const definition = WORK_MODE_KIT_DEFINITIONS[kit];
    const missingSkillSlugs: string[] = [];
    const disabledSkillSlugs: string[] = [];

    for (const slug of definition.requiredSkillSlugs) {
      const skill = findSkillBySlug(skills, slug);
      if (!skill) {
        missingSkillSlugs.push(slug);
        continue;
      }
      if (skill.enabled === false) {
        disabledSkillSlugs.push(slug);
      }
    }

    let status: WorkModeCapabilityStatus = 'ready';
    if (!runtimeAvailable && definition.requiredSkillSlugs.length > 0) {
      status = 'runtimeUnavailable';
    } else if (missingSkillSlugs.length > 0) {
      status = 'missingSkill';
    } else if (disabledSkillSlugs.length > 0) {
      status = 'disabled';
    } else if (definition.optionalExternal) {
      status = 'optionalExternal';
    }

    return {
      kit,
      status,
      artifactTypes: definition.artifactTypes,
      qualityChecks: definition.qualityChecks,
      requiredSkillSlugs: definition.requiredSkillSlugs,
      missingSkillSlugs,
      disabledSkillSlugs,
    };
  });
}

export function summarizeWorkModeCapabilities(
  capabilities: WorkModeKitCapability[],
): WorkModeCapabilitySummary {
  return capabilities.reduce<WorkModeCapabilitySummary>((summary, capability) => {
    summary[capability.status] += 1;
    return summary;
  }, {
    ready: 0,
    missingSkill: 0,
    disabled: 0,
    runtimeUnavailable: 0,
    optionalExternal: 0,
  });
}
