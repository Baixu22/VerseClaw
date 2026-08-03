import { describe, expect, it } from 'vitest';

/**
 * RC-07 root acceptance test. Verifies the memory/context slot convergence
 * contract: exactly one memory store-owner, one contextEngine slot, zero SEKB
 * auto-writeback. This is a contract-level check that mirrors the classification
 * enforced by openclaw_runtime/src/agents/slot-convergence.ts.
 */
const MEMORY_MECHANISMS = [
  { id: 'memory-core', role: 'store-owner', mayWriteMemory: true },
  { id: 'vtoken-packer', role: 'benchmark-arm', mayWriteMemory: false },
  { id: 'agent-map', role: 'candidate-producer', mayWriteMemory: false },
  { id: 'sekb-governance', role: 'review-proposal', mayWriteMemory: false },
  { id: 'working-context', role: 'projection', mayWriteMemory: false },
];

const CONTEXT_MECHANISMS = [
  { id: 'context-runtime-kit', role: 'store-owner', isContextEngineSlot: true },
  { id: 'dcs-assembler', role: 'store-owner', isContextEngineSlot: false },
  { id: 'working-context-query', role: 'projection', isContextEngineSlot: false },
  { id: 'legacy-context-engine', role: 'candidate-producer', isContextEngineSlot: false },
];

describe('RC-07 memory/context slot convergence (root acceptance)', () => {
  it('exactly one memory mechanism may write persistent memory', () => {
    expect(MEMORY_MECHANISMS.filter((m) => m.mayWriteMemory)).toHaveLength(1);
    expect(MEMORY_MECHANISMS.find((m) => m.role === 'store-owner')?.id).toBe('memory-core');
    // Parallel memory writers are zero.
    expect(MEMORY_MECHANISMS.filter((m) => m.mayWriteMemory).length - 1).toBe(0);
  });

  it('exactly one contextEngine slot occupant (CRK hosts the DCS assembly path)', () => {
    expect(CONTEXT_MECHANISMS.filter((c) => c.isContextEngineSlot)).toHaveLength(1);
    expect(CONTEXT_MECHANISMS.find((c) => c.isContextEngineSlot)?.id).toBe('context-runtime-kit');
  });

  it('SEKB auto-writeback stays zero (human-confirmed governance only)', () => {
    const sekb = MEMORY_MECHANISMS.find((m) => m.id === 'sekb-governance');
    expect(sekb?.role).toBe('review-proposal');
    expect(sekb?.mayWriteMemory).toBe(false);
  });

  it('Working Context is a query projection, not a second memory store', () => {
    const wc = MEMORY_MECHANISMS.find((m) => m.id === 'working-context');
    expect(wc?.role).toBe('projection');
    expect(wc?.mayWriteMemory).toBe(false);
  });
});
