import { describe, expect, it } from 'vitest';
import type { KnowledgeErrorExperienceCard } from '@shared/host-api/contract';
import {
  matchErrorExperienceCards,
  normalizeErrorExperienceCard,
  updateErrorExperienceEffectiveness,
} from '@shared/knowledge/error-experience';

function sampleCard(): KnowledgeErrorExperienceCard {
  return {
    schemaVersion: 1,
    id: 'ee-route-context',
    title: 'Route context failure handling',
    summary: 'routeContext failures must not block ordinary chat send.',
    triggerPattern: {
      errorType: 'test',
      keywords: ['routeContext', 'knowledge side effect'],
      filePatterns: ['src/pages/Chat/**'],
      stackTraceSignature: 'RouteContextFailure',
      commandSignature: 'pnpm test',
      scenarioDescription: 'routeContext failure handling',
      routeQueries: ['route context failure'],
    },
    rootCause: {
      summary: 'Knowledge side effects were treated as required send steps.',
      contributingFactors: ['renderer side effect coupled to chat send'],
    },
    resolution: {
      steps: ['Keep knowledge matching best-effort.', 'Route renderer calls through hostApi.'],
      antiPattern: 'Throw from Chat send when routeContext fails.',
      correctPattern: 'Catch and render advisory only.',
      verificationCommands: ['pnpm exec vitest run tests/unit/chat-input.test.tsx'],
    },
    applicability: {
      projectScopes: ['current-workspace'],
      modules: ['src/pages/Chat'],
      roles: ['knowledge-librarian'],
      confidence: 0.72,
      severity: 'high',
    },
    provenance: {
      createdFrom: { kind: 'manual', id: 'test-card', label: 'Fixture' },
      sourceRefs: [{ id: 'notes/route-context.md', kind: 'wiki', label: 'Route context note' }],
      createdAt: '2026-07-04T00:00:00.000Z',
    },
    effectiveness: {
      hitCount: 1,
      acceptedCount: 0,
      dismissedCount: 0,
      preventedFailureCount: 0,
      staleCount: 0,
    },
  };
}

describe('error experience matcher', () => {
  it('normalizes valid cards and rejects incomplete cards', () => {
    const card = sampleCard();
    expect(normalizeErrorExperienceCard(card)).toMatchObject({
      id: 'ee-route-context',
      title: 'Route context failure handling',
      triggerPattern: {
        errorType: 'test',
        keywords: ['routeContext', 'knowledge side effect'],
      },
    });

    expect(normalizeErrorExperienceCard({ ...card, resolution: { steps: [] } })).toBeNull();
    expect(normalizeErrorExperienceCard({
      ...card,
      triggerPattern: {
        ...card.triggerPattern,
        keywords: [],
        filePatterns: [],
        routeQueries: [],
        stackTraceSignature: undefined,
        commandSignature: undefined,
      },
    })).toBeNull();
  });

  it('matches failures by keyword, file pattern, stack signature, and user correction', () => {
    const advisories = matchErrorExperienceCards([
      {
        targetKind: 'inbox',
        targetId: 'inbox-1',
        sourceRefs: [{ id: 'notes/route-context.md', kind: 'wiki', path: 'notes/route-context.md' }],
        card: sampleCard(),
      },
    ], {
      kind: 'test-failure',
      text: 'RouteContextFailure: routeContext knowledge side effect failed; wrong, redo',
      command: 'pnpm test',
      stackTrace: 'RouteContextFailure',
      filePaths: ['src/pages/Chat/index.tsx'],
    });

    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({
      targetKind: 'inbox',
      targetId: 'inbox-1',
      title: 'Route context failure handling',
      rootCause: 'Knowledge side effects were treated as required send steps.',
      recommendedResolution: ['Keep knowledge matching best-effort.', 'Route renderer calls through hostApi.'],
      severity: 'high',
    });
    expect(advisories[0].whyMatched.join(' ')).toContain('keyword');
    expect(advisories[0].whyMatched.join(' ')).toContain('file pattern');
    expect(advisories[0].confidence).toBeGreaterThan(0.5);
  });

  it('updates effectiveness counters immutably', () => {
    const card = sampleCard();
    const updated = updateErrorExperienceEffectiveness(card, 'accepted');

    expect(card.effectiveness.acceptedCount).toBe(0);
    expect(updated.effectiveness.acceptedCount).toBe(1);
    expect(updateErrorExperienceEffectiveness(updated, 'dismissed').effectiveness.dismissedCount).toBe(1);
    expect(updateErrorExperienceEffectiveness(updated, 'prevented-failure').effectiveness.preventedFailureCount).toBe(1);
  });
});
