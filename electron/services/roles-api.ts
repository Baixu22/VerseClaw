import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readOpenClawConfig, writeOpenClawConfig, type OpenClawConfig } from '../utils/channel-config';
import { withConfigLock } from '../utils/config-mutex';
import {
  fingerprintRoleContract,
  materializeAgencyRoleContract,
  suggestAgencyToolMappings,
  validateAgencyPromotionCandidate,
  type AgencyPromotionCandidate,
} from '../../openclaw_runtime/src/agents/agency-role-promotion';
import {
  importAgencyDraftRolesFromRepository,
  type AgencyRepositoryCatalog,
} from '../../openclaw_runtime/src/agents/agency-role-importer';
import type { AgencyDraftRoleEntry } from '../../openclaw_runtime/src/agents/agency-draft-catalog';
import type { RoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import {
  createRolePromotionStore,
  type StoredAgencyRolePromotionRecord,
} from './role-promotion-store';
import type {
  AgencyRoleCandidatePayload,
  AgencyRoleDraftSummary,
  AgencyRolePromotionRecord,
  AgencyRoleReviewPayload,
  RoleConfigPermissions,
  RoleConfigRoleSummary,
  RoleUpsertConfigRolePayload,
} from '@shared/host-api/contract';

type ConfigRoleEntry = RoleConfigRoleSummary & {
  capabilities?: string[];
  toolRequirements?: string[];
  riskProfile?: 'low' | 'medium' | 'high' | 'critical';
  canModifyScope?: boolean;
  model: { default: string | null; fallback: string[]; provider?: string | null };
  outputSchema: { format: 'markdown' | 'json' | 'text'; sections: string[] };
  handoff: { to: string[]; from: string[]; requiresReview: boolean };
};

type OpenClawConfigWithRoles = OpenClawConfig & {
  agents?: Record<string, unknown> & {
    roles?: unknown;
  };
};

const CONFIG_ROLE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const BUILT_IN_ROLE_NAMES = new Set([
  'architect',
  'implementer',
  'reviewer',
  'tester',
  'researcher',
  'planner',
  'documenter',
  'devops',
]);

function stringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizePermissions(value: RoleConfigPermissions | undefined): RoleConfigRoleSummary['permissions'] {
  return {
    filesystem: value?.filesystem ?? 'read',
    network: value?.network ?? 'limited',
    commands: stringList(value?.commands),
    ...(value?.readPaths ? { readPaths: stringList(value.readPaths) } : {}),
    ...(value?.writePaths ? { writePaths: stringList(value.writePaths) } : {}),
  };
}

function validatePayload(payload: RoleUpsertConfigRolePayload): void {
  if (!CONFIG_ROLE_NAME_PATTERN.test(payload.name)) {
    throw new Error('Role name must match /^[a-z][a-z0-9-]{1,63}$/');
  }
  if (BUILT_IN_ROLE_NAMES.has(payload.name)) {
    throw new Error('Cannot overwrite built-in role');
  }
  if (!payload.displayName?.trim()) {
    throw new Error('displayName is required');
  }
  if (!payload.rolePrompt?.trim()) {
    throw new Error('rolePrompt is required');
  }
  if (!['low', 'medium', 'high'].includes(payload.effort)) {
    throw new Error('effort must be one of low, medium, high');
  }
}

function toConfigRole(payload: RoleUpsertConfigRolePayload): ConfigRoleEntry {
  const summary: RoleConfigRoleSummary = {
    name: payload.name.trim(),
    displayName: payload.displayName.trim(),
    ...(payload.description?.trim() ? { description: payload.description.trim() } : {}),
    rolePrompt: payload.rolePrompt.trim(),
    tools: stringList(payload.tools),
    effort: payload.effort,
    permissions: normalizePermissions(payload.permissions),
    tags: stringList(payload.tags),
    origin: 'config',
  };
  return {
    ...summary,
    model: { default: null, fallback: [], provider: null },
    outputSchema: { format: 'markdown', sections: [] },
    handoff: { to: [], from: [], requiresReview: true },
  };
}

function candidateToContract(candidate: AgencyRoleCandidatePayload): RoleContract {
  return {
    name: candidate.name,
    displayName: candidate.displayName,
    ...(candidate.description ? { description: candidate.description } : {}),
    rolePrompt: candidate.rolePrompt,
    tools: stringList(candidate.tools),
    capabilities: [],
    toolRequirements: [],
    riskProfile: candidate.riskProfile,
    canModifyScope: false,
    permissions: normalizePermissions(candidate.permissions),
    model: { default: null, fallback: [] },
    effort: candidate.effort,
    outputSchema: {
      format: candidate.outputFormat,
      sections: stringList(candidate.outputSections),
    },
    handoff: {
      to: stringList(candidate.handoffTo),
      from: stringList(candidate.handoffFrom),
      requiresReview: candidate.requiresReview,
    },
    tags: stringList(candidate.tags),
  };
}

function contractToConfigRole(contract: RoleContract): ConfigRoleEntry {
  return {
    name: contract.name,
    displayName: contract.displayName,
    ...(contract.description ? { description: contract.description } : {}),
    rolePrompt: contract.rolePrompt,
    tools: stringList(contract.tools),
    effort: ['low', 'medium', 'high'].includes(contract.effort)
      ? contract.effort as 'low' | 'medium' | 'high'
      : 'medium',
    permissions: {
      filesystem: contract.permissions.filesystem,
      network: contract.permissions.network,
      commands: stringList(contract.permissions.commands),
      ...(contract.permissions.readPaths?.length
        ? { readPaths: stringList(contract.permissions.readPaths) }
        : {}),
      ...(contract.permissions.writePaths?.length
        ? { writePaths: stringList(contract.permissions.writePaths) }
        : {}),
    },
    tags: stringList(contract.tags),
    origin: 'config',
    capabilities: stringList(contract.capabilities),
    toolRequirements: stringList(contract.toolRequirements),
    riskProfile: contract.riskProfile,
    canModifyScope: contract.canModifyScope ?? false,
    model: {
      default: contract.model.default ?? null,
      fallback: stringList(contract.model.fallback),
      ...(contract.model.provider !== undefined ? { provider: contract.model.provider } : {}),
    },
    outputSchema: {
      format: contract.outputSchema.format,
      sections: stringList(contract.outputSchema.sections),
    },
    handoff: {
      to: stringList(contract.handoff.to),
      from: stringList(contract.handoff.from),
      requiresReview: contract.handoff.requiresReview ?? true,
    },
  };
}

function toRoleSummary(role: ConfigRoleEntry): RoleConfigRoleSummary {
  return {
    name: role.name,
    displayName: role.displayName,
    ...(role.description ? { description: role.description } : {}),
    rolePrompt: role.rolePrompt,
    tools: [...role.tools],
    effort: role.effort,
    permissions: structuredClone(role.permissions),
    tags: [...role.tags],
    origin: 'config',
  };
}

function ensureAgentsConfig(config: OpenClawConfigWithRoles): Record<string, unknown> & { roles?: unknown } {
  if (!config.agents || typeof config.agents !== 'object' || Array.isArray(config.agents)) {
    config.agents = {};
  }
  return config.agents;
}

function readExistingRoles(config: OpenClawConfigWithRoles): unknown[] {
  const agents = ensureAgentsConfig(config);
  return Array.isArray(agents.roles) ? agents.roles : [];
}

function readRoleName(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = (value as Record<string, unknown>).name;
  return typeof name === 'string' ? name : null;
}

function readRoleTags(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return stringList((value as Record<string, unknown>).tags);
}

async function writeConfigRole(role: ConfigRoleEntry): Promise<void> {
  await withConfigLock(async () => {
    const config = await readOpenClawConfig() as OpenClawConfigWithRoles;
    const agents = ensureAgentsConfig(config);
    const existing = readExistingRoles(config)
      .filter((entry) => readRoleName(entry) !== role.name);
    agents.roles = [...existing, role];
    await writeOpenClawConfig(config);
  });
}

async function removeConfigRole(name: string, contractSha256: string): Promise<boolean> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as OpenClawConfigWithRoles;
    const agents = ensureAgentsConfig(config);
    const roles = readExistingRoles(config);
    const digestTag = contractDigestTag(contractSha256);
    const exact = roles.find((entry) => (
      readRoleName(entry) === name && readRoleTags(entry).includes(digestTag)
    ));
    if (!exact) return false;
    agents.roles = roles.filter((entry) => entry !== exact);
    await writeOpenClawConfig(config);
    return true;
  });
}

