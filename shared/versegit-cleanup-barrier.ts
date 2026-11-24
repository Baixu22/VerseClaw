import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  VG_CLEANUP_BARRIER_SCHEMA,
  VG_CLEANUP_RESOURCE_KINDS,
  type VerseGitCleanupBarrierPort,
  type VerseGitCleanupBarrierRecord,
  type VerseGitCleanupIdentity,
  type VerseGitCleanupInventory,
  type VerseGitCleanupResource,
  type VerseGitCleanupResourceKind,
  type VerseGitCleanupSealInput,
} from './types/versegit.ts';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OID_PATTERN = /^[a-f0-9]{40,64}$/u;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(stable(value));
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function verseGitCleanupDigest(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function resourceFile(root: string, runId: string): string {
  return join(root, 'cleanup', digest(runId) + '.json');
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, canonical(value) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
  // Keep the previous seal readable until its complete replacement succeeds.
  try { renameSync(temporary, path); }
  finally { try { rmSync(temporary, { force: true }); } catch { /* Preserve the replacement error. */ } }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function identityIssues(identity: VerseGitCleanupIdentity): string[] {
  const issues: string[] = [];
  if (!nonEmpty(identity.ownerId)) issues.push('identity_owner_missing');
  if (!Number.isInteger(identity.epoch) || identity.epoch < 1) issues.push('identity_epoch_invalid');
  if (!nonEmpty(identity.authorizationId)) issues.push('identity_authorization_missing');
  if (!OID_PATTERN.test(identity.baseOid)) issues.push('identity_base_oid_invalid');
  if (!DIGEST_PATTERN.test(identity.refsDigest)) issues.push('identity_refs_digest_invalid');
  return issues;
}

function sameIdentity(left: VerseGitCleanupIdentity, right: VerseGitCleanupIdentity): boolean {
  return left.ownerId === right.ownerId
    && left.epoch === right.epoch
    && left.authorizationId === right.authorizationId
    && left.baseOid === right.baseOid
    && left.refsDigest === right.refsDigest;
}

function inventoryIssues(
  inventory: VerseGitCleanupInventory,
  resources: readonly VerseGitCleanupResource[],
): string[] {
  const issues: string[] = [];
  if (!inventory.observed) issues.push('resource_inventory_unobserved');
  for (const key of ['processes', 'managers', 'worktrees', 'tempRoots'] as const) {
    const count = inventory[key];
    if (count !== null && (!Number.isInteger(count) || count < 0)) issues.push('resource_inventory_invalid:' + key);
  }
  if (inventory.survivors?.some((value) => !nonEmpty(value))) issues.push('resource_inventory_survivors_invalid');
  const expected = {
    process: resources.filter((resource) => resource.kind === 'process').length,
    manager: resources.filter((resource) => resource.kind === 'manager').length,
    worktree: resources.filter((resource) => resource.kind === 'worktree').length,
    temp: resources.filter((resource) => resource.kind === 'temp').length,
  };
  if (inventory.processes !== null && inventory.processes !== expected.process) issues.push('resource_inventory_mismatch:processes');
  if (inventory.managers !== null && inventory.managers !== expected.manager) issues.push('resource_inventory_mismatch:managers');
  if (inventory.worktrees !== null && inventory.worktrees !== expected.worktree) issues.push('resource_inventory_mismatch:worktrees');
  if (inventory.tempRoots !== null && inventory.tempRoots !== expected.temp) issues.push('resource_inventory_mismatch:tempRoots');
  return issues;
}

function sealIdFor(input: VerseGitCleanupSealInput): string {
  return digest({
    runId: input.runId,
    sessionId: input.sessionId,
    bindingId: input.bindingId,
    expected: input.expected,
    evidenceDigests: [...input.evidenceDigests].sort(),
    resources: [...input.resources].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)),
    deletedKinds: [...input.deletedKinds].sort(),
  });
}

