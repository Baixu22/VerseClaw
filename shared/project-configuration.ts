export type ProjectConfigurationPatch = { modelRef?: string; denyTools?: string[]; contextTokens?: number };
export type ProjectConfigurationValues = { modelRef: string | null; denyTools: string[]; contextTokens: number | null };
export type ProjectConfigurationInput = { workspaceId: string; ownerKey: string; patch: ProjectConfigurationPatch };
export type ProjectConfigurationPreview = {
  workspaceId: string; agentId: string; ownerKey: string; configRevision: string; digest: string;
  before: ProjectConfigurationValues; desired: ProjectConfigurationValues;
};
export type ProjectConfigurationApply = ProjectConfigurationInput & { requestId: string; configRevision: string; digest: string };
export type ProjectConfigurationRecovery = { workspaceId: string; ownerKey: string; requestId: string };
export type ProjectConfigurationResult = {
  requestId: string; workspaceId: string; agentId: string;
  phase: 'pending' | 'applied' | 'rolled-back' | 'superseded' | 'degraded';
  desired: ProjectConfigurationValues; configured: ProjectConfigurationValues | null;
  effective: ProjectConfigurationValues | null; runtimeGeneration: string | null; error: string | null;
};

export function parseProjectConfigurationPatch(value: unknown): ProjectConfigurationPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CONFIG_PATCH_SCHEMA');
  const patch = value as Record<string, unknown>;
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !['modelRef', 'denyTools', 'contextTokens'].includes(key))) throw new Error('CONFIG_PATCH_SCHEMA');
  if (patch.modelRef !== undefined && (typeof patch.modelRef !== 'string' || !/^[\w.-]+\/[\w./:-]+$/.test(patch.modelRef) || patch.modelRef.length > 160)) throw new Error('CONFIG_PATCH_MODEL');
  if (patch.denyTools !== undefined && (!Array.isArray(patch.denyTools) || patch.denyTools.length > 64
    || patch.denyTools.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_:-]{0,79}$/.test(name)))) throw new Error('CONFIG_PATCH_TOOLS');
  if (patch.contextTokens !== undefined && (!Number.isSafeInteger(patch.contextTokens) || Number(patch.contextTokens) < 1024)) throw new Error('CONFIG_PATCH_QUOTA');
  return { ...(patch.modelRef !== undefined ? { modelRef: patch.modelRef as string } : {}),
    ...(patch.denyTools !== undefined ? { denyTools: [...new Set(patch.denyTools as string[])].sort() } : {}),
    ...(patch.contextTokens !== undefined ? { contextTokens: patch.contextTokens as number } : {}) };
}

type AgentConfig = { id: string; model?: string | { primary?: string; fallbacks?: string[] }; tools?: { deny?: string[] }; contextTokens?: number };
export type ProjectConfigDocument = { agents?: { defaults?: Omit<AgentConfig, 'id'>; list?: AgentConfig[] };
  models?: { providers?: Record<string, { models?: Array<{ id: string; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }> }> }; [key: string]: unknown };

export function projectConfigurationValues(config: ProjectConfigDocument, agentId: string): ProjectConfigurationValues {
  const agent = config.agents?.list?.find(entry => entry.id === agentId);
  if (!agent) throw new Error('CONFIG_AGENT_NOT_FOUND');
  const model = agent.model ?? config.agents?.defaults?.model;
  return { modelRef: typeof model === 'string' ? model : model?.primary ?? null,
    denyTools: [...new Set(agent.tools?.deny ?? [])].sort(),
    contextTokens: agent.contextTokens ?? config.agents?.defaults?.contextTokens ?? null };
}

export function planProjectConfiguration(config: ProjectConfigDocument, agentId: string, raw: unknown): ProjectConfigurationValues {
  const patch = parseProjectConfigurationPatch(raw), before = projectConfigurationValues(config, agentId);
  if (patch.modelRef && patch.modelRef !== before.modelRef) {
    const price = (ref: string | null) => {
      const at = ref?.indexOf('/') ?? -1;
      if (!ref || at < 1) throw new Error('CONFIG_MODEL_PRICE_UNKNOWN');
      const model = config.models?.providers?.[ref.slice(0, at)]?.models?.find(entry => entry.id === ref.slice(at + 1));
      const cost = model?.cost;
      if (!cost || ![cost.input, cost.output, cost.cacheRead, cost.cacheWrite].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
        || (cost.input === 0 && cost.output === 0)) throw new Error('CONFIG_MODEL_PRICE_UNKNOWN');
      return cost as Required<typeof cost>;
    };
    const old = price(before.modelRef), next = price(patch.modelRef);
    if ((['input', 'output', 'cacheRead', 'cacheWrite'] as const).some(key => next[key] > old[key])) throw new Error('CONFIG_MODEL_COST_INCREASE');
  }
  if (patch.denyTools && before.denyTools.some(name => !patch.denyTools!.includes(name))) throw new Error('CONFIG_TOOL_PERMISSION_EXPANSION');
  if (patch.contextTokens !== undefined && (before.contextTokens === null || patch.contextTokens > before.contextTokens)) throw new Error('CONFIG_QUOTA_EXPANSION');
  const desired = { ...before, ...patch };
  if (JSON.stringify(desired) === JSON.stringify(before)) throw new Error('CONFIG_PATCH_EMPTY');
  return desired;
}
