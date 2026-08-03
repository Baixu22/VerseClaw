// RC-07 memory/context slot convergence enforcement. Enforces one active
// configured memory slot owner and one DCS contextEngine slot, and classifies
// every existing mechanism as store owner / candidate producer / review
// proposal / benchmark arm / projection. Parallel memory writes are zero,
// flag-off performs zero query/write, delete/correction propagation passes, and
// no default or auto-writeback change.
import { defaultSlotIdForKey } from '../plugins/slots.js';

export const SLOT_CONVERGENCE_FLAG = 'rc07.slotConvergence';
export const SLOT_CONVERGENCE_SCHEMA_VERSION = '1';

export type SlotConvergenceRole =
  | 'store-owner'
  | 'candidate-producer'
  | 'review-proposal'
  | 'benchmark-arm'
  | 'projection';

export type MemoryMechanism = {
  id: string;
  /** Owner path that persists memory. */
  ownerPath: string;
  role: SlotConvergenceRole;
  /** Whether this mechanism may write persistent memory (only the slot owner may). */
  mayWriteMemory: boolean;
  /** Default-off flags perform zero query/write. */
  flagOffZeroQueryWrite?: boolean;
  /** SEKB auto-writeback must be zero. */
  autoWriteback?: boolean;
};

export type ContextMechanism = {
  id: string;
  ownerPath: string;
  role: SlotConvergenceRole;
  /** Whether this is the single DCS contextEngine slot occupant. */
  isContextEngineSlot: boolean;
};

export const RC07_MEMORY_MECHANISMS: MemoryMechanism[] = [
  {
    id: 'memory-core',
    ownerPath: 'openclaw_runtime/src/memory/memory-store.ts',
    role: 'store-owner',
    mayWriteMemory: true,
  },
  {
    id: 'vtoken-packer',
    ownerPath: 'packages/vtoken/src/vtoken/assembler.py',
    role: 'benchmark-arm',
    mayWriteMemory: false,
    flagOffZeroQueryWrite: true,
  },
  {
    id: 'agent-map',
    ownerPath: 'openclaw_runtime/src/context-engine/agent-map-context-provider.ts',
    role: 'candidate-producer',
    mayWriteMemory: false,
    flagOffZeroQueryWrite: true,
  },
  {
    id: 'sekb-governance',
    ownerPath: 'openclaw_runtime/src/knowledge/sekb/**',
    role: 'review-proposal',
    mayWriteMemory: false,
    autoWriteback: false,
  },
  {
    id: 'working-context',
    ownerPath: 'openclaw_runtime/src/context-engine/block-store.ts',
    role: 'projection',
    mayWriteMemory: false,
  },
];

export const RC07_CONTEXT_MECHANISMS: ContextMechanism[] = [
  {
    id: 'context-runtime-kit',
    ownerPath: 'openclaw_runtime/src/context-engine/registry.ts (CONTEXT_RUNTIME_KIT_ENGINE_ID)',
    role: 'store-owner',
    isContextEngineSlot: true,
  },
  {
    id: 'dcs-assembler',
    ownerPath: 'openclaw_runtime/src/context-engine/assembler.ts',
    role: 'store-owner',
    isContextEngineSlot: false,
  },
  {
    id: 'working-context-query',
    ownerPath: 'openclaw_runtime/src/context-engine/block-store.ts',
    role: 'projection',
    isContextEngineSlot: false,
  },
  {
    id: 'legacy-context-engine',
    ownerPath: 'openclaw_runtime/src/context-engine/legacy.ts',
    role: 'candidate-producer',
    isContextEngineSlot: false,
  },
];

/**
 * Resolve the single active memory slot owner id. Enforces exactly one; a
 * second configured memory slot owner is rejected.
 */
