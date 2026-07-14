import type { AgencyRolePromotionRecord } from '@shared/host-api/contract';

type PromotionStoreDocument = {
  records: StoredAgencyRolePromotionRecord[];
};

export type StoredAgencyRolePromotionRecord = AgencyRolePromotionRecord & {
  sourceRoot: string;
};

export type RolePromotionStore = {
  list(): Promise<StoredAgencyRolePromotionRecord[]>;
  get(id: string): Promise<StoredAgencyRolePromotionRecord | undefined>;
  put(record: StoredAgencyRolePromotionRecord): Promise<void>;
};

const MAX_RECORDS = 2_000;
let storeInstance: { get(key: 'records'): unknown; set(key: 'records', value: StoredAgencyRolePromotionRecord[]): void } | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function normalizeRecord(value: unknown): StoredAgencyRolePromotionRecord | undefined {
  if (!isRecord(value) || !isRecord(value.sourceRef) || !isRecord(value.candidate)) return undefined;
  if (!isRecord(value.materialization) || !Array.isArray(value.toolHintDispositions)) return undefined;
  const lifecycle = value.lifecycle;
  const qualification = value.evidenceQualification;
  const status = value.materialization.status;
  if (!['draft', 'reviewed', 'active', 'retired'].includes(String(lifecycle))) return undefined;
  if (!['unverified', 'scenario-verified', 'release-qualified'].includes(String(qualification))) return undefined;
  if (!['not-started', 'pending', 'complete', 'failed'].includes(String(status))) return undefined;

  const requiredStrings = [
    value.id,
    value.draftId,
    value.sourceRoot,
    value.sourceRef.relativePath,
    value.sourceRef.sha256,
    value.reviewer,
    value.reviewedAt,
    value.comment,
    value.contractSha256,
  ];
  if (requiredStrings.some((entry) => typeof entry !== 'string' || !entry)) return undefined;
  if (!isStringArray(value.evidenceRefs)) return undefined;

  return structuredClone(value) as StoredAgencyRolePromotionRecord;
}

async function getStore() {
  if (!storeInstance) {
    const Store = (await import('electron-store')).default;
    const options = {
      name: 'agency-role-promotions',
      projectName: 'Verse Claw',
      defaults: { records: [] },
    };
    storeInstance = new Store<PromotionStoreDocument>(
      // electron-store forwards projectName to conf, but its public options type omits it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options as any,
    );
  }
  return storeInstance;
}

async function readRecords(): Promise<StoredAgencyRolePromotionRecord[]> {
  try {
    const store = await getStore();
    const raw = store.get('records');
    return Array.isArray(raw) ? raw.flatMap((entry) => {
      const record = normalizeRecord(entry);
      return record ? [record] : [];
    }) : [];
  } catch {
    return [];
  }
}

async function writeRecords(records: StoredAgencyRolePromotionRecord[]): Promise<void> {
  const store = await getStore();
  store.set('records', records.slice(0, MAX_RECORDS));
}

export async function createRolePromotionStore(): Promise<RolePromotionStore> {
  return {
    list: async () => {
      await writeQueue;
      return readRecords();
    },
    get: async (id) => {
      await writeQueue;
      return (await readRecords()).find((record) => record.id === id);
    },
    put: async (record) => {
      const write = writeQueue.then(async () => {
        const records = await readRecords();
        await writeRecords([record, ...records.filter((entry) => entry.id !== record.id)]);
      });
      writeQueue = write.then(
        () => undefined,
        () => undefined,
      );
      await write;
    },
  };
}
