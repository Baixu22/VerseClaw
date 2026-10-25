import type { AppSettings } from '../utils/store';
import { getSetting, setSetting } from '../utils/store';
import type {
  DelegationClaimResult,
  StoredSessionDelegationAdmission,
} from './session-delegation-admission';

const STORE_KEY = 'sessionDelegationAdmissions';
const MAX_STORED_ADMISSIONS = 256;

let mutationTail: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationTail.then(operation, operation);
  mutationTail = next.then(() => undefined, () => undefined);
  return next;
}

function readStored(value: unknown): StoredSessionDelegationAdmission[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is StoredSessionDelegationAdmission => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Partial<StoredSessionDelegationAdmission>;
    return candidate.schemaVersion === 'clawx.session-delegation-store/v1'
      && typeof candidate.idempotencyKey === 'string'
      && typeof candidate.requestHash === 'string'
      && (candidate.phase === 'in-flight' || candidate.phase === 'approval-pending' || candidate.phase === 'terminal')
      && Boolean(candidate.receipt)
      && typeof candidate.createdAt === 'string'
      && typeof candidate.updatedAt === 'string';
  });
}

async function writeStored(records: StoredSessionDelegationAdmission[]): Promise<void> {
  const bounded = records
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_STORED_ADMISSIONS);
  await setSetting(STORE_KEY as never, bounded as never);
}

export async function readSessionDelegationAdmission(
  idempotencyKey: string,
): Promise<StoredSessionDelegationAdmission | null> {
  const records = readStored(await getSetting(STORE_KEY as keyof AppSettings as never));
  return records.find((record) => record.idempotencyKey === idempotencyKey) ?? null;
}

export async function claimSessionDelegationAdmission(
  candidate: StoredSessionDelegationAdmission,
): Promise<DelegationClaimResult> {
  return withStoreLock(async () => {
    const records = readStored(await getSetting(STORE_KEY as keyof AppSettings as never));
    const index = records.findIndex((record) => record.idempotencyKey === candidate.idempotencyKey);
    if (index < 0) {
      await writeStored([candidate, ...records]);
      return { kind: 'claimed' };
    }
    const existing = records[index]!;
    if (existing.requestHash !== candidate.requestHash) {
      return { kind: 'conflict', existingRequestHash: existing.requestHash };
    }
    if (existing.phase === 'approval-pending') {
      records[index] = { ...candidate, createdAt: existing.createdAt };
      await writeStored(records);
      return { kind: 'claimed' };
    }
    return { kind: 'existing', record: existing };
  });
}

export async function commitSessionDelegationAdmission(
  record: StoredSessionDelegationAdmission,
): Promise<void> {
  await withStoreLock(async () => {
    const records = readStored(await getSetting(STORE_KEY as keyof AppSettings as never));
    const index = records.findIndex((entry) => entry.idempotencyKey === record.idempotencyKey);
    if (index < 0) records.push(record);
    else records[index] = { ...record, createdAt: records[index]!.createdAt };
    await writeStored(records);
  });
}

export const sessionDelegationStoreTesting = {
  resetMutationTailForTest(): void {
    mutationTail = Promise.resolve();
  },
};