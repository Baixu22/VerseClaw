import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  VG_COMPLETION_CONTRACT_VERSION,
  VG_COMPLETION_STORE_SCHEMA,
  VG_HOST_COMPLETION_MAPPING,
  VG_HOST_COMPLETION_SCHEMA,
  VG_LEGACY_COMPLETION_SCHEMA,
  type VerseGitCompletionIdentity,
  type VerseGitCompletionSink,
  type VerseGitCompletionStoreRecord,
  type VerseGitHostCompletionFact,
  type VerseGitHostCompletionOutcome,
  type VerseGitLegacyCompletionRecord,
} from '../../shared/types/versegit.ts';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function digestValue(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
function oidValue(value: string): boolean {
  return /^[a-f0-9]{40,64}$/u.test(value);
}
function fileFor(root: string, category: 'sessions' | 'legacy', sessionId: string): string {
  return join(root, category, digest(sessionId) + '.json');
}
function canonical(value: unknown): string {
  return JSON.stringify(stable(value));
}
function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.' + process.pid + '.' + Date.now() + '.tmp';
  writeFileSync(temp, canonical(value) + '\n', 'utf8');
  if (existsSync(path)) rmSync(path, { force: true });
  renameSync(temp, path);
}
function validateIdentity(identity: VerseGitCompletionIdentity): string[] {
  const issues: string[] = [];
  if (!nonEmpty(identity.ownerId)) issues.push('ownerId');
  if (!Number.isInteger(identity.epoch) || identity.epoch < 0) issues.push('epoch');
  if (!nonEmpty(identity.authorizationId)) issues.push('authorizationId');
  if (!nonEmpty(identity.sessionId)) issues.push('sessionId');
  if (!nonEmpty(identity.runId)) issues.push('runId');
  if (!nonEmpty(identity.candidateId)) issues.push('candidateId');
  if (!oidValue(identity.candidateTreeOid)) issues.push('candidateTreeOid');
  if (!digestValue(identity.candidateInputDigest)) issues.push('candidateInputDigest');
  if (!digestValue(identity.receiptDigest)) issues.push('receiptDigest');
  if (!nonEmpty(identity.effectId)) issues.push('effectId');
  return issues;
}

export class FileVerseGitCompletionStore implements VerseGitCompletionSink {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  contract() {
    return {
      schema: VG_COMPLETION_CONTRACT_VERSION,
      mapping: VG_HOST_COMPLETION_MAPPING,
      providerSemantics: {
        providerLanded: false,
        sessionEndedMeans: 'abandoned/non-landed',
        hostCompletedProjectionSource: 'host-completion-fact',
      },
    } as const;
  }

  read(sessionId: string): VerseGitCompletionStoreRecord | null {
    const path = fileFor(this.root, 'sessions', sessionId);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as VerseGitCompletionStoreRecord;
    if (parsed.schema !== VG_COMPLETION_STORE_SCHEMA) {
      throw new Error('completion_store_schema_unsupported');
    }
    if (parsed.current?.schema !== VG_HOST_COMPLETION_SCHEMA
      || parsed.current?.contractVersion !== VG_COMPLETION_CONTRACT_VERSION) {
      throw new Error('completion_fact_schema_unsupported');
    }
    return parsed;
  }