async function hasEquivalentConfigRole(name: string, contractSha256: string): Promise<boolean> {
  const config = await readOpenClawConfig() as OpenClawConfigWithRoles;
  const digestTag = contractDigestTag(contractSha256);
  return readExistingRoles(config).some((entry) => (
    readRoleName(entry) === name && readRoleTags(entry).includes(digestTag)
  ));
}

async function hasConfigRoleName(name: string): Promise<boolean> {
  const config = await readOpenClawConfig() as OpenClawConfigWithRoles;
  return readExistingRoles(config).some((entry) => readRoleName(entry) === name);
}

function contractDigestTag(contractSha256: string): string {
  return `agency-contract:${contractSha256.slice(0, 12)}`;
}

function validateRepository(sourceRoot: string): AgencyRepositoryCatalog {
  const root = sourceRoot.trim();
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error('Agency repository directory does not exist.');
  }
  for (const relativePath of ['divisions.json', 'tools.json', join('strategy', 'runbooks.json')]) {
    if (!existsSync(join(root, relativePath))) {
      throw new Error(`Agency repository is missing ${relativePath.replace(/\\/g, '/')}.`);
    }
  }
  const catalog = importAgencyDraftRolesFromRepository(root);
  if (catalog.entries.some((entry) => !entry.sourceRef)) {
    throw new Error('Agency repository contains a draft without source identity.');
  }
  return catalog;
}