function validateSeal(input: VerseGitCleanupSealInput): string[] {
  const issues: string[] = [];
  if (!nonEmpty(input.runId)) issues.push('run_id_missing');
  if (!nonEmpty(input.sessionId)) issues.push('session_id_missing');
  if (!nonEmpty(input.bindingId)) issues.push('binding_id_missing');
  if (!nonEmpty(input.actor)) issues.push('actor_missing');
  issues.push(...identityIssues(input.expected), ...identityIssues(input.current));
  if (!sameIdentity(input.expected, input.current)) {
    for (const key of ['ownerId', 'epoch', 'authorizationId', 'baseOid', 'refsDigest'] as const) {
      if (input.expected[key] !== input.current[key]) issues.push('identity_mismatch:' + key);
    }
  }
  if (!input.stopAccepting) issues.push('stop_accepting_not_confirmed');
  if (!input.drain.ok) issues.push('drain_not_confirmed', ...input.drain.issues);
  if (input.references.length > 0) issues.push('references_still_present');
  if (input.evidenceDigests.length === 0 || input.evidenceDigests.some((entry) => !DIGEST_PATTERN.test(entry))) {
    issues.push('evidence_not_sealed');
  }
  issues.push(...inventoryIssues(input.inventoryBefore, input.resources));
  const ids = new Set<string>();
  for (const resource of input.resources) {
    if (!VG_CLEANUP_RESOURCE_KINDS.includes(resource.kind)) issues.push('resource_kind_invalid');
    if (!nonEmpty(resource.id)) issues.push('resource_id_missing');
    if (resource.target !== undefined && !nonEmpty(resource.target)) issues.push('resource_target_invalid');
    if (!resource.owned) issues.push('resource_not_agent_owned');
    if (resource.preserve) issues.push('resource_must_be_preserved');
    const key = resource.kind + ':' + resource.id;
    if (ids.has(key)) issues.push('resource_duplicate');
    ids.add(key);
  }
  if (input.deletedKinds.length === 0) issues.push('deleted_kinds_missing');
  if (new Set(input.deletedKinds).size !== input.deletedKinds.length) issues.push('deleted_kinds_duplicate');
  const resourceKinds = new Set(input.resources.map((resource) => resource.kind));
  if ([...resourceKinds].some((kind) => !input.deletedKinds.includes(kind))) {
    issues.push('deleted_kinds_incomplete');
  }
  return [...new Set(issues)];
}

function failedRecord(input: VerseGitCleanupSealInput, sealId: string, issues: string[]): VerseGitCleanupBarrierRecord {
  const at = new Date().toISOString();
  return {
    schema: VG_CLEANUP_BARRIER_SCHEMA,
    sealId,
    runId: input.runId,
    sessionId: input.sessionId,
    bindingId: input.bindingId,
    actor: input.actor,
    driven_by: 'agent',
    sealedAt: at,
    deletedAt: null,
    status: 'rejected',
    stages: input.stopAccepting ? { stop_accepting: at } : {},
    expected: { ...input.expected },
    current: { ...input.current },
    references: [...input.references],
    evidenceDigests: [...input.evidenceDigests].sort(),
    inventoryBefore: { ...input.inventoryBefore, survivors: [...(input.inventoryBefore.survivors ?? [])] },
    inventoryAfter: null,
    resources: input.resources.map((resource) => ({ ...resource })),
    deletedKinds: [...input.deletedKinds],
    issues,
    lateEvents: [],
  };
}

/** Durable host-side barrier for every VerseGit disposable-resource deletion path. */
export class FileVerseGitCleanupBarrier implements VerseGitCleanupBarrierPort {
  readonly root: string;

  constructor(root: string) {
    if (!nonEmpty(root)) throw new Error('cleanup_barrier_root_required');
    this.root = resolve(root);
  }

  read(runId: string): VerseGitCleanupBarrierRecord | null {
    if (!nonEmpty(runId)) return null;
    const path = resourceFile(this.root, runId);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as VerseGitCleanupBarrierRecord;
    if (parsed.schema !== VG_CLEANUP_BARRIER_SCHEMA) throw new Error('cleanup_barrier_schema_unsupported');
    return parsed;
  }

  private write(record: VerseGitCleanupBarrierRecord): void {
    atomicWrite(resourceFile(this.root, record.runId), record);
  }