  record(input: {
    identity: VerseGitCompletionIdentity;
    hostOutcome: VerseGitHostCompletionOutcome;
    idempotencyKey: string;
    actor: string;
    reason?: string | null;
    recoveryOf?: string | null;
    recordedAt?: string;
  }): { status: 'recorded' | 'duplicate' | 'rejected'; reason: string | null; fact: VerseGitHostCompletionFact | null } {
    const identityIssues = validateIdentity(input.identity);
    if (identityIssues.length > 0) return { status: 'rejected', reason: 'identity_invalid:' + identityIssues.join(','), fact: null };
    if (!nonEmpty(input.actor)) return { status: 'rejected', reason: 'actor_missing', fact: null };
    if (!nonEmpty(input.idempotencyKey)) return { status: 'rejected', reason: 'idempotency_key_missing', fact: null };
    const mapping = VG_HOST_COMPLETION_MAPPING[input.hostOutcome];
    if (!mapping) return { status: 'rejected', reason: 'host_outcome_invalid', fact: null };
    const factId = digest({
      identity: input.identity,
      hostOutcome: input.hostOutcome,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? null,
      recoveryOf: input.recoveryOf ?? null,
    });
    const existing = this.read(input.identity.sessionId);
    if (existing) {
      if (existing.current.identity.ownerId !== input.identity.ownerId
        || existing.current.identity.authorizationId !== input.identity.authorizationId
        || existing.current.identity.runId !== input.identity.runId
        || existing.current.identity.candidateId !== input.identity.candidateId
        || existing.current.identity.candidateTreeOid !== input.identity.candidateTreeOid
        || existing.current.identity.candidateInputDigest !== input.identity.candidateInputDigest
        || existing.current.identity.receiptDigest !== input.identity.receiptDigest
        || existing.current.identity.effectId !== input.identity.effectId) {
        return { status: 'rejected', reason: 'identity_drift', fact: null };
      }
      if (existing.current.idempotencyKey === input.idempotencyKey) {
        return existing.current.factId === factId
          ? { status: 'duplicate', reason: 'duplicate_completion', fact: existing.current }
          : { status: 'rejected', reason: 'idempotency_conflict', fact: existing.current };
      }
      if (input.identity.epoch < existing.current.identity.epoch) {
        return { status: 'rejected', reason: 'late_epoch', fact: existing.current };
      }
      if (existing.current.hostOutcome === 'applied') {
        return { status: 'rejected', reason: 'completion_terminal', fact: existing.current };
      }
      if (existing.current.hostOutcome === 'unknown' && input.recoveryOf !== existing.current.factId) {
        return { status: 'rejected', reason: 'recovery_required', fact: existing.current };
      }
      if (input.identity.epoch > existing.current.identity.epoch && input.recoveryOf !== existing.current.factId) {
        return { status: 'rejected', reason: 'epoch_recovery_unbound', fact: existing.current };
      }
    }
    const fact: VerseGitHostCompletionFact = {
      schema: VG_HOST_COMPLETION_SCHEMA,
      contractVersion: VG_COMPLETION_CONTRACT_VERSION,
      factId,
      idempotencyKey: input.idempotencyKey,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      actor: input.actor,
      drivenBy: 'agent',
      identity: { ...input.identity },
      hostOutcome: input.hostOutcome,
      providerProjection: mapping.providerProjection,
      providerProjectionSource: 'host-completion-fact',
      providerLanded: false,
      activeSessionRisk: mapping.activeSessionRisk,
      recoveryRequired: mapping.recoveryRequired,
      reason: input.reason ?? null,
      legacyUnbound: false,
      recoveryOf: input.recoveryOf ?? null,
    };
    const record: VerseGitCompletionStoreRecord = {
      schema: VG_COMPLETION_STORE_SCHEMA,
      sessionId: input.identity.sessionId,
      revision: (existing?.revision ?? 0) + 1,
      current: fact,
      history: existing ? [...existing.history, existing.current] : [],
    };
    atomicWrite(fileFor(this.root, 'sessions', input.identity.sessionId), record);
    return { status: 'recorded', reason: null, fact };
  }

  projectProviderState(sessionId: string): 'active' | 'abandoned' | 'host-completed' {
    return this.read(sessionId)?.current.providerProjection ?? 'active';
  }

  activeSessionRisk(sessionId: string): boolean {
    const record = this.read(sessionId);
    return record ? record.current.activeSessionRisk : true;
  }

  activeRiskSessions(sessionIds: Iterable<string>): string[] {
    return [...sessionIds].filter((sessionId) => this.activeSessionRisk(sessionId));
  }

  writeLegacyRecord(record: VerseGitLegacyCompletionRecord): void {
    if (record.schema !== VG_LEGACY_COMPLETION_SCHEMA) throw new Error('legacy schema mismatch');
    atomicWrite(fileFor(this.root, 'legacy', record.sessionId), record);
  }

  readLegacy(sessionId: string): VerseGitHostCompletionFact | null {
    const path = fileFor(this.root, 'legacy', sessionId);
    if (!existsSync(path)) return null;
    const legacy = JSON.parse(readFileSync(path, 'utf8')) as VerseGitLegacyCompletionRecord;
    if (legacy.schema !== VG_LEGACY_COMPLETION_SCHEMA) throw new Error('legacy schema mismatch');
    const hostOutcome: VerseGitHostCompletionOutcome =
      legacy.outcome === 'cancelled' || legacy.outcome === 'failed' ? 'not_applied' : 'unknown';
    const bindingMissing = legacy.outcome === 'success' || legacy.outcome === 'unknown';
    const mapping = VG_HOST_COMPLETION_MAPPING[hostOutcome];
    return {
      schema: VG_HOST_COMPLETION_SCHEMA,
      contractVersion: VG_COMPLETION_CONTRACT_VERSION,
      factId: digest({ legacy }),
      idempotencyKey: 'legacy:' + sessionId,
      recordedAt: legacy.recordedAt ?? new Date(0).toISOString(),
      actor: 'legacy-host',
      drivenBy: 'agent',
      identity: {
        ownerId: 'legacy-unbound',
        epoch: 0,
        authorizationId: 'legacy-unbound',
        sessionId,
        runId: 'legacy-unbound',
        candidateId: legacy.candidateId ?? 'legacy-unbound',
        candidateTreeOid: '0'.repeat(40),
        candidateInputDigest: '0'.repeat(64),
        receiptDigest: legacy.receiptDigest ?? '0'.repeat(64),
        effectId: 'legacy-unbound',
      },
      hostOutcome,
      providerProjection: mapping.providerProjection,
      providerProjectionSource: 'host-completion-fact',
      providerLanded: false,
      activeSessionRisk: false,
      recoveryRequired: bindingMissing,
      reason: bindingMissing ? 'legacy_completion_identity_missing' : 'legacy_terminal_outcome',
      legacyUnbound: bindingMissing,
      recoveryOf: null,
    };
  }
}

export function createVerseGitCompletionStore(root: string): FileVerseGitCompletionStore {
  return new FileVerseGitCompletionStore(root);
}