function toCandidatePayload(contract: RoleContract): AgencyRoleCandidatePayload {
  const role = contractToConfigRole(contract);
  return {
    ...toRoleSummary(role),
    outputFormat: role.outputSchema.format,
    outputSections: [...role.outputSchema.sections],
    handoffTo: [...role.handoff.to],
    handoffFrom: [...role.handoff.from],
    requiresReview: role.handoff.requiresReview,
    riskProfile: role.riskProfile ?? 'medium',
  };
}

function toDraftSummary(entry: AgencyDraftRoleEntry): AgencyRoleDraftSummary {
  if (!entry.sourceRef || !entry.roleCandidate) {
    throw new Error(`Agency draft "${entry.id}" is missing source identity or a role candidate.`);
  }
  return {
    id: entry.id,
    status: 'draft',
    ...(entry.sourceDivision ? { sourceDivision: entry.sourceDivision } : {}),
    sourceAgentName: entry.sourceAgentName,
    roleName: entry.roleName,
    displayName: entry.displayName,
    ...(entry.description ? { description: entry.description } : {}),
    capabilityHints: [...entry.capabilityHints],
    toolHints: [...entry.toolHints],
    handoffHints: [...entry.handoffHints],
    sourceRef: { ...entry.sourceRef },
    roleCandidate: toCandidatePayload(entry.roleCandidate),
    validationIssues: entry.validationIssues.map((issue) => ({ ...issue })),
    toolMappingSuggestions: suggestAgencyToolMappings(entry),
  };
}

function findDraft(catalog: AgencyRepositoryCatalog, draftId: string): AgencyDraftRoleEntry {
  const draft = catalog.entries.find((entry) => entry.id === draftId);
  if (!draft) throw new Error(`Agency draft "${draftId}" was not found.`);
  if (!draft.sourceRef) throw new Error(`Agency draft "${draftId}" has no source fingerprint.`);
  return draft;
}

function toPromotionCandidate(payload: AgencyRoleReviewPayload): AgencyPromotionCandidate {
  return {
    contract: candidateToContract(payload.candidate),
    toolHintDispositions: payload.toolHintDispositions.map((entry) => ({
      hint: entry.hint,
      disposition: entry.disposition,
      selectedTools: [...entry.selectedTools],
      reviewerNote: entry.reviewerNote,
    })),
    evidenceQualification: payload.evidenceQualification,
    evidenceRefs: [...payload.evidenceRefs],
  };
}

