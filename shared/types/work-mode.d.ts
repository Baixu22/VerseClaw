import type { WorkspaceKnowledgeScope, WorkspacePermissionMode } from './workspace';
import type { WorkProviderCapability } from './work-provider';
/**
 * @deprecated Internal compatibility for legacy Work Mode data and tests only.
 * Current Chat behavior uses explicit effort/intensity preferences; Work Mode
 * must not drive permissions, tool access, Task Ledger state, or runtime policy.
 */
export type WorkModeId = 'plan' | 'build' | 'review' | 'docsData';
export type WorkModeStateWidget = 'planning' | 'build' | 'review' | 'docsData';
export type WorkModeResponseStyle = 'plan-first' | 'action-first' | 'findings-first' | 'artifact-first';
export type WorkModeKit = 'reports' | 'sheets' | 'slides' | 'pdf' | 'research' | 'website' | 'design' | 'ops';
export type WorkModeArtifactType = 'markdown' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'pdf' | 'html' | 'image';
export type WorkModeQualityCheck = 'preview' | 'export' | 'citations' | 'formulas' | 'charts' | 'responsive' | 'accessibility' | 'readability';
export type WorkModeCapabilityStatus = 'ready' | 'missingSkill' | 'disabled' | 'runtimeUnavailable' | 'optionalExternal';
export type WorkModeToolBundle = 'code' | 'git' | 'terminal' | 'browser' | 'docs' | 'sheets' | 'pdf' | 'memory';
export type WorkModeToolBundleConfig = Partial<Record<WorkModeId, WorkModeToolBundle[]>>;
export type WorkModeKitConfig = Partial<Record<WorkModeId, WorkModeKit[]>>;
export interface WorkModeKitDefinition {
    id: WorkModeKit;
    labelKey: string;
    descriptionKey: string;
    artifactTypes: WorkModeArtifactType[];
    requiredCapabilities: WorkProviderCapability[];
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
    requiredCapabilities: WorkProviderCapability[];
    requiredSkillSlugs: string[];
    missingSkillSlugs: string[];
    disabledSkillSlugs: string[];
}
export type WorkModeCapabilitySummary = Record<WorkModeCapabilityStatus, number>;
export interface WorkModeControlContract {
    phase: WorkModeId;
    must: string[];
    mustNot: string[];
    evidence: string[];
}
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
    controlContract: WorkModeControlContract;
}
export declare const WORK_MODE_IDS: WorkModeId[];
/** All valid PromptMode values */
export declare const PROMPT_MODES: PromptMode[];
export declare const WORK_MODE_KIT_IDS: WorkModeKit[];
export declare const WORK_MODE_TOOL_BUNDLES: WorkModeToolBundle[];
export declare const WORK_MODE_INSTALLABLE_SKILL_SLUGS: readonly ['docx', 'xlsx', 'pptx', 'pdf', 'frontend-design', 'web-artifacts-builder'];
export declare const WORK_MODE_KIT_DEFINITIONS: Record<WorkModeKit, WorkModeKitDefinition>;
export declare const WORK_MODE_PRESETS: Record<WorkModeId, WorkModePreset>;
export declare function normalizeWorkModeId(value: unknown): WorkModeId | undefined;
export declare function resolveDefaultWorkMode(permissionMode?: WorkspacePermissionMode | null): WorkModeId;
export declare function normalizeWorkModeToolBundles(value: unknown, fallback: WorkModeToolBundle[]): WorkModeToolBundle[];
export declare function normalizeWorkModeKits(value: unknown, fallback: WorkModeKit[]): WorkModeKit[];
export declare function workModeKitsFromToolBundles(value: WorkModeToolBundle[]): WorkModeKit[];
export declare function resolveWorkModePreset(value: unknown, permissionMode?: WorkspacePermissionMode | null, toolBundleConfig?: WorkModeToolBundleConfig | null, kitConfig?: WorkModeKitConfig | null): WorkModePreset;
export declare function resolveWorkModeKitCapabilities(kits: WorkModeKit[], skills?: WorkModeCapabilitySkill[], runtimeAvailable?: boolean): WorkModeKitCapability[];
export declare function summarizeWorkModeCapabilities(capabilities: WorkModeKitCapability[]): WorkModeCapabilitySummary;
/** System prompt intensity level. full=all sections, minimal=reduced (Tooling+Workspace+Runtime), none=identity only. */
export type PromptMode = 'full' | 'minimal' | 'none';
/** Default mapping: WorkModeId → PromptMode. plan→none, build→full, review/docsData→minimal. */
export declare const WORK_MODE_PROMPT_MAP: Record<WorkModeId, PromptMode>;
