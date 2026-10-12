import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUsageApi, recordPromptCacheObservation } from '@electron/services/usage-api';
import { getSetting } from '@electron/utils/store';

const storage = vi.hoisted(() => ({
  persisted: {} as Record<string, unknown>,
  instances: [] as Array<{ data: Record<string, unknown> }>,
  failWrites: false,
}));
vi.mock('electron', () => ({ app: { getLocale: () => 'en' } }));
vi.mock('electron-store', () => ({
  default: class {
    data: Record<string, unknown>;
    constructor() {
      this.data = structuredClone(storage.persisted);
      storage.instances.push(this);
    }
    get(key: string) { return structuredClone(this.data[key]); }
    set(key: string, value: unknown) {
      if (storage.failWrites) throw new Error('storage unavailable');
      this.data[key] = structuredClone(value);
      storage.persisted = structuredClone(this.data);
    }
  },
}));
vi.mock('@electron/utils/context-window', () => ({ resolveContextWindow: vi.fn() }));
vi.mock('@electron/utils/token-usage', () => ({
  getSessionTokenUsageSummary: vi.fn(async () => ({
    agentId: 'main', sessionId: 'session-a', usageStatus: 'available',
    inputTokens: 1_000, outputTokens: 0, cacheReadTokens: 4_000, cacheWriteTokens: 0,
    totalTokens: 5_000, entryCount: 1, missingEntryCount: 0, errorEntryCount: 0,
  })),
  getRecentTokenUsageHistory: vi.fn(),
  getUsageAggregateSummary: vi.fn(),
}));

beforeEach(() => {
  storage.persisted = {};
  storage.failWrites = false;
  for (const instance of storage.instances) instance.data = {};
});
const decision = {
  sessionKey: 'agent:main:main', action: 'model-switch', severity: 'high',
  status: 'at-risk', decision: 'cancelled', hitRate: 0.6, promptTokens: 10_000,
} as const;

const observation = {
  sessionKey: 'agent:main:main',
  eventId: 'run-1:0',
  previousCacheRead: 10_000,
  cacheRead: 4_000,
  changes: ['tools'],
};

describe('prompt cache observation ledger', () => {
  it('labels explicit action decisions as confirmed without trusting a caller-supplied source', async () => {
    const result = await createUsageApi().recordPromptCacheRiskEvent({ ...decision, source: 'observed' } as never);
    expect(result.event).toMatchObject({ source: 'confirmed', decision: 'cancelled' });
  });

  it('does not overwrite concurrent confirmed decision writes', async () => {
    // Warm the store to isolate the existing read/modify/write race from initialization.
    await getSetting('promptCacheRiskLedger');
    const api = createUsageApi();
    await Promise.all(Array.from({ length: 20 }, (_, id) => api.recordPromptCacheRiskEvent({
      ...decision, sessionKey: `agent:main:session-${id}`,
    })));
    expect(await getSetting('promptCacheRiskLedger')).toHaveLength(20);
  });

  it('records an observed break as bounded metadata, not a decision', async () => {
    const stored = await recordPromptCacheObservation(observation);
    expect(stored).toMatchObject({
      source: 'observed',
      sessionKey: 'agent:main:main',
      eventId: 'run-1:0',
      previousCacheRead: 10_000,
      cacheRead: 4_000,
      changes: ['tools'],
    });
    expect(stored).not.toHaveProperty('decision');
  });

  it('drops malformed observations and unknown change codes', async () => {
    expect(await recordPromptCacheObservation({ ...observation, cacheRead: 'nope' })).toBeNull();
    expect(await recordPromptCacheObservation({ ...observation, eventId: '' })).toBeNull();
    const stored = await recordPromptCacheObservation({ ...observation, changes: ['tools', 'bogus'] });
    expect(stored?.changes).toEqual(['tools']);
  });

  it('deduplicates replayed observed frames by eventId', async () => {
    const first = await recordPromptCacheObservation(observation);
    const replay = await recordPromptCacheObservation(observation);
    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(await getSetting('promptCacheRiskLedger')).toHaveLength(1);
  });

  it('does not lose concurrent observed and confirmed writes', async () => {
    const api = createUsageApi();
    await Promise.all([
      ...Array.from({ length: 10 }, (_, id) =>
        recordPromptCacheObservation({ ...observation, eventId: `obs-${id}` })),
      ...Array.from({ length: 10 }, (_, id) =>
        api.recordPromptCacheRiskEvent({ ...decision, sessionKey: `agent:main:s-${id}` })),
    ]);
    const ledger = (await getSetting('promptCacheRiskLedger')) as Array<{ source?: string }>;
    expect(ledger).toHaveLength(20);
    expect(ledger.filter((entry) => entry.source === 'observed')).toHaveLength(10);
    expect(ledger.filter((entry) => entry.source === 'confirmed')).toHaveLength(10);
  });

  it('caps the shared ledger at 200 rows regardless of source', async () => {
    for (let id = 0; id < 130; id += 1) {
      await recordPromptCacheObservation({ ...observation, eventId: `obs-${id}` });
    }
    const api = createUsageApi();
    for (let id = 0; id < 130; id += 1) {
      await api.recordPromptCacheRiskEvent({ ...decision, sessionKey: `agent:main:s-${id}` });
    }
    const ledger = await getSetting('promptCacheRiskLedger');
    expect(ledger).toHaveLength(200);
  });

  it('treats a legacy row without source as a confirmed decision', async () => {
    // Seed a persisted legacy row (pre-`source`) directly into the live store
    // instance, as an upgraded install would already have on disk.
    // getSessionTokenUsageSummary is mocked to agentId 'main' / sessionId
    // 'session-a', so the assessment key is agent:main:session-a.
    const seeded = {
      promptCacheRiskLedger: [
        { ...decision, sessionKey: 'agent:main:session-a', updatedAt: 1 },
      ],
    };
    await getSetting('promptCacheRiskLedger');
    for (const instance of storage.instances) {
      instance.data = structuredClone(seeded);
    }
    storage.persisted = structuredClone(seeded);

    const result = await createUsageApi().promptCacheStatus({ sessionKey: 'agent:main:session-a' });
    expect(result.assessment.lastRiskEvent?.sessionKey).toBe('agent:main:session-a');
    expect(result.assessment.warningCount).toBe(1);
    expect(result.assessment.lastObservedBreak).toBeUndefined();
  });
});