function createReviewId(): string {
  return `agency-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function publicRecord(record: StoredAgencyRolePromotionRecord): AgencyRolePromotionRecord {
  const { sourceRoot: _sourceRoot, ...result } = record;
  return result;
}

function sanitizedMaterializationError(): string {
  return 'OpenClaw config role materialization failed.';
}

async function reconcileRecords(
  records: StoredAgencyRolePromotionRecord[],
): Promise<StoredAgencyRolePromotionRecord[]> {
  const store = await createRolePromotionStore();
  const reconciled: StoredAgencyRolePromotionRecord[] = [];
  for (const record of records) {
    if (
      record.decision === 'approved'
      && ['pending', 'failed'].includes(record.materialization.status)
      && record.materializedRoleName
      && await hasEquivalentConfigRole(record.materializedRoleName, record.contractSha256)
    ) {
      const next: StoredAgencyRolePromotionRecord = {
        ...record,
        lifecycle: 'active',
        materialization: { status: 'complete' },
      };
      await store.put(next);
      reconciled.push(next);
    } else {
      reconciled.push(record);
    }
  }
  return reconciled;
}

export function createRolesApi(): CompleteHostServiceRegistry['roles'] {
  return {
    upsertConfigRole: async (payload) => {
      validatePayload(payload);
      const role = toConfigRole(payload);

      await writeConfigRole(role);

      return {
        success: true,
        role: toRoleSummary(role),
        pendingRuntimeRefresh: true,
      };
    },
    agencyCatalog: async (payload) => {
      try {
        const catalog = validateRepository(payload.sourceRoot);
        const store = await createRolePromotionStore();
        const reviews = await reconcileRecords(await store.list());
        return {
          success: true,
          drafts: catalog.entries.map(toDraftSummary),
          reviews: reviews.map(publicRecord),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unable to read Agency repository.',
          drafts: [],
          reviews: [],
        };
      }
    },
    previewAgencyPromotion: async (payload) => {
      const catalog = validateRepository(payload.sourceRoot);
      const draft = findDraft(catalog, payload.draftId);
      const validation = validateAgencyPromotionCandidate(draft, toPromotionCandidate(payload));
      const role = contractToConfigRole(validation.contract);
      return {
        success: true,
        persisted: false,
        validation: {
          ok: validation.ok,
          issues: validation.issues.map((issue) => ({ ...issue })),
        },
        contractSha256: fingerprintRoleContract(validation.contract),
        role: toRoleSummary(role),
      };
    },
    reviewAgencyPromotion: async (payload) => {
      const catalog = validateRepository(payload.sourceRoot);
      const draft = findDraft(catalog, payload.draftId);
      const candidate = toPromotionCandidate(payload);
      const contract = materializeAgencyRoleContract(draft, candidate);
      const now = new Date().toISOString();
      const record: StoredAgencyRolePromotionRecord = {
        id: createReviewId(),
        draftId: draft.id,
        sourceRoot: payload.sourceRoot,
        sourceRef: { ...draft.sourceRef! },
        lifecycle: 'reviewed',
        evidenceQualification: payload.evidenceQualification,
        evidenceRefs: stringList(payload.evidenceRefs),
        reviewer: payload.reviewer.trim(),
        reviewedAt: now,
        comment: payload.comment.trim(),
        candidate: toCandidatePayload(contract),
        toolHintDispositions: payload.toolHintDispositions.map((entry) => ({
          ...entry,
          selectedTools: stringList(entry.selectedTools),
          reviewerNote: entry.reviewerNote.trim(),
        })),
        contractSha256: fingerprintRoleContract(contract),
        materialization: { status: 'not-started' },
      };
      const store = await createRolePromotionStore();
      await store.put(record);
      return {
        success: true,
        record: publicRecord(record),
        pendingRuntimeRefresh: false,
      };
    },
    approveAgencyPromotion: async (payload) => {
      const store = await createRolePromotionStore();
      const current = await store.get(payload.reviewId);
      if (!current) throw new Error(`Agency promotion review "${payload.reviewId}" was not found.`);
      if (current.lifecycle === 'active' && current.materialization.status === 'complete') {
        return {
          success: true,
          record: publicRecord(current),
          pendingRuntimeRefresh: true,
        };
      }
      const catalog = validateRepository(current.sourceRoot);
      const draft = findDraft(catalog, current.draftId);
      if (draft.sourceRef!.sha256 !== current.sourceRef.sha256
        || draft.sourceRef!.relativePath !== current.sourceRef.relativePath) {
        return {
          success: false,
          error: 'Agency source changed after review; review the current fingerprint again.',
          record: publicRecord(current),
          pendingRuntimeRefresh: false,
        };
      }

      const contract = materializeAgencyRoleContract(draft, {
        contract: candidateToContract(current.candidate),
        toolHintDispositions: current.toolHintDispositions,
        evidenceQualification: current.evidenceQualification,
        evidenceRefs: current.evidenceRefs,
      });
      const digest = fingerprintRoleContract(contract);
      if (digest !== current.contractSha256) {
        return {
          success: false,
          error: 'Reviewed role contract digest no longer matches the candidate.',
          record: publicRecord(current),
          pendingRuntimeRefresh: false,
        };
      }
      if (
        BUILT_IN_ROLE_NAMES.has(contract.name)
        || (await hasConfigRoleName(contract.name)
          && !await hasEquivalentConfigRole(contract.name, digest))
      ) {
        return {
          success: false,
          error: `Role name "${contract.name}" is already occupied.`,
          record: publicRecord(current),
          pendingRuntimeRefresh: false,
        };
      }

      const decidedAt = new Date().toISOString();
      const pending: StoredAgencyRolePromotionRecord = {
        ...current,
        decision: 'approved',
        decidedBy: payload.reviewer.trim(),
        decidedAt,
        comment: payload.comment.trim(),
        materializedRoleName: contract.name,
        materialization: { status: 'pending' },
      };
      await store.put(pending);
      try {
        const role = contractToConfigRole(contract);
        role.tags = stringList([...role.tags, contractDigestTag(digest)]);
        await writeConfigRole(role);
        const complete: StoredAgencyRolePromotionRecord = {
          ...pending,
          lifecycle: 'active',
          materialization: { status: 'complete' },
        };
        await store.put(complete);
        return {
          success: true,
          record: publicRecord(complete),
          pendingRuntimeRefresh: true,
        };
      } catch {
        const failed: StoredAgencyRolePromotionRecord = {
          ...pending,
          lifecycle: 'reviewed',
          materialization: {
            status: 'failed',
            error: sanitizedMaterializationError(),
          },
        };
        await store.put(failed);
        return {
          success: false,
          error: failed.materialization.error,
          record: publicRecord(failed),
          pendingRuntimeRefresh: false,
        };
      }
    },
    retireAgencyPromotion: async (payload) => {
      const store = await createRolePromotionStore();
      const current = await store.get(payload.reviewId);
      if (!current) throw new Error(`Agency promotion review "${payload.reviewId}" was not found.`);
      if (
        current.lifecycle !== 'active'
        || current.materialization.status !== 'complete'
        || !current.materializedRoleName
      ) {
        return {
          success: false,
          error: 'Only an active materialized Agency role can be retired.',
          record: publicRecord(current),
          pendingRuntimeRefresh: false,
        };
      }
      if (!await hasEquivalentConfigRole(current.materializedRoleName, current.contractSha256)) {
        return {
          success: false,
          error: 'The exact reviewed digest is no longer present; a replacement role was preserved.',
          record: publicRecord(current),
          pendingRuntimeRefresh: false,
        };
      }
      const removed = await removeConfigRole(current.materializedRoleName, current.contractSha256);
      if (!removed) {
        return {
          success: false,
          error: 'The exact reviewed digest could not be retired.',
          record: publicRecord(current),
          pendingRuntimeRefresh: false,
        };
      }
      const retired: StoredAgencyRolePromotionRecord = {
        ...current,
        lifecycle: 'retired',
        decision: 'retired',
        decidedBy: payload.reviewer.trim(),
        decidedAt: new Date().toISOString(),
        comment: payload.comment.trim(),
      };
      await store.put(retired);
      return {
        success: true,
        record: publicRecord(retired),
        pendingRuntimeRefresh: true,
      };
    },
  };
}