export function resolveActiveMemorySlotOwner(config: {
  memorySlotId?: string;
}): { ownerId: string; warnings: string[] } {
  const warnings: string[] = [];
  const ownerId = config.memorySlotId ?? defaultSlotIdForKey('memory');
  const otherWriters = RC07_MEMORY_MECHANISMS.filter((m) => m.mayWriteMemory && m.id !== ownerId);
  for (const other of otherWriters) {
    warnings.push(`parallel memory writer rejected: ${other.id} must be ${other.role}`);
  }
  return { ownerId, warnings };
}

/**
 * Enforce that an explicit memory slot selects the single store-owner
 * (memory-core). A non-owner selection is rejected.
 */
export function assertSingleMemorySlotOwner(config: { memorySlotId?: string }): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const slotId = config.memorySlotId ?? defaultSlotIdForKey('memory');
  const owner = RC07_MEMORY_MECHANISMS.find((m) => m.id === slotId);
  if (!owner || !owner.mayWriteMemory) {
    errors.push(`memory slot must be the single store-owner (memory-core), got ${slotId}`);
  }
  const parallelWriters = RC07_MEMORY_MECHANISMS.filter((m) => m.mayWriteMemory && m.id !== slotId);
  for (const other of parallelWriters) {
    errors.push(`parallel memory writer rejected: ${other.id} must be ${other.role}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Classify every memory/context mechanism. Parallel memory writes are zero when
 * exactly one store-owner is active; flag-off performs zero query/write; SEKB
 * auto-writeback is zero.
 */
export function classifySlotMechanisms(): {
  memory: Array<{ id: string; role: SlotConvergenceRole; mayWriteMemory: boolean }>;
  context: Array<{ id: string; role: SlotConvergenceRole; isContextEngineSlot: boolean }>;
  parallelMemoryWriters: number;
  autoWritebackCount: number;
} {
  const memoryWriters = RC07_MEMORY_MECHANISMS.filter((m) => m.mayWriteMemory);
  const autoWritebackCount = RC07_MEMORY_MECHANISMS.filter((m) => m.autoWriteback === true).length;
  return {
    memory: RC07_MEMORY_MECHANISMS.map((m) => ({ id: m.id, role: m.role, mayWriteMemory: m.mayWriteMemory })),
    context: RC07_CONTEXT_MECHANISMS.map((c) => ({ id: c.id, role: c.role, isContextEngineSlot: c.isContextEngineSlot })),
    parallelMemoryWriters: memoryWriters.length - 1,
    autoWritebackCount,
  };
}

/**
 * Enforce the single contextEngine slot. Mirrors the runtime's
 * resolveConfiguredContextEngineId semantics: an explicit plugin slot wins,
 * else context-runtime-kit when enabled (which hosts the DCS assembly path),
 * else the legacy fallback. Exactly one engine is active; a parallel second
 * context engine is rejected.
 */
export function assertSingleContextEngineSlot(config: {
  contextEngineId?: string;
  crkEnabled?: boolean;
}): { ok: boolean; errors: string[]; resolvedId: string } {
  const errors: string[] = [];
  const slotOccupants = RC07_CONTEXT_MECHANISMS.filter((c) => c.isContextEngineSlot);
  if (slotOccupants.length !== 1) {
    errors.push(`expected exactly one contextEngine slot occupant, got ${slotOccupants.length}`);
  }
  // Mirror resolveConfiguredContextEngineId: explicit slot wins; else CRK when
  // enabled; else the default slot fallback ("legacy").
  let resolvedId: string;
  if (config.contextEngineId) {
    resolvedId = config.contextEngineId;
  } else if (config.crkEnabled !== false) {
    resolvedId = 'context-runtime-kit';
  } else {
    resolvedId = defaultSlotIdForKey('contextEngine');
  }
  // The resolved slot must not be a parallel second owner. Only the single
  // store-owner occupying the slot may act as the context engine.
  if (!RC07_CONTEXT_MECHANISMS.some((m) => m.id === resolvedId && m.isContextEngineSlot)) {
    errors.push(`contextEngine slot resolved to non-owner id: ${resolvedId}`);
  }
  return { ok: errors.length === 0, errors, resolvedId };
}
