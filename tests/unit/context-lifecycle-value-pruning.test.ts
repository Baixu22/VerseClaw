// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildValuePruningCandidates,
  buildValuePruningShadowReport,
  materializeValuePruningShadow,
  proposeValuePruningDecisions,
  type ContextPruningProvider,
  type ValuePruningItem,
} from '../../openclaw_runtime/src/context-engine/exploration/value-pruning';
import { verifyContextArchiveHandle } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureItems(): ValuePruningItem[] {
  return [
    { id: 'old-copy', kind: 'trace', text: 'same observation', ageTurns: 2 },
    { id: 'new-copy', kind: 'trace', text: 'same observation', ageTurns: 1 },
    { id: 'superseded', kind: 'file', text: 'old file content', metadata: { supersededBy: 'file-v2' } },
    { id: 'resolved-error', kind: 'error', text: 'ENOENT after stale path', metadata: { status: 'resolved' } },
    { id: 'stale-observation', kind: 'trace', text: 'old low-value tool trace', ageTurns: 9, referenceCount: 0 },
    { id: 'secret-stale', kind: 'trace', text: 'sk-12345678901234567890 stale secret', ageTurns: 10, referenceCount: 0 },
    { id: 'active', kind: 'message', text: 'current objective must remain' },
  ];
}

describe('context lifecycle value pruning shadow', () => {
  it('generates deterministic candidates and blocks secret-bearing snippets', () => {
    const candidates = buildValuePruningCandidates(fixtureItems());
    expect(candidates.map((candidate) => candidate.item.id)).toEqual([
      'old-copy',
      'superseded',
      'resolved-error',
      'stale-observation',
      'secret-stale',
    ]);
    expect(candidates.find((candidate) => candidate.item.id === 'old-copy')?.reasons)
      .toContain('duplicate_digest');
    expect(candidates.find((candidate) => candidate.item.id === 'secret-stale')?.eligible)
      .toBe(false);
    expect(candidates.filter((candidate) => candidate.eligible).every((candidate) => candidate.secretScanHits === 0))
      .toBe(true);
  });

  it('uses a candidate-only provider seam and reports shadow would-drop metrics', async () => {
    const candidates = buildValuePruningCandidates(fixtureItems());
    const seen: string[] = [];
    const provider: ContextPruningProvider = {
      id: 'test-provider',
      async propose(input) {
        seen.push(input.candidateId);
        return {
          candidateId: input.candidateId,
          decision: input.reasons.includes('superseded') ? 'drop' : 'compress',
          confidence: 0.9,
          gist: `gist:${input.kind}`,
        };
      },
    };
    const decisions = await proposeValuePruningDecisions(provider, candidates);
    const report = buildValuePruningShadowReport({ items: fixtureItems(), decisions });
    expect(decisions.every((decision) => decision.confidence <= 1)).toBe(true);
    expect(seen).not.toContain('value-prune:secret-stale');
    expect(report).toMatchObject({
      inputItems: 7,
      secretBlockedCandidates: 1,
      providerCalls: decisions.length,
    });
    expect(report.wouldDropChars).toBeGreaterThan(0);
    expect(report.projectedCharsAfterGist).toBeGreaterThan(0);
  });

  it('materializes archive handles for shadow decisions without mutating input items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawx-value-pruning-'));
    dirs.push(dir);
    const items = fixtureItems();
    const candidates = buildValuePruningCandidates(items);
    const replacements = materializeValuePruningShadow({
      sessionId: 'session-1',
      candidates,
      archiveRoot: join(dir, 'archives'),
    });
    expect(replacements.length).toBeGreaterThan(0);
    const verified = await verifyContextArchiveHandle(replacements[0]!.archiveHandle);
    expect(verified.ok).toBe(true);
    expect(items[0]?.text).toBe('same observation');
    expect(replacements.every((replacement) => replacement.gist.length <= 240)).toBe(true);
  });

  it('writes shadow report evidence when requested', () => {
    const candidates = buildValuePruningCandidates(fixtureItems());
    const report = buildValuePruningShadowReport({ items: fixtureItems() });
    const evidence = {
      schema: 'clawx.tf0430.value-pruning-shadow/v1',
      driven_by: 'agent',
      actor: 'codex-tf0424',
      generatedAt: new Date().toISOString(),
      defaultPathChanged: false,
      candidateCount: candidates.length,
      secretBlocked: report.secretBlockedCandidates,
      eligibleSecretHits: candidates.filter((candidate) => candidate.eligible)
        .reduce((count, candidate) => count + candidate.secretScanHits, 0),
      wouldDropCount: report.wouldDropCount,
      wouldCompressCount: report.wouldCompressCount,
      wouldDropChars: report.wouldDropChars,
      projectedCharsAfterGist: report.projectedCharsAfterGist,
      providerConfigured: false,
      boundary: 'shadow-only report; input items are never mutated',
    };
    const output = process.env.CONTEXT_LIFECYCLE_VALUE_PRUNING_OUT;
    if (output) writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    expect(evidence.eligibleSecretHits).toBe(0);
  });
});
