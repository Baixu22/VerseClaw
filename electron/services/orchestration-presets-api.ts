// Trusted Orchestration Presets (Area 3 §3.3) — workspace-scoped standing
// approvals for named orchestration shapes.
//
// Let the user pre-approve specific (workspace × template × role-set ×
// maxWorkers) combinations so `gateway.rpc('orchestrator.run')` doesn't
// prompt every time for a daily-run team — while `orchestrator.run` itself
// stays out of `SAFE_GATEWAY_METHODS`. The gate is not weakened: every run
// still passes through `decideGatewayRpc`; a preset is a user-granted
// standing approval with a precise scope, narrower than switching the
// workspace to fullAccess (§9 boundary).
//
// Internal state: electron-store JSON (Main-owned, consistent with workspace
// permission ownership). Lifecycle: created from an approval dialog;
// listed/revoked in workspace settings UI. Error handling: store read
// failure → treat as no presets → normal approval flow (degrade to today).
//
// Audit: every preset auto-approval records a `recordPermissionAudit` line
// with `reason: 'approved by preset X'` so the trust trail is inspectable.

import type { TrustedOrchestrationPreset } from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';

export type { TrustedOrchestrationPreset };

type PresetStoreDocument = {
  presets: TrustedOrchestrationPreset[];
};

export type OrchestrationPresetMatchInput = {
  workspaceId: string;
  templateId?: string;
  requestedRoles: readonly string[];
  maxWorkers?: number;
};

export type OrchestrationPresetMatchResult = {
  matched: boolean;
  preset?: TrustedOrchestrationPreset;
};

let presetStoreInstance: any = null;

async function getPresetStore() {
  if (!presetStoreInstance) {
    const Store = (await import('electron-store')).default;
    presetStoreInstance = new Store<PresetStoreDocument>({
      name: 'workspace-orchestration-presets',
      defaults: {
        presets: [],
      },
    });
  }
  return presetStoreInstance;
}

async function readPresets(): Promise<TrustedOrchestrationPreset[]> {
  try {
    const store = await getPresetStore();
    const raw = store.get('presets');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(normalizePreset);
  } catch {
    // Store read failure → treat as no presets → normal approval flow.
    return [];
  }
}

async function writePresets(presets: TrustedOrchestrationPreset[]): Promise<void> {
  const store = await getPresetStore();
  store.set('presets', presets);
}

function normalizePreset(value: unknown): TrustedOrchestrationPreset[] {
  if (!isRecord(value)) return [];
  const id = typeof value.id === 'string' ? value.id : undefined;
  const workspaceId = typeof value.workspaceId === 'string' ? value.workspaceId : undefined;
  const label = typeof value.label === 'string' ? value.label : undefined;
  const allowedRoles = Array.isArray(value.allowedRoles)
    ? value.allowedRoles.filter((r): r is string => typeof r === 'string')
    : undefined;
  const maxWorkers = typeof value.maxWorkers === 'number' && Number.isFinite(value.maxWorkers)
    ? Math.floor(value.maxWorkers)
    : undefined;
  const approvedAt = typeof value.approvedAt === 'string' ? value.approvedAt : undefined;
  if (!id || !workspaceId || !label || !allowedRoles || !maxWorkers || !approvedAt) return [];
  if (maxWorkers < 1) return [];
  return [{
    id,
    workspaceId,
    label,
    ...(typeof value.templateId === 'string' ? { templateId: value.templateId } : {}),
    allowedRoles,
    maxWorkers,
    approvedAt,
    ...(typeof value.revokedAt === 'string' ? { revokedAt: value.revokedAt } : {}),
  }];
}

function createPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listOrchestrationPresets(
  workspaceId?: string,
): Promise<TrustedOrchestrationPreset[]> {
  const presets = await readPresets();
  if (!workspaceId) return presets;
  return presets.filter((p) => p.workspaceId === workspaceId);
}

export async function listActiveOrchestrationPresets(
  workspaceId: string,
): Promise<TrustedOrchestrationPreset[]> {
  const presets = await readPresets();
  return presets.filter((p) => p.workspaceId === workspaceId && !p.revokedAt);
}

export async function createOrchestrationPreset(input: {
  workspaceId: string;
  label: string;
  templateId?: string;
  allowedRoles: string[];
  maxWorkers: number;
}): Promise<TrustedOrchestrationPreset> {
  const presets = await readPresets();
  const preset: TrustedOrchestrationPreset = {
    id: createPresetId(),
    workspaceId: input.workspaceId,
    label: input.label.trim(),
    ...(input.templateId?.trim() ? { templateId: input.templateId.trim() } : {}),
    allowedRoles: input.allowedRoles.map((r) => r.trim()).filter(Boolean),
    maxWorkers: Math.max(1, Math.floor(input.maxWorkers)),
    approvedAt: new Date().toISOString(),
  };
  await writePresets([preset, ...presets]);
  return preset;
}

export async function revokeOrchestrationPreset(input: {
  workspaceId: string;
  presetId: string;
}): Promise<TrustedOrchestrationPreset | null> {
  const presets = await readPresets();
  let revoked: TrustedOrchestrationPreset | null = null;
  const next = presets.map((preset) => {
    if (preset.id === input.presetId && preset.workspaceId === input.workspaceId && !preset.revokedAt) {
      revoked = { ...preset, revokedAt: new Date().toISOString() };
      return revoked;
    }
    return preset;
  });
  if (revoked) {
    await writePresets(next);
  }
  return revoked;
}