  seal(input: VerseGitCleanupSealInput): { ok: boolean; sealId: string | null; issues: string[]; record: VerseGitCleanupBarrierRecord | null } {
    const sealId = sealIdFor(input);
    const existing = this.read(input.runId);
    if (existing) {
      if (existing.sealId !== sealId) {
        return { ok: false, sealId: existing.sealId, issues: ['cleanup_seal_conflict'], record: existing };
      }
      if (existing.status === 'rejected' && !existing.issues.every(issue =>
        ['drain_not_confirmed', 'processes_still_running', 'references_still_present'].includes(issue)
        || issue.startsWith('session_stop_failed:'))) {
        return { ok: false, sealId: existing.sealId, issues: [...existing.issues], record: existing };
      }
      if (existing.status === 'deleted') return { ok: true, sealId, issues: [], record: existing };
    }

    // The immutable seal fixes ownership; drain and references must be observed again on retry.
    const issues = validateSeal(input);
    if (issues.length > 0) {
      const record = existing ?? failedRecord(input, sealId, issues);
      if (!existing) this.write(record);
      return { ok: false, sealId, issues, record };
    }
    if (existing && existing.status !== 'rejected') return { ok: true, sealId, issues: [], record: existing };
    const at = new Date().toISOString();
    const record: VerseGitCleanupBarrierRecord = {
      schema: VG_CLEANUP_BARRIER_SCHEMA,
      sealId,
      runId: input.runId,
      sessionId: input.sessionId,
      bindingId: input.bindingId,
      actor: input.actor,
      driven_by: 'agent',
      sealedAt: at,
      deletedAt: null,
      status: 'sealed',
      stages: {
        stop_accepting: at,
        drain_cancel: at,
        seal_evidence: at,
      },
      expected: { ...input.expected },
      current: { ...input.current },
      references: [...input.references],
      evidenceDigests: [...input.evidenceDigests].sort(),
      inventoryBefore: { ...input.inventoryBefore, survivors: [...(input.inventoryBefore.survivors ?? [])] },
      inventoryAfter: null,
      resources: input.resources.map((resource) => ({ ...resource })),
      deletedKinds: [...input.deletedKinds],
      issues: [],
      lateEvents: existing?.lateEvents ?? [],
    };
    this.write(record);
    return { ok: true, sealId, issues: [], record };
  }

  markDetached(input: { runId: string; sealId: string; current: VerseGitCleanupIdentity; vgDetached: boolean }): { ok: boolean; issues: string[]; record: VerseGitCleanupBarrierRecord | null } {
    const record = this.read(input.runId);
    if (!record) return { ok: false, issues: ['cleanup_seal_missing'], record: null };
    if (record.status === 'deleted') return { ok: true, issues: [], record };
    if (record.sealId !== input.sealId) return { ok: false, issues: ['cleanup_seal_mismatch'], record };
    if (record.status === 'rejected') return { ok: false, issues: record.issues, record };
    const issues: string[] = [];
    if (!input.vgDetached) issues.push('vg_detach_not_confirmed');
    if (!sameIdentity(record.expected, input.current)) {
      for (const key of ['ownerId', 'epoch', 'authorizationId', 'baseOid', 'refsDigest'] as const) {
        if (record.expected[key] !== input.current[key]) issues.push('identity_mismatch:' + key);
      }
    }
    if (issues.length > 0) {
      return { ok: false, issues, record: this.recoveryRequired({ runId: input.runId, sealId: input.sealId, issues, inventoryAfter: null }).record };
    }
    const at = new Date().toISOString();
    const updated: VerseGitCleanupBarrierRecord = {
      ...record,
      status: 'detached',
      current: { ...input.current },
      issues: record.status === 'recovery_required' ? [] : record.issues,
      stages: {
        ...record.stages,
        detach_vg: at,
        verify_owner_epoch_ref: at,
      },
    };
    this.write(updated);
    return { ok: true, issues: [], record: updated };
  }

  complete(input: { runId: string; sealId: string; inventoryAfter: VerseGitCleanupInventory }): { ok: boolean; issues: string[]; record: VerseGitCleanupBarrierRecord | null } {
    const record = this.read(input.runId);
    if (!record) return { ok: false, issues: ['cleanup_seal_missing'], record: null };
    if (record.status === 'deleted') return { ok: true, issues: [], record };
    if (record.sealId !== input.sealId) return { ok: false, issues: ['cleanup_seal_mismatch'], record };
    if (record.status !== 'detached') return { ok: false, issues: ['cleanup_not_detached'], record };
    const issues: string[] = [];
    if (!input.inventoryAfter.observed) issues.push('post_cleanup_inventory_unobserved');
    for (const field of ['processes', 'managers', 'worktrees', 'tempRoots'] as const) {
      if (input.inventoryAfter[field] !== 0) issues.push('survivor:' + field);
    }
    if ((input.inventoryAfter.survivors?.length ?? 0) > 0) issues.push('survivors_reported');
    if (issues.length > 0) {
      const recovered = this.recoveryRequired({
        runId: input.runId,
        sealId: input.sealId,
        issues,
        inventoryAfter: input.inventoryAfter,
      });
      return { ok: false, issues, record: recovered.record };
    }
    const at = new Date().toISOString();
    const updated: VerseGitCleanupBarrierRecord = {
      ...record,
      deletedAt: at,
      status: 'deleted',
      inventoryAfter: { ...input.inventoryAfter, survivors: [...(input.inventoryAfter.survivors ?? [])] },
      stages: { ...record.stages, delete_disposable: at },
    };
    this.write(updated);
    return { ok: true, issues: [], record: updated };
  }

