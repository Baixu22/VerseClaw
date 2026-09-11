import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Area 5 §3.2 — Semantic Steward pass tests. The semantic pass is opt-in
// (classification: 'semantic'), default-off, and degrades gracefully to the
// heuristic result when the LLM invoker is missing or fails.

vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
}));

const root = join(tmpdir(), `clawx-kb-semantic-test-${Date.now()}`);

vi.mock('@electron/utils/paths', () => ({
  expandPath: (path: string) => path,
  getOpenClawConfigDir: () => root,
}));

function writeRegistryFile(content: unknown) {
  const filePath = join(root, 'knowledge', 'steward-roles.json');
  mkdirSync(join(root, 'knowledge'), { recursive: true });
  writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

function writeSemanticRegistry() {
  writeRegistryFile({
    version: 1,
    defaultRoleId: 'knowledge-steward',
    roles: [{
      enabled: true,
      roleId: 'knowledge-steward',
      capabilities: {
        canSearch: true,
        canRead: true,
        canProposeDraft: true,
        canClassify: true,
        canSuggestMerge: true,
        canSuggestArchive: true,
        canApplyDirectly: false,
      },
      scope: { workspace: true, agent: true, global: true },
      displayName: 'Semantic Steward',
      classification: 'semantic',
      reviewFocus: ['classification', 'conflicts'],
    }],
  });
}

function writeHeuristicRegistry() {
  writeRegistryFile({
    version: 1,
    defaultRoleId: 'knowledge-steward',
    roles: [{
      enabled: true,
      roleId: 'knowledge-steward',
      capabilities: {
        canSearch: true,
        canRead: true,
        canProposeDraft: true,
        canClassify: true,
        canSuggestMerge: true,
        canSuggestArchive: true,
        canApplyDirectly: false,
      },
      scope: { workspace: true, agent: true, global: true },
      displayName: 'Heuristic Steward',
      classification: 'heuristic',
      reviewFocus: ['classification'],
    }],
  });
}

let knowledgeApi: Awaited<ReturnType<typeof importApi>>;

async function importApi() {
  return import('@electron/services/knowledge-api');
}

async function getApi() {
  const mod = await importApi();
  mod.__resetRoleRegistryCacheForTests();
  knowledgeApi = mod;
  return mod.createKnowledgeApi({ gatewayManager: null as never });
}

/**
 * Installs the semantic-pass invoker seam.
 *
 * This MUST run after `getApi()`: `createKnowledgeApi` rebinds the seam to the
 * production invoker on every construction, so anything installed beforehand is
 * silently replaced and the test observes the production invoker's "returned
 * null" degradation instead of the intended behaviour.
 */
function useInvoker(invoker: Parameters<typeof knowledgeApi.setSemanticStewardInvoker>[0]) {
  knowledgeApi.setSemanticStewardInvoker(invoker);
}

describe('Area 5 §3.2 — Semantic Steward pass', () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    // Clean up the module-level invoker between tests so files don't
    // cross-contaminate. Awaited (not fire-and-forget) so the reset cannot
    // land in the middle of the next test.
    if (knowledgeApi) knowledgeApi.setSemanticStewardInvoker(null);
  });

  describe('mergeSemanticReview (pure merge logic)', () => {
    it('overrides heuristic type when semantic confidence >= 0.7', async () => {
      const { mergeSemanticReview } = await import('@electron/services/knowledge-api');
      const result = mergeSemanticReview(
        { type: 'synthesis', tags: ['governance'], warnings: ['Missing sources.'], notes: 'Heuristic only.' },
        { type: 'decision', tags: ['governance', 'migration'], warnings: [{ kind: 'conflict', message: 'Contradicts page X.' }], confidence: 0.86 },
      );
      expect(result.type).toBe('decision');
      expect(result.tags).toEqual(expect.arrayContaining(['governance', 'migration']));
      expect(result.warnings).toContain('Missing sources.');
      expect(result.warnings).toContain('[conflict] Contradicts page X.');
      expect(result.notes).toContain('confidence=0.86');
      expect(result.notes).toContain('type=decision');
    });

    it('keeps heuristic type when semantic confidence < 0.7', async () => {
      const { mergeSemanticReview } = await import('@electron/services/knowledge-api');
      const result = mergeSemanticReview(
        { type: 'synthesis', tags: [], warnings: [], notes: 'Heuristic only.' },
        { type: 'decision', tags: ['migration'], warnings: [], confidence: 0.5 },
      );
      expect(result.type).toBe('synthesis');
      expect(result.tags).toEqual(['migration']);
    });

    it('formats semantic warnings with kind prefix and relatedPageId', async () => {
      const { mergeSemanticReview } = await import('@electron/services/knowledge-api');
      const result = mergeSemanticReview(
        { type: 'synthesis', tags: [], warnings: [], notes: 'Base.' },
        {
          type: 'synthesis',
          tags: [],
          warnings: [
            { kind: 'duplicate', message: 'Similar to existing page.', relatedPageId: 'p_123' },
            { kind: 'stale', message: 'Claim may be outdated.' },
          ],
          confidence: 0.9,
        },
      );
      expect(result.warnings).toContain('[duplicate] Similar to existing page. (→ p_123)');
      expect(result.warnings).toContain('[stale] Claim may be outdated.');
    });

    it('deduplicates tags from both passes', async () => {
      const { mergeSemanticReview } = await import('@electron/services/knowledge-api');
      const result = mergeSemanticReview(
        { type: 'synthesis', tags: ['governance', 'migration'], warnings: [], notes: 'Base.' },
        { type: 'synthesis', tags: ['governance', 'architecture'], warnings: [], confidence: 0.9 },
      );
      expect(result.tags).toEqual(['governance', 'migration', 'architecture']);
    });
  });

  describe('stewardReview handler — semantic pass integration', () => {
    it('runs heuristic only when classification is heuristic (default-off)', async () => {
      writeHeuristicRegistry();
      const api = await getApi();
      const result = await api.stewardReview({ title: 'Migration plan', body: 'We will migrate the database schema in Q3.', sourceIds: ['notes/migration.md'], tags: ['migration'] });
      expect(result.success).toBe(true);
      expect((result.config as any).classification).toBe('heuristic');
      // No semantic pass info in notes
      expect(result.notes).not.toContain('Semantic steward pass');
    });

    it('appends "semantic pass unavailable" when classification is semantic but no invoker is set', async () => {
      writeSemanticRegistry();
      const api = await getApi();
      useInvoker(null);
      const result = await api.stewardReview({ title: 'Migration plan', body: 'We will migrate the database schema in Q3.', sourceIds: ['notes/migration.md'], tags: ['migration'] });
      expect(result.success).toBe(true);
      expect((result.config as any).classification).toBe('semantic');
      expect(result.notes).toContain('Semantic steward pass unavailable');
      expect(result.notes).toContain('no LLM invoker configured');
    });

    it('merges semantic result when invoker returns a valid review', async () => {
      writeSemanticRegistry();
      const api = await getApi();
      useInvoker(async () => ({
        type: 'decision',
        tags: ['migration', 'database'],
        warnings: [{ kind: 'conflict', message: 'Contradicts migration rollback plan.', relatedPageId: 'p_456' }],
        confidence: 0.88,
      }));
      const result = await api.stewardReview({ title: 'Migration plan', body: 'We will migrate the database schema in Q3 with no rollback.', sourceIds: ['notes/migration.md'], tags: ['migration'] });
      expect(result.success).toBe(true);
      expect(result.type).toBe('decision'); // overridden by high-confidence semantic
      expect(result.tags).toEqual(expect.arrayContaining(['migration', 'database']));
      expect(result.warnings.some((w) => w.includes('[conflict] Contradicts migration rollback plan.'))).toBe(true);
      expect(result.notes).toContain('confidence=0.88');
    });

    it('keeps heuristic type when semantic confidence is below threshold', async () => {
      writeSemanticRegistry();
      const api = await getApi();
      useInvoker(async () => ({
        type: 'decision',
        tags: [],
        warnings: [],
        confidence: 0.4,
      }));
      const result = await api.stewardReview({ title: 'Glossary entry', body: 'A term definition for reference purposes, covering key concepts and their meanings in the project context.', sourceIds: ['notes/glossary.md'], tags: [] });
      expect(result.success).toBe(true);
      // Semantic says 'decision' but confidence 0.4 < 0.7 threshold → keep heuristic type.
      // The heuristic type must NOT be 'decision' (the semantic suggestion).
      expect(result.type).not.toBe('decision');
      expect(result.notes).toContain('confidence=0.40');
    });

    it('appends "semantic pass unavailable" when invoker returns null', async () => {
      writeSemanticRegistry();
      const api = await getApi();
      useInvoker(async () => null);
      const result = await api.stewardReview({ title: 'Migration plan', body: 'We will migrate the database schema in Q3.', sourceIds: [], tags: [] });
      expect(result.success).toBe(true);
      expect(result.notes).toContain('Semantic steward pass unavailable');
      expect(result.notes).toContain('invoker returned null');
    });

    it('appends "semantic pass unavailable" with error message when invoker throws', async () => {
      writeSemanticRegistry();
      const api = await getApi();
      useInvoker(async () => { throw new Error('LLM timeout'); });
      const result = await api.stewardReview({ title: 'Migration plan', body: 'We will migrate the database schema in Q3.', sourceIds: [], tags: [] });
      expect(result.success).toBe(true);
      expect(result.notes).toContain('Semantic steward pass unavailable');
      expect(result.notes).toContain('LLM timeout');
    });
  });
});