/**
 * Determine whether an `orchestrator.run` request is covered by an active
 * preset for its workspace. Returns `matched: true` only when *all* of:
 *   - workspaceId matches
 *   - preset.templateId is undefined OR equals the request's templateId
 *   - every requested role is in preset.allowedRoles (subset)
 *   - request.maxWorkers (if specified) is ≤ preset.maxWorkers
 *
 * Exceeding the preset in any single dimension (extra role, higher
 * maxWorkers, different template) → `matched: false` → normal dialog (§8).
 * Revoked presets are excluded. Store read failure → no match (degrade to
 * today's approval flow).
 */
export function matchOrchestrationPreset(
  presets: readonly TrustedOrchestrationPreset[],
  input: OrchestrationPresetMatchInput,
): OrchestrationPresetMatchResult {
  const active = presets.filter(
    (p) => p.workspaceId === input.workspaceId && !p.revokedAt,
  );
  for (const preset of active) {
    if (preset.templateId && preset.templateId !== input.templateId) continue;
    if (input.templateId && preset.templateId && preset.templateId !== input.templateId) continue;
    const requestedSet = new Set(input.requestedRoles);
    const allRolesCovered = [...requestedSet].every((role) => preset.allowedRoles.includes(role));
    if (!allRolesCovered) continue;
    if (typeof input.maxWorkers === 'number' && input.maxWorkers > preset.maxWorkers) continue;
    return { matched: true, preset };
  }
  return { matched: false };
}

/**
 * Extract the requested role set from an `orchestrator.run` params object.
 * Returns explicit worker roleNames when provided; otherwise an empty array
 * (template-only requests are matched on templateId + maxWorkers alone —
 * template role resolution happens in the runtime, not in Main).
 */
export function extractRequestedRoles(params: unknown): string[] {
  if (!isRecord(params)) return [];
  const workers = params.workers;
  if (!Array.isArray(workers)) return [];
  const roles: string[] = [];
  for (const worker of workers) {
    if (isRecord(worker) && typeof worker.roleName === 'string') {
      const trimmed = worker.roleName.trim();
      if (trimmed) roles.push(trimmed);
    }
  }
  return roles;
}

export function extractTemplateId(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  const tid = typeof params.templateId === 'string' ? params.templateId.trim() : '';
  const ttid = typeof params.teamTemplateId === 'string' ? params.teamTemplateId.trim() : '';
  return tid || ttid || undefined;
}

export function extractMaxWorkers(params: unknown): number | undefined {
  if (!isRecord(params)) return undefined;
  if (typeof params.maxWorkers !== 'number' || !Number.isFinite(params.maxWorkers)) return undefined;
  return Math.max(1, Math.floor(params.maxWorkers));
}

type PresetListBody = {
  workspaceId?: unknown;
  includeRevoked?: unknown;
};

type PresetCreateBody = {
  workspaceId?: unknown;
  label?: unknown;
  templateId?: unknown;
  allowedRoles?: unknown;
  maxWorkers?: unknown;
};

type PresetRevokeBody = {
  workspaceId?: unknown;
  presetId?: unknown;
};

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Host API factory for the `orchestrationPresets` namespace. Exposes
 * list/create/revoke to the renderer so the workspace settings UI can manage
 * trusted orchestration presets. The auto-approval check itself lives in
 * `gateway-api.ts`'s approval branch (Main-owned, not renderer-callable).
 */
export function createOrchestrationPresetsApi(): CompleteHostServiceRegistry['orchestrationPresets'] {
  return {
    list: async (payload) => {
      const body = isRecord(payload) ? (payload as PresetListBody) : {};
      const workspaceId = normalizeString(body.workspaceId);
      const includeRevoked = body.includeRevoked === true;
      const presets = await readPresets();
      const filtered = presets.filter((preset) => (
        (!workspaceId || preset.workspaceId === workspaceId)
        && (includeRevoked || !preset.revokedAt)
      ));
      return { success: true, presets: filtered };
    },
    create: async (payload) => {
      const body = isRecord(payload) ? (payload as PresetCreateBody) : {};
      const workspaceId = normalizeString(body.workspaceId);
      const label = normalizeString(body.label);
      if (!workspaceId) {
        return { success: false, error: 'workspaceId is required' };
      }
      if (!label) {
        return { success: false, error: 'label is required' };
      }
      const templateId = normalizeString(body.templateId);
      const allowedRoles = Array.isArray(body.allowedRoles)
        ? body.allowedRoles.filter((r): r is string => typeof r === 'string' && r.trim() !== '').map((r) => r.trim())
        : [];
      if (allowedRoles.length === 0) {
        return { success: false, error: 'allowedRoles must be a non-empty array' };
      }
      const maxWorkers = typeof body.maxWorkers === 'number' && Number.isFinite(body.maxWorkers) && body.maxWorkers >= 1
        ? Math.floor(body.maxWorkers)
        : undefined;
      if (maxWorkers === undefined) {
        return { success: false, error: 'maxWorkers must be a positive integer' };
      }
      try {
        const preset = await createOrchestrationPreset({
          workspaceId,
          label,
          ...(templateId ? { templateId } : {}),
          allowedRoles,
          maxWorkers,
        });
        return { success: true, preset };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    revoke: async (payload) => {
      const body = isRecord(payload) ? (payload as PresetRevokeBody) : {};
      const workspaceId = normalizeString(body.workspaceId);
      const presetId = normalizeString(body.presetId);
      if (!workspaceId || !presetId) {
        return { success: false, error: 'workspaceId and presetId are required' };
      }
      const preset = await revokeOrchestrationPreset({ workspaceId, presetId });
      if (!preset) {
        return { success: false, error: 'preset not found or already revoked' };
      }
      return { success: true, preset };
    },
  };
}
