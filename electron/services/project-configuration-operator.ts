import { createHash } from 'node:crypto';
import type { GatewayManager } from '../gateway/manager';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { withConfigLock } from '../utils/config-mutex';
import { getCurrentGatewayGeneration } from '../gateway/generation';
import { getProjectCoordinatorProfiles, readProjectConfigurationOperations, saveProjectConfigurationOperations, withProjectConfigurationOwner } from './workspaces-api';
import { systemProjectOwnerKey } from '../../shared/types/system-portfolio';
import { parseProjectConfigurationPatch, planProjectConfiguration, projectConfigurationValues,
  type ProjectConfigDocument, type ProjectConfigurationApply, type ProjectConfigurationInput,
  type ProjectConfigurationPreview, type ProjectConfigurationRecovery, type ProjectConfigurationResult, type ProjectConfigurationValues } from '../../shared/project-configuration';

type Agent = NonNullable<NonNullable<ProjectConfigDocument['agents']>['list']>[number];
type Backup = { model: Agent['model'] | null; denyTools: string[] | null; contextTokens: number | null };
export type ConfigurationOperation = { requestHash: string; ownerKey: string; fields: Array<keyof Backup>; before: Backup; after: Backup; result: ProjectConfigurationResult };
let operationTail: Promise<unknown> = Promise.resolve();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const backup = (agent: Agent): Backup => ({ model: agent.model ?? null, denyTools: agent.tools?.deny ?? null, contextTokens: agent.contextTokens ?? null });
function restore(agent: Agent, fields: Backup, selected: Array<keyof Backup>) {
  if (selected.includes('model')) { if (fields.model === null) delete agent.model; else agent.model = fields.model; }
  if (selected.includes('contextTokens')) { if (fields.contextTokens === null) delete agent.contextTokens; else agent.contextTokens = fields.contextTokens; }
  if (selected.includes('denyTools')) {
    agent.tools = { ...agent.tools };
    if (fields.denyTools === null) delete agent.tools.deny; else agent.tools.deny = fields.denyTools;
  }
}

