// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_AUTHORITY_MANIFEST,
  validateComponentAuthorityManifest,
} from '../../shared/component-authority-manifest';
import {
  MEMORY_AUTHORITY_DATA_TYPES,
  MEMORY_AUTHORITY_MANIFEST,
  MEMORY_MIGRATION_MAP,
  MEMORY_PRODUCT_PROFILE,
  MEMORY_STORE_BOUNDARIES,
  validateMemoryAuthorityManifest,
} from '../../openclaw_runtime/src/memory/memory-authority';
import {
  RuntimeMemoryStore,
} from '../../openclaw_runtime/src/runtime-core/memory-store';
import {
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  isRuntimeMemoryAcceptedVerificationStatus,
} from '../../openclaw_runtime/src/runtime-core/memory-context';
import {
  isInjectableMemoryCard,
  isMemoryCardInContextScope,
} from '../../openclaw_runtime/src/memory/memory-card';
import {
  assertSingleMemorySlotOwner,
  buildSlotMechanismCensus,
} from '../../openclaw_runtime/src/agents/slot-convergence';
import type { MemoryCard } from '../../openclaw_runtime/src/memory/types';

describe('TF-0497 MemoryAuthorityManifest/v1', () => {
  it('derives every memory authority from the canonical component manifest', () => {
    const shared = validateComponentAuthorityManifest(COMPONENT_AUTHORITY_MANIFEST);
    expect(shared).toMatchObject({ ok: true, issues: [] });

    const byComponentId = new Map(
      COMPONENT_AUTHORITY_MANIFEST.components.map((component) => [component.id, component]),
    );
    for (const entry of MEMORY_AUTHORITY_MANIFEST.entries) {
      for (const authorityId of [entry.operations.accept, entry.operations.update, entry.operations.delete].filter(Boolean)) {
        const component = byComponentId.get(authorityId as string);
        expect(component, authorityId ?? '').toBeDefined();
        expect(component?.ownedDataTypes).toContain(entry.dataType);
      }
      for (const readerId of entry.operations.retrieve) {
        expect(byComponentId.get(readerId)?.allowedReads, readerId).toContain(entry.dataType);
      }
      if (entry.acceptedMemory) {
        expect(entry.operations.accept).toBeTruthy();
      } else {
        expect(entry.operations.accept).toBeNull();
      }
    }
  });

  it('has one accepting/update authority per data type and scope', () => {
    const result = validateMemoryAuthorityManifest();
    expect(result).toMatchObject({
      ok: true,
      issues: [],
      duplicateAcceptedAuthorities: 0,
      duplicateUpdateAuthorities: 0,
      parallelPromptInjectionPaths: 0,
      databaseClusteringRequired: false,
    });
    expect(new Set(MEMORY_AUTHORITY_DATA_TYPES).size).toBe(MEMORY_AUTHORITY_DATA_TYPES.length);
    expect(MEMORY_AUTHORITY_MANIFEST.entries).toHaveLength(MEMORY_AUTHORITY_DATA_TYPES.length);
  });

  it('defines consistent lifecycle and migration semantics for every domain', () => {
    for (const entry of MEMORY_AUTHORITY_MANIFEST.entries) {
      expect(entry.scopes.length, entry.dataType).toBeGreaterThan(0);
      expect(entry.lifecycle.retention.length, entry.dataType).toBeGreaterThan(20);
      expect(entry.lifecycle.delete.length, entry.dataType).toBeGreaterThan(20);
      expect(entry.lifecycle.invalidation.length, entry.dataType).toBeGreaterThan(20);
      expect(entry.lifecycle.retrieval.length, entry.dataType).toBeGreaterThan(20);
      if (entry.acceptedMemory) {
        expect(
          entry.lifecycle.injection === 'accepted-only' ||
          (entry.lifecycle.injection === 'never' && entry.injectionAuthority === null),
        ).toBe(true);
      } else {
        expect(entry.lifecycle.injection === 'never' || entry.lifecycle.injection === 'read-only-retrieval').toBe(true);
      }
    }

    for (const mapping of MEMORY_MIGRATION_MAP) {
      expect(mapping.removesSource).toBe(false);
      expect(mapping.rollback.length).toBeGreaterThan(10);
      expect(MEMORY_AUTHORITY_DATA_TYPES).toContain(mapping.targetDataType);
    }
    expect(MEMORY_STORE_BOUNDARIES.map((boundary) => boundary.id)).toEqual([
      'role-memory.sqlite',
      'openclaw-state.sqlite',
      'native-memory-files',
      'knowledge-store',
    ]);
    expect(MEMORY_STORE_BOUNDARIES.filter((boundary) => boundary.canonicalForAcceptedMemory).length).toBeGreaterThan(1);
  });

  it('keeps candidates non-retrievable and non-injectable until accepted', () => {
    const store = new RuntimeMemoryStore();
    const accepted = buildRuntimeMemoryTemporalFactFixture({ factId: 'accepted-fact' });
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({ factId: 'candidate-fact' });

    expect(store.appendFact(accepted).accepted).toBe(true);
    expect(store.appendFact(candidate).accepted).toBe(true);
    expect(store.queryFacts().map((fact) => fact.factId)).toEqual(['accepted-fact']);
    expect(store.queryFacts({ includeCandidates: true }).map((fact) => fact.factId)).toEqual([
      'accepted-fact',
      'candidate-fact',
    ]);
    expect(isRuntimeMemoryAcceptedVerificationStatus(candidate.verificationStatus)).toBe(false);
    expect(isRuntimeMemoryAcceptedVerificationStatus(accepted.verificationStatus)).toBe(true);
  });

  it('enforces scope isolation and blocks inactive cards from injection', () => {
    const workspaceCard = {
      id: 'workspace-card',
      scope: 'workspace',
      scopeKey: 'workspace-a',
      status: 'active',
      content: 'workspace fact',
      type: 'fact',
      roleTags: [],
      evidence: [],
      confidence: 1,
      importance: 1,
      lastAccessedAt: new Date(0).toISOString(),
      createdAt: new Date(0).toISOString(),
      accessCount: 1,
      version: 1,
      sensitivity: 'normal',
    } as MemoryCard;

    expect(isMemoryCardInContextScope(workspaceCard, { workspace: 'workspace-a' })).toBe(true);
    expect(isMemoryCardInContextScope(workspaceCard, { workspace: 'workspace-b' })).toBe(false);
    expect(isInjectableMemoryCard(workspaceCard)).toBe(true);
    expect(isInjectableMemoryCard({ ...workspaceCard, status: 'tombstone' })).toBe(false);
  });

  it('describes one product memory concept with a fail-closed approval boundary', () => {
    expect(MEMORY_PRODUCT_PROFILE.concept).toBe('memory');
    expect(MEMORY_PRODUCT_PROFILE.conceptCount).toBe(1);
    expect(MEMORY_PRODUCT_PROFILE.approvalBoundary).toEqual({
      automaticProposalAllowed: true,
      automaticAcceptanceAllowed: false,
      automaticWritebackAllowed: false,
      modelCanAcceptMemory: false,
      modelCanDeleteAcceptedMemory: false,
    });
    const summary = MEMORY_PRODUCT_PROFILE.modelSafeSummary.join(' ').toLowerCase();
    for (const forbidden of ['role memory', 'runtime memory', 'dreaming', 'embedding']) {
      expect(summary).not.toContain(forbidden);
    }
    expect(summary).toContain('memory');
    expect(summary).toContain('approval');
  });

  it('retains a single configured memory writer and zero SEKB auto-writeback', () => {
    const census = buildSlotMechanismCensus({
      registeredPlugins: [
        { id: 'memory-core', kind: 'memory' },
        { id: 'memory-lancedb', kind: 'memory' },
      ],
      memorySlotId: 'memory-core',
      runtimeMemoryPersist: false,
    });
    expect(census.parallelMemoryWriters).toBe(0);
    expect(census.autoWritebackCount).toBe(0);
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'memory-core' })).toMatchObject({ ok: true });
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'runtime-memory', runtimeMemoryPersist: false }).ok).toBe(false);
  });
});
