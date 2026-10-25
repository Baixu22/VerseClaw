import { describe, expect, it } from 'vitest';
import { COMPONENT_AUTHORITY_MANIFEST } from '@shared/component-authority-manifest';
import {
  MEMORY_CONTROL_PLANE_MANIFEST,
  validateMemoryControlPlaneManifest,
  type MemoryControlPlaneManifest,
  type MemoryDomainAuthority,
} from '@shared/memory/control-plane';

const domains = new Map(MEMORY_CONTROL_PLANE_MANIFEST.domains.map((domain) => [domain.id, domain]));

describe('MemoryControlPlaneManifest/v1', () => {
  it('has one accepting authority for every accepted-memory data type and scope', () => {
    expect(validateMemoryControlPlaneManifest()).toEqual([]);
    for (const domain of MEMORY_CONTROL_PLANE_MANIFEST.domains.filter((entry) => entry.kind === 'accepted')) {
      for (const scope of domain.scopes) {
        const matches = COMPONENT_AUTHORITY_MANIFEST.authorities.filter((assignment) => (
          assignment.dataType === domain.dataType
          && assignment.scope === scope
          && domain.acceptanceOperations.includes(assignment.operation)
        ));
        expect(matches, domain.id + ':' + scope).toHaveLength(1);
        expect(matches[0].authorityComponentId).toBe(domain.authorityComponentId);
      }
    }
  });

  it('keeps runtime, role, embedding and Dreaming responsibilities distinct', () => {
    expect(domains.get('role-memory-card')).toMatchObject({
      authorityComponentId: 'role-memory-card-governance',
      writeBoundary: 'review-required',
      retrieval: 'accepted-only',
    });
    expect(domains.get('runtime-fact')).toMatchObject({
      authorityComponentId: 'runtime-memory-store',
      scopes: ['session', 'run'],
      retrieval: 'accepted-only',
    });
    expect(domains.get('embedding-index')).toMatchObject({
      authorityComponentId: 'memory-embedding-provider',
      kind: 'derived',
      injectable: false,
      migration: expect.stringContaining('rebuildable'),
    });
    expect(domains.get('dreaming-derived-cache')).toMatchObject({
      authorityComponentId: 'dreaming-derived-cache',
      kind: 'derived',
      injectable: false,
      deletion: expect.stringContaining('without deleting accepted memory'),
    });
  });

  it('never retrieves or injects unapproved candidates', () => {
    expect(domains.get('memory-candidate')).toMatchObject({ kind: 'candidate', retrieval: 'none', injectable: false });
    const candidate = COMPONENT_AUTHORITY_MANIFEST.components.find((component) => component.id === 'memory-candidate-queue');
    expect(candidate?.forbiddenActions).toContain('inject-candidate-into-prompt');
  });

  it('describes one model-safe memory product concept and approval boundary', () => {
    expect(MEMORY_CONTROL_PLANE_MANIFEST.productConcept).toMatchObject({
      id: 'memory',
      label: 'Memory',
      acceptedOnlyForPrompt: true,
    });
    expect(MEMORY_CONTROL_PLANE_MANIFEST.productConcept.modelSafeDescription).toContain('one reviewable product concept');
    expect(MEMORY_CONTROL_PLANE_MANIFEST.productConcept.approvalBoundary).toContain('never become accepted memory');
    expect(new Set(MEMORY_CONTROL_PLANE_MANIFEST.domains.map((domain) => domain.authorityComponentId)).size)
      .toBeGreaterThan(1);
  });

  it('reports duplicate and unsafe candidate/derived declarations', () => {
    const mutableDomains = [...structuredClone(MEMORY_CONTROL_PLANE_MANIFEST.domains)] as MemoryDomainAuthority[];
    mutableDomains.push({ ...mutableDomains.find((domain) => domain.id === 'runtime-fact')!, id: 'runtime-fact-copy' });
    const manifest = {
      ...structuredClone(MEMORY_CONTROL_PLANE_MANIFEST),
      domains: mutableDomains,
    } as unknown as MemoryControlPlaneManifest;
    mutableDomains.find((domain) => domain.id === 'memory-candidate')!.injectable = true;
    mutableDomains.find((domain) => domain.id === 'embedding-index')!.injectable = true;
    const codes = validateMemoryControlPlaneManifest(manifest).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'duplicate_data_type',
      'candidate_is_injectable',
      'derived_is_injectable',
    ]));
  });
});