export function createProjectConfigurationOperator(gateway?: Pick<GatewayManager, 'rpc' | 'restart'>) {
  async function owner(input: Pick<ProjectConfigurationInput, 'workspaceId' | 'ownerKey'>, requireLive = true) {
    if (!input || typeof input.workspaceId !== 'string' || typeof input.ownerKey !== 'string') throw new Error('CONFIG_PROJECT_REQUIRED');
    const profiles = await getProjectCoordinatorProfiles(), profile = profiles.find(p => p.id === input.workspaceId);
    const key = profile?.projectCoordinatorSessionKey, binding = key ? profile?.coordinatorBindings?.[key] : undefined;
    if (!profile || systemProjectOwnerKey(profile) !== input.ownerKey || !binding || binding.state !== 'active'
      || binding.invalidationReason || !binding.sessionGeneration || profile.archivedSessionKeys?.includes(key!)) throw new Error('CONFIG_PROJECT_OWNER_CHANGED');
    if (profiles.some(p => p.id !== profile.id && (p.agentId === binding.agentId
      || Object.values(p.agentBindings ?? {}).some(b => b.agentId === binding.agentId)
      || Object.values(p.coordinatorBindings ?? {}).some(b => b.agentId === binding.agentId)))) throw new Error('CONFIG_AGENT_SHARED_SCOPE');
    if (!gateway) throw new Error('CONFIG_RUNTIME_UNAVAILABLE');
    if (!requireLive) return binding;
    const live = await gateway.rpc<{ session?: { sessionId?: string; hasActiveRun?: boolean; status?: string } }>('sessions.describe', { key }, 15_000);
    if (live.session?.sessionId !== binding.sessionGeneration || live.session.hasActiveRun || live.session.status === 'running') throw new Error('CONFIG_PROJECT_BUSY_OR_STALE');
    return binding;
  }
  async function preview(input: ProjectConfigurationInput): Promise<ProjectConfigurationPreview> {
    const patch = parseProjectConfigurationPatch(input.patch), binding = await owner(input);
    const config = await readOpenClawConfig() as ProjectConfigDocument;
    const before = projectConfigurationValues(config, binding.agentId), desired = planProjectConfiguration(config, binding.agentId, patch);
    const configRevision = hash(config);
    return { workspaceId: input.workspaceId, agentId: binding.agentId, ownerKey: input.ownerKey, configRevision,
      digest: hash([input.workspaceId, input.ownerKey, configRevision, patch]), before, desired };
  }
  async function effective(agentId: string): Promise<{ value: ProjectConfigurationValues; generation: string }> {
    const expectedGeneration = getCurrentGatewayGeneration();
    const ack = await gateway!.rpc<{ gatewayGeneration?: string; projectConfiguration?: { agentId: string; values: ProjectConfigurationValues } }>(
      'runtime.flags.ack', { projectAgentId: agentId }, 15_000);
    if (!ack.gatewayGeneration || ack.gatewayGeneration !== expectedGeneration || getCurrentGatewayGeneration() !== expectedGeneration
      || ack.projectConfiguration?.agentId !== agentId) throw new Error('CONFIG_RUNTIME_READBACK_UNAVAILABLE');
    return { value: ack.projectConfiguration.values, generation: ack.gatewayGeneration };
  }
  async function save(operation: ConfigurationOperation) {
    const all = await readProjectConfigurationOperations();
    if (!Object.hasOwn(all, operation.result.requestId) && Object.keys(all).length >= 128) throw new Error('CONFIG_OPERATION_HISTORY_FULL');
    all[operation.result.requestId] = operation;
    await saveProjectConfigurationOperations(all);
  }
  async function settleLocked(operation: ConfigurationOperation, acceptCurrent = false): Promise<ProjectConfigurationResult> {
    try {
      await gateway!.restart();
      await owner({ workspaceId: operation.result.workspaceId, ownerKey: operation.ownerKey });
      const live = await effective(operation.result.agentId);
      const configured = projectConfigurationValues(await readOpenClawConfig() as ProjectConfigDocument, operation.result.agentId);
      if (acceptCurrent && equal(configured, live.value) && !equal(configured, operation.result.desired)) {
        const config = await readOpenClawConfig() as ProjectConfigDocument;
        const agent = config.agents?.list?.find(entry => entry.id === operation.result.agentId);
        if (agent && operation.fields.some(key => !equal(backup(agent)[key], operation.before[key]) && !equal(backup(agent)[key], operation.after[key]))) {
          operation.result = { ...operation.result, phase: 'superseded', configured, effective: live.value,
            runtimeGeneration: live.generation, error: 'CONFIG_SUPERSEDED_BY_CURRENT_OWNER' };
          await save(operation); return operation.result;
        }
      }
      if (!equal(configured, operation.result.desired) || !equal(live.value, operation.result.desired)) throw new Error('CONFIG_RUNTIME_READBACK_MISMATCH');
      operation.result = { ...operation.result, phase: 'applied', configured, effective: live.value, runtimeGeneration: live.generation, error: null };
    } catch (error) {
      if (error instanceof Error && /CONFIG_PROJECT_(BUSY_OR_STALE|OWNER_CHANGED|AGENT_SHARED_SCOPE)/.test(error.message)) {
        operation.result = { ...operation.result, phase: 'degraded', configured: null, effective: null,
          runtimeGeneration: null, error: 'CONFIG_PROJECT_OWNER_CHANGED' };
        await save(operation); return operation.result;
      }
      try {
        await withConfigLock(async () => {
          const config = await readOpenClawConfig() as ProjectConfigDocument;
          const agent = config.agents?.list?.find(entry => entry.id === operation.result.agentId);
          if (!agent || !operation.fields.every(key => equal(backup(agent)[key], operation.after[key]) || equal(backup(agent)[key], operation.before[key]))) throw new Error('CONFIG_ROLLBACK_CONFLICT');
          restore(agent, operation.before, operation.fields); await writeOpenClawConfig(config);
        });
        await gateway!.restart();
        const configured = projectConfigurationValues(await readOpenClawConfig() as ProjectConfigDocument, operation.result.agentId);
        const live = await effective(operation.result.agentId);
        if (!equal(configured, live.value)) throw new Error('CONFIG_ROLLBACK_READBACK_MISMATCH');
        operation.result = { ...operation.result, phase: 'rolled-back', configured, effective: live.value,
          runtimeGeneration: live.generation, error: 'CONFIG_APPLY_RELOADED_ROLLBACK' };
      } catch {
        operation.result = { ...operation.result, phase: 'degraded', effective: null, runtimeGeneration: null, error: 'CONFIG_RECOVERY_REQUIRED' };
      }
    }
    await save(operation); return operation.result;
  }
  async function settle(operation: ConfigurationOperation, acceptCurrent = false): Promise<ProjectConfigurationResult> {
    try {
      return await withProjectConfigurationOwner(operation.result.workspaceId, operation.ownerKey, async () => {
        const binding = await owner({ workspaceId: operation.result.workspaceId, ownerKey: operation.ownerKey }, false);
        if (binding.agentId !== operation.result.agentId) throw new Error('CONFIG_PROJECT_OWNER_CHANGED');
        return settleLocked(operation, acceptCurrent);
      });
    } catch {
      operation.result = { ...operation.result, phase: 'degraded', configured: null, effective: null,
        runtimeGeneration: null, error: 'CONFIG_PROJECT_OWNER_CHANGED' };
      await save(operation); return operation.result;
    }
  }
  const apply = (input: ProjectConfigurationApply): Promise<ProjectConfigurationResult> => {
    const run = operationTail.then(async () => {
      if (!input || typeof input.requestId !== 'string' || !/^[\w:-]{1,160}$/.test(input.requestId)) throw new Error('CONFIG_REQUEST_ID_INVALID');
      const patch = parseProjectConfigurationPatch(input.patch), requestHash = hash([input.workspaceId, input.ownerKey, input.configRevision, input.digest, patch]);
      const operations = await readProjectConfigurationOperations(), prior = operations[input.requestId];
      if (prior) {
        if (prior.requestHash !== requestHash) throw new Error('CONFIG_REQUEST_CONFLICT');
        if (prior.result.phase === 'pending' || prior.result.phase === 'degraded') return settle(prior);
        return prior.result;
      }
      if (Object.values(operations).some(op => op.result.phase === 'pending' || op.result.phase === 'degraded')) throw new Error('CONFIG_RECOVERY_REQUIRED');
      if (Object.keys(operations).length >= 128) throw new Error('CONFIG_OPERATION_HISTORY_FULL');
      const plan = await preview(input);
      if (plan.digest !== input.digest || plan.configRevision !== input.configRevision) throw new Error('CONFIG_PREVIEW_STALE');
      let operation!: ConfigurationOperation;
      try { await withProjectConfigurationOwner(input.workspaceId, input.ownerKey, () => withConfigLock(async () => {
        await owner(input);
        const config = await readOpenClawConfig() as ProjectConfigDocument;
        if (hash(config) !== input.configRevision) throw new Error('CONFIG_REVISION_CONFLICT');
        const agent = config.agents!.list!.find(entry => entry.id === plan.agentId)!;
        const before = backup(agent);
        if (patch.modelRef !== undefined) {
          const inherited = config.agents?.defaults?.model;
          agent.model = { ...(typeof agent.model === 'object' ? agent.model
            : { fallbacks: !agent.model && typeof inherited === 'object' ? inherited.fallbacks ?? [] : [] }), primary: patch.modelRef };
        }
        if (patch.denyTools !== undefined) agent.tools = { ...agent.tools, deny: patch.denyTools };
        if (patch.contextTokens !== undefined) agent.contextTokens = patch.contextTokens;
        const fields = Object.keys(patch).map(key => key === 'modelRef' ? 'model' : key) as Array<keyof Backup>;
        operation = { requestHash, ownerKey: input.ownerKey, fields, before, after: backup(agent), result: { requestId: input.requestId,
          workspaceId: input.workspaceId, agentId: plan.agentId, phase: 'pending', desired: plan.desired, configured: null,
          effective: null, runtimeGeneration: null, error: null } };
        await save(operation); await writeOpenClawConfig(config);
      })); } catch (error) { if (!operation) throw error; return settle(operation); }
      return settle(operation);
    });
    operationTail = run.catch(() => undefined); return run;
  };
  const reconcile = (input: ProjectConfigurationRecovery): Promise<ProjectConfigurationResult> => {
    const run = operationTail.then(async () => {
      const operation = (await readProjectConfigurationOperations())[input.requestId];
      if (!operation || operation.result.workspaceId !== input.workspaceId) throw new Error('CONFIG_OPERATION_NOT_FOUND');
      if (!['pending', 'degraded'].includes(operation.result.phase)) return operation.result;
      const binding = await owner(input, false);
      if (binding.agentId !== operation.result.agentId) throw new Error('CONFIG_PROJECT_OWNER_CHANGED');
      operation.ownerKey = input.ownerKey;
      return settle(operation, true);
    });
    operationTail = run.catch(() => undefined); return run;
  };
  return { preview, apply, reconcile };
}