  recoveryRequired(input: { runId: string; sealId?: string | null; issues: readonly string[]; inventoryAfter: VerseGitCleanupInventory | null }): { ok: boolean; record: VerseGitCleanupBarrierRecord | null } {
    const record = this.read(input.runId);
    if (!record) return { ok: false, record: null };
    if (record.status === 'deleted') return { ok: false, record };
    if (input.sealId && record.sealId !== input.sealId) return { ok: false, record };
    const updated: VerseGitCleanupBarrierRecord = {
      ...record,
      status: 'recovery_required',
      inventoryAfter: input.inventoryAfter
        ? { ...input.inventoryAfter, survivors: [...(input.inventoryAfter.survivors ?? [])] }
        : null,
      issues: [...new Set([...record.issues, ...input.issues])],
    };
    this.write(updated);
    return { ok: true, record: updated };
  }

  observeLateEvent(input: { runId: string; event: string; epoch: number }): { accepted: boolean; record: VerseGitCleanupBarrierRecord | null } {
    const record = this.read(input.runId);
    if (!record) return { accepted: true, record: null };
    const updated: VerseGitCleanupBarrierRecord = {
      ...record,
      lateEvents: [
        ...record.lateEvents,
        { event: input.event, epoch: input.epoch, at: new Date().toISOString(), accepted: false },
      ],
    };
    this.write(updated);
    return { accepted: false, record: updated };
  }

  authorizeDeletion(input: Omit<import('./types/versegit.ts').VerseGitCleanupDeletionAuthorization, 'barrierRoot'>): { ok: boolean; issues: string[]; record: VerseGitCleanupBarrierRecord | null } {
    const record = this.read(input.runId);
    if (!record) return { ok: false, issues: ['cleanup_seal_missing'], record: null };
    if (record.sealId !== input.sealId) return { ok: false, issues: ['cleanup_seal_mismatch'], record };
    if (record.status !== 'detached') return { ok: false, issues: ['cleanup_not_detached'], record };
    const issues: string[] = [];
    if (!sameIdentity(record.expected, input.expected)) issues.push('identity_mismatch');
    const resource = record.resources.find((entry) => entry.kind === input.resourceKind && entry.id === input.resourceId);
    if (!resource) issues.push('resource_not_owned');
    else if (!resource.owned) issues.push('resource_not_agent_owned');
    else if (resource.preserve) issues.push('resource_must_be_preserved');
    return { ok: issues.length === 0, issues, record };
  }
}

export function createVerseGitCleanupBarrier(root: string): FileVerseGitCleanupBarrier {
  return new FileVerseGitCleanupBarrier(root);
}

export function verseGitCleanupResourceId(kind: VerseGitCleanupResourceKind, identity: string): string {
  return verseGitCleanupDigest(kind + '\0' + identity.replaceAll('\\', '/').toLowerCase());
}
export function assertVerseGitCleanupDeletionAllowed(input: import('./types/versegit.ts').VerseGitCleanupDeletionAuthorization): VerseGitCleanupBarrierRecord {
  const barrier = new FileVerseGitCleanupBarrier(input.barrierRoot);
  const checked = barrier.authorizeDeletion({
    runId: input.runId,
    sealId: input.sealId,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    expected: input.expected,
  });
  if (!checked.ok || !checked.record) {
    throw new Error('versegit_cleanup_barrier_rejected:' + checked.issues.join(','));
  }
  return checked.record;
}

export function cleanupInventoryFromResources(
  resources: readonly VerseGitCleanupResource[],
  observed = true,
): VerseGitCleanupInventory {
  const count = (kind: VerseGitCleanupResourceKind): number =>
    resources.filter((resource) => resource.kind === kind).length;
  return {
    observed,
    processes: count('process'),
    managers: count('manager'),
    worktrees: count('worktree'),
    tempRoots: count('temp'),
    survivors: [],
  };
}
