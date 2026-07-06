import { describe, expect, it } from 'vitest';
import {
  stableStringifyContextRuntimeKit,
  normalizeChunk,
  normalizeCompactView,
  normalizeCvkEvidenceRef,
  normalizePromptBundle,
  normalizeResourceId,
  normalizeRetrievalTraceEntry,
  normalizeSelector,
  normalizeVerificationResult,
} from '../../shared/types/context-runtime-kit';

const VALID_CHECKSUM = `sha256:${'a'.repeat(64)}`;

describe('Context Runtime Kit protocol contracts', () => {
  it('serializes and deserializes the Phase 1 protocol shape deterministically', () => {
    const resourceId = normalizeResourceId('toolset:local.shell@v1');
    const selector = normalizeSelector('schema:tool.shell.required');
    const chunk = normalizeChunk({
      resourceId,
      selector,
      checksum: VALID_CHECKSUM,
      text: 'The shell tool requires command.',
      tokenCount: 7,
      sourceRange: { startLine: 10, endLine: 12 },
      metadata: { source: 'fixture' },
    });
    const view = normalizeCompactView({
      resourceId,
      title: 'Shell tool',
      kind: 'toolset',
      summary: 'Navigation-only shell schema view.',
      hardSelectors: [selector],
      mustExpandBefore: [selector],
      sourceSelectors: [selector],
      tokenEstimate: 12,
    });
    const evidenceRef = normalizeCvkEvidenceRef({
      resourceId,
      selector,
      checksum: VALID_CHECKSUM,
      kind: 'toolset',
      hardClaim: true,
      label: 'shell required fields',
    });
    const trace = normalizeRetrievalTraceEntry({
      resourceId,
      selector,
      checksum: VALID_CHECKSUM,
      chunkId: 'chunk-001',
      tokenCount: 7,
      reason: 'hard_claim',
    });
    const bundle = normalizePromptBundle({
      schemaVersion: 1,
      instructionKernel: 'Use selectors for hard claims.',
      resourceMap: [{
        resourceId,
        kind: 'toolset',
        title: 'Shell tool',
        selectors: [selector],
      }],
      compactViews: [view],
      compactRecoveryProjection: 'Next action: expand shell schema.',
      selectedChunks: [chunk],
      currentTask: 'Validate protocol contracts.',
      tokenBudget: { input: 1000, outputReserve: 250 },
      retrievalPlan: [evidenceRef],
      retrievalTrace: [trace],
      createdAt: '2026-07-06T00:00:00.000Z',
    });
    const verification = normalizeVerificationResult({
      ok: true,
      gate: 'hard_claim',
      checkedAt: '2026-07-06T00:00:01.000Z',
      diagnostics: [{
        code: 'evidence_ref_valid',
        message: 'Hard claim has a selector and checksum.',
        resourceId,
        selector,
        checksum: VALID_CHECKSUM,
      }],
    });

    const serialized = stableStringifyContextRuntimeKit({ bundle, verification });

    expect(JSON.parse(serialized)).toEqual({ bundle, verification });
    expect(serialized).toBe(stableStringifyContextRuntimeKit(JSON.parse(serialized)));
    expect(bundle.compactViews[0]?.navigationOnly).toBe(true);
  });

  it('rejects invalid resource ids, selectors, checksums, and chunk ranges with explicit diagnostics', () => {
    expect(() => normalizeResourceId('Skill:Bad Name')).toThrow(/Invalid resource id/);
    expect(() => normalizeSelector('schema:tool.shell required')).toThrow(/Invalid selector/);
    expect(() => normalizeChunk({
      resourceId: 'toolset:local.shell@v1',
      selector: 'schema:tool.shell.required',
      checksum: 'sha256:abc',
      text: 'invalid checksum',
    })).toThrow(/Invalid checksum/);
    expect(() => normalizeChunk({
      resourceId: 'toolset:local.shell@v1',
      selector: 'schema:tool.shell.required',
      checksum: VALID_CHECKSUM,
      text: 'invalid range',
      sourceRange: { startLine: 9, endLine: 3 },
    })).toThrow(/Invalid chunk range/);
  });

  it('requires checksum-backed evidence refs for hard claims', () => {
    expect(() => normalizeCvkEvidenceRef({
      resourceId: 'project_rule:agents@v1',
      selector: 'rule:context-runtime-boundary',
      hardClaim: true,
    })).toThrow(/Hard claim evidence refs require checksum/);

    expect(normalizeCvkEvidenceRef({
      resourceId: 'project_rule:agents@v1',
      selector: 'rule:context-runtime-boundary',
      checksum: VALID_CHECKSUM,
      hardClaim: true,
    })).toMatchObject({
      resourceId: 'project_rule:agents@v1',
      selector: 'rule:context-runtime-boundary',
      checksum: VALID_CHECKSUM,
      hardClaim: true,
    });
  });

  it('normalizes selector-bearing views and traces into deterministic order', () => {
    const view = normalizeCompactView({
      resourceId: 'skill:context-runtime-kit@v1',
      kind: 'skill',
      title: 'CRK skill',
      summary: 'Navigation only.',
      hardSelectors: ['skill:workflow', 'skill:overview', 'skill:workflow'],
      mustExpandBefore: ['skill:workflow', 'skill:overview'],
      sourceSelectors: ['skill:source.full', 'skill:overview'],
      tokenEstimate: 25,
    });
    const trace = normalizeRetrievalTraceEntry({
      resourceId: 'skill:context-runtime-kit@v1',
      selector: 'skill:workflow',
      reason: 'tool_call_gate',
      tokenCount: 40,
    });

    expect(view.navigationOnly).toBe(true);
    expect(view.hardSelectors).toEqual(['skill:overview', 'skill:workflow']);
    expect(view.mustExpandBefore).toEqual(['skill:overview', 'skill:workflow']);
    expect(view.sourceSelectors).toEqual(['skill:overview', 'skill:source.full']);
    expect(trace).toMatchObject({
      resourceId: 'skill:context-runtime-kit@v1',
      selector: 'skill:workflow',
      reason: 'tool_call_gate',
      tokenCount: 40,
    });
  });
});
