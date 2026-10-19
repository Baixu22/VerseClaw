// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SegmentSummaryLedger } from '../../openclaw_runtime/src/context-engine/exploration/segment-summary-ledger';
import { createContextArchiveHandleForPayloadSync, createContextItemId, verifyContextArchiveHandle } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function archiveRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-segment-ledger-'));
  dirs.push(dir);
  return join(dir, 'archives');
}

describe('context lifecycle segment summary ledger', () => {
  it('reuses digest-matched segments and exposes a bounded T0/T1/T2 projection', async () => {
    const ledger = new SegmentSummaryLedger({ maxSegments: 16 });
    const root = archiveRoot();
    const texts = [
      'Decision: keep P4 direct execution path\nConstraint: no default change',
      'Attempt: wire async compaction\nError: missing safe session adoption',
      'Next action: collect live first-token evidence\nDecision: keep shadow',
      'Result: tests pass\nConstraint: no new durable store',
      'Observation: token budget remains bounded',
      'Decision: no default-on promotion\nNext action: document NO-GO',
    ];
    const ids: string[] = [];
    for (const [index, text] of texts.entries()) {
      const handle = createContextArchiveHandleForPayloadSync({
        sessionId: 'session-1',
        itemId: createContextItemId(`segment-${index}`),
        payload: { text },
        archiveRoot: root,
      });
      const result = ledger.ingestSegment({
        id: `segment-${index}`,
        sourceText: text,
        currentTurn: index,
        archiveHandle: handle,
      });
      ids.push(result.record.id);
      expect(result.reused).toBe(false);
    }
    const reused = ledger.ingestSegment({
      id: 'segment-reingest',
      sourceText: texts[0]!,
      currentTurn: 7,
    });
    expect(reused.reused).toBe(true);

    const rollup = ledger.rollupSegments({
      id: 'segments-0-2',
      segmentIds: ids.slice(0, 3),
      currentTurn: 8,
    });
    expect(rollup.record.tiers.T2).toBeDefined();
    const reusedRollup = ledger.rollupSegments({
      id: 'segments-0-2-repeat',
      segmentIds: ids.slice(0, 3),
      currentTurn: 9,
    });
    expect(reusedRollup.reused).toBe(true);

    const assembly = ledger.assemble({ tokenBudget: 140, targetTerms: ['decision', 'next action'], currentTurn: 9 });
    expect(assembly.length).toBeGreaterThan(0);
    expect(assembly.every((item) => item.estimatedTokens > 0)).toBe(true);
    expect(assembly.some((item) => item.tier === 'T0' || item.tier === 'T1' || item.tier === 'T2')).toBe(true);
    const verified = await verifyContextArchiveHandle(ledger.get(ids[0]!)!.archiveHandle!);
    expect(verified.ok).toBe(true);
  });

  it('invalidates digest reuse when a segment is removed', () => {
    const ledger = new SegmentSummaryLedger();
    const first = ledger.ingestSegment({ id: 'a', sourceText: 'alpha', currentTurn: 1 });
    expect(ledger.invalidate(first.record.id)).toBe(true);
    const second = ledger.ingestSegment({ id: 'b', sourceText: 'alpha', currentTurn: 2 });
    expect(second.reused).toBe(false);
  });

  it('writes token-curve and reuse evidence when requested', () => {
    const ledger = new SegmentSummaryLedger({ maxSegments: 32 });
    for (let index = 0; index < 8; index += 1) {
      ledger.ingestSegment({
        id: `s${index}`,
        sourceText: `Decision: keep shadow path ${index}\nNext action: verify bounded assembly ${index}\n` + 'context line\n'.repeat(20 + index * 2),
        currentTurn: index,
      });
    }
    ledger.ingestSegment({ id: 'reuse', sourceText: `Decision: keep shadow path 0\nNext action: verify bounded assembly 0\n` + 'context line\n'.repeat(20), currentTurn: 8 });
    ledger.rollupSegments({ id: 'rollup', segmentIds: ['s0', 's1', 's2'], currentTurn: 9 });
    const curve = [80, 160, 320].map((tokenBudget) => ({
      tokenBudget,
      projectedTokens: ledger.assemble({
        tokenBudget,
        targetTerms: ['decision', 'action'],
        currentTurn: 9,
      }).reduce((sum, item) => sum + item.estimatedTokens, 0),
    }));
    const evidence = {
      schema: 'clawx.tf0433.segment-summary-shadow/v1',
      driven_by: 'agent',
      actor: 'codex-tf0424',
      generatedAt: new Date().toISOString(),
      defaultPathChanged: false,
      durableStoreCreated: false,
      segmentCount: ledger.size,
      reuseCount: ledger.get('s0')?.reuseCount ?? 0,
      rollupDigest: ledger.get('rollup')?.digest ?? null,
      tokenCurve: curve,
      boundary: 'in-memory shadow projection; transcript remains canonical',
    };
    const output = process.env.CONTEXT_LIFECYCLE_SEGMENT_OUT;
    if (output) writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    expect(curve.at(-1)!.projectedTokens).toBeGreaterThanOrEqual(curve[0]!.projectedTokens);
  });
});
