import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
  facts: [] as Array<Record<string, unknown>>,
  invalidations: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../openclaw_runtime/src/runtime-core/memory-context', () => ({
  resolveRuntimeMemoryFeatureFlags: () => ({
    shadow: true,
    provider: true,
    proposeFacts: true,
    persist: true,
    candidateGeneration: true,
  }),
}));

vi.mock('../../openclaw_runtime/src/runtime-core/memory-runtime-integration', () => ({
  createRuntimeMemoryRuntimeIntegration: () => ({
    loadStore: () => ({
      status: 'loaded',
      store: {
        queryFacts: (query: { verificationStatus?: string; limit?: number } = {}) => {
          const rows = query.verificationStatus
            ? runtimeState.facts.filter((fact) => fact.verificationStatus === query.verificationStatus)
            : runtimeState.facts.filter((fact) => fact.verificationStatus !== 'candidate' && fact.verificationStatus !== 'invalidated');
          return rows.slice(0, query.limit ?? rows.length);
        },
        getFactById: (id: string) => runtimeState.facts.find((fact) => fact.factId === id),
      },
    }),
    invalidateFact: (proposal: Record<string, unknown>) => {
      runtimeState.invalidations.push(proposal);
      const fact = runtimeState.facts.find((entry) => entry.factId === proposal.factId);
      if (fact) fact.verificationStatus = 'invalidated';
      return {
        status: 'persisted',
        persisted: true,
        stored: true,
        duplicate: false,
        value: proposal,
      };
    },
  }),
}));

import {
  buildMemorySurface,
  deleteMemorySurfaceEntry,
} from '../../openclaw_runtime/src/gateway/server-methods/memory-surface';

const config = {
  runtime: {
    memory: {
      shadow: true,
      provider: true,
      proposeFacts: true,
      persist: true,
      injectPilot: { enabled: true, providers: ['runtime-memory'] },
    },
  },
};

function runtimeFact(overrides: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    factId: 'fact-1',
    subject: 'release',
    predicate: 'prefers',
    objectSummary: 'concise notes',
    confidence: 0.9,
    source: 'task_event',
    verificationStatus: 'human_approved',
    sourceEpisodeRefs: [{ episodeId: 'episode-1', taskId: 'task-1' }],
    evidenceRefs: [{ type: 'trace', ref: 'trace-1' }],
    valid_at: 1_700_000_000_000,
    reference_time: 1_700_000_000_000,
    acceptedAt: 1_700_000_000_100,
    sensitivity: 'normal',
    ...overrides,
  };
}

describe('Memory surface runtime projection', () => {
  beforeEach(() => {
    process.env.OPENCLAW_ROLE_MEMORY_ENABLED = '0';
    runtimeState.facts = [
      runtimeFact({ factId: 'accepted-fact' }),
      runtimeFact({
        factId: 'candidate-fact',
        verificationStatus: 'candidate',
        proposedAt: 1_700_000_000_200,
        acceptedAt: undefined,
      }),
    ];
    runtimeState.invalidations = [];
  });

  it('keeps runtime candidates out of model context while exposing accepted runtime facts', async () => {
    const surface = await buildMemorySurface({ getRuntimeConfig: () => config, limit: 50 });

    expect(surface.accepted).toEqual([
      expect.objectContaining({
        id: 'accepted-fact',
        source: 'runtime-fact',
        state: 'accepted',
        injectable: true,
        retrievable: true,
        modelVisible: true,
      }),
    ]);
    expect(surface.candidates).toEqual([
      expect.objectContaining({
        id: 'candidate-fact',
        source: 'runtime-fact',
        state: 'candidate',
        injectable: false,
        retrievable: false,
        modelVisible: false,
      }),
    ]);
    expect(surface.model.acceptedKeys).toEqual(['runtime-fact:accepted-fact']);
    expect(surface.model.candidateKeysExcluded).toEqual(['runtime-fact:candidate-fact']);
    expect(surface.status.runtimeMemory).toMatchObject({
      candidateCapture: true,
      candidatePersistence: true,
      modelRetrieval: true,
    });
    expect(surface.counts).toEqual({ accepted: 1, candidates: 1, modelVisible: 1 });
  });

  it('keeps secret runtime memory deleteable without exposing its content or making it model-visible', async () => {
    runtimeState.facts = [
      runtimeFact({
        factId: 'secret-fact',
        sensitivity: 'secret',
        subject: 'credential',
        predicate: 'contains',
        objectSummary: 'secret material',
      }),
    ];
    runtimeState.invalidations = [];

    const surface = await buildMemorySurface({ getRuntimeConfig: () => config, limit: 50 });

    expect(surface.accepted).toEqual([
      expect.objectContaining({
        id: 'secret-fact',
        content: '[redacted secret runtime memory]',
        subject: '[redacted]',
        predicate: '[redacted]',
        objectSummary: '[redacted]',
        injectable: false,
        modelVisible: false,
        deletable: true,
      }),
    ]);
    expect(surface.model.acceptedKeys).toEqual([]);
  });

  it('invalidates a runtime fact through the Runtime Memory owner and reads the removal back', async () => {
    const outcome = await deleteMemorySurfaceEntry({
      source: 'runtime-fact',
      id: 'accepted-fact',
      reason: 'memory surface test',
      getRuntimeConfig: () => config,
    });

    expect(outcome).toMatchObject({
      ok: true,
      deleted: true,
      source: 'runtime-fact',
      id: 'accepted-fact',
      state: 'invalidated',
    });
    expect(runtimeState.invalidations).toHaveLength(1);
    expect(runtimeState.invalidations[0]).toMatchObject({
      factId: 'accepted-fact',
      reason: 'retracted',
      proposedBy: 'human_confirmation',
      verificationStatus: 'human_approved',
    });

    const after = await buildMemorySurface({ getRuntimeConfig: () => config, limit: 50 });
    expect(after.accepted).toEqual([]);
    expect(after.model.acceptedKeys).toEqual([]);
  });
});
