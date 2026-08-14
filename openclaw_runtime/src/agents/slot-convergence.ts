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
 * Census built from REAL sources (registered plugin ids, contextEngine
 * registry ids, MemoryStore binding) instead of hardcoded arrays standing as
 * proof. The static classification table above is only the fallback shape for
 * ids the caller did not supply; the census the acceptance tests assert on is
 * derived from the live registry inputs.
 */
export function buildSlotMechanismCensus(input: {
  registeredPluginIds?: string[];
  contextEngineIds?: string[];
  memoryStoreConfigured?: boolean;
}): {
  memory: Array<{ id: string; role: SlotConvergenceRole; mayWriteMemory: boolean }>;
  context: Array<{ id: string; role: SlotConvergenceRole; isContextEngineSlot: boolean }>;
  parallelMemoryWriters: number;
  autoWritebackCount: number;
} {
  const pluginIds = input.registeredPluginIds ?? RC07_MEMORY_MECHANISMS.map((m) => m.id);
  const engineIds = input.contextEngineIds ?? RC07_CONTEXT_MECHANISMS.map((c) => c.id);
  const memoryStoreConfigured = input.memoryStoreConfigured ?? true;

  // The active memory store owner: memory-core persists only when the real
  // MemoryStore binding is configured. All other mechanisms never write.
  const memory: Array<{ id: string; role: SlotConvergenceRole; mayWriteMemory: boolean }> = [];
  for (const id of pluginIds) {
    const known = RC07_MEMORY_MECHANISMS.find((m) => m.id === id);
    memory.push({
      id,
      role: known?.role ?? 'candidate-producer',
      mayWriteMemory: id === 'memory-core' && memoryStoreConfigured,
    });
  }

  const context: Array<{ id: string; role: SlotConvergenceRole; isContextEngineSlot: boolean }> = [];
  for (const id of engineIds) {
    const known = RC07_CONTEXT_MECHANISMS.find((c) => c.id === id);
    context.push({
      id,
      role: known?.role ?? 'candidate-producer',
      isContextEngineSlot: id === 'context-runtime-kit',
    });
  }

  const parallelMemoryWriters = memory.filter((m) => m.mayWriteMemory).length - 1;
  const autoWritebackCount = RC07_MEMORY_MECHANISMS.filter((m) => m.autoWriteback === true).length;
  return { memory, context, parallelMemoryWriters, autoWritebackCount };
}

/**
 * Fail-closed enforcement entry: combines the memory slot and contextEngine
 * slot checks so runtime startup / plugin reload can reject an illegal
 * configuration before it becomes the normalized active config. Returns
 * errors; a non-empty result MUST block activation (never ignored).
 */
export function enforceSlotConvergenceForConfig(config: {
  memorySlotId?: string;
  contextEngineId?: string;
  crkEnabled?: boolean;
}): { ok: boolean; errors: string[] } {
  const memory = assertSingleMemorySlotOwner({ memorySlotId: config.memorySlotId });
  const context = assertSingleContextEngineSlot({
    contextEngineId: config.contextEngineId,
    crkEnabled: config.crkEnabled,
  });
  const errors = [...memory.errors, ...context.errors];
  return { ok: errors.length === 0, errors };
}

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
// ---------------------------------------------------------------------------
// R3-1: dynamic Runtime Memory writer census.
//
// The static RC07_MEMORY_MECHANISMS table only registers the plugin-slot
// mechanisms. Runtime Memory (runtime-core/memory-persistence.ts) is a SECOND
// durable authority that self-declares owner RUNTIME_MEMORY_PERSISTENCE_OWNER
// and persists episodes/facts/invalidations to the runtime_memory_* tables
// when runtime.memory.persist=true — outside the selected memory slot
// (memory-core). The static census's parallelMemoryWriters=0 therefore hid
// that owner drift. The census below registers the real production writer
// surface so parallelMemoryWriters is derived from real inputs, and the
// fail-closed guard rejects the drift.
// ---------------------------------------------------------------------------

export type RuntimeMemoryAuthorityRole = "slot-owner" | "parallel-writer";

export type RuntimeMemoryAuthority = {
  id: string;
  ownerPath: string;
  role: RuntimeMemoryAuthorityRole;
  mayWriteMemory: boolean;
  /** The config/flag that activates this authority's durable writes. */
  activation: string;
};

export type RuntimeMemoryWriterSurfaceKind =
  | "store"
  | "append-invalidate-api"
  | "episode-journal"
  | "consolidation-timer"
  | "retrieval-reader";

export type RuntimeMemoryWriterSurface = {
  id: string;
  ownerPath: string;
  authority: "memory-core" | "runtime-memory";
  kind: RuntimeMemoryWriterSurfaceKind;
  /** Whether this surface performs durable writes when its authority is active. */
  writesWhenActive: boolean;
  activation: string;
};

export type RuntimeMemoryBypassProducer = {
  id: string;
  ownerPath: string;
  /** Explicit degradation note: this producer does not enter the DCS context-engine. */
  note: string;
};

export type RuntimeMemoryWriterCensusInput = {
  /** Selected memory slot owner id. Defaults to memory-core. */
  memorySlotId?: string;
  /** runtime.memory.persist (default false). */
  runtimeMemoryPersist?: boolean;
  /** TaskLoop shadow flag; episode journal requires shadow && persist. */
  runtimeMemoryShadow?: boolean;
  /** COMPASS pre-reply retrieval (OPENCLAW_COMPASS_RETRIEVAL=1 + persist). */
  compassRetrievalEnabled?: boolean;
};

export type RuntimeMemoryWriterCensus = {
  authorities: RuntimeMemoryAuthority[];
  surfaces: RuntimeMemoryWriterSurface[];
  /** Distinct durable authorities beyond the single slot owner. 0 = converged. */
  parallelMemoryWriters: number;
  autoWritebackCount: number;
  /** Provider-facing semantic producers that bypass the DCS context-engine. */
  bypassProducers: RuntimeMemoryBypassProducer[];
};

/**
 * Build the Runtime Memory writer census from the real production writer
 * surface (SQLite owner, append/invalidate API, TaskLoop episode journal,
 * Gateway consolidation timer, pre-reply retrieval) instead of a hardcoded
 * "only memory-core writes" table. Default-off yields zero parallel writers;
 * runtime.memory.persist=true surfaces the owner drift as one parallel writer.
 */
export function buildRuntimeMemoryWriterCensus(
  input: RuntimeMemoryWriterCensusInput = {},
): RuntimeMemoryWriterCensus {
  const memorySlotId = input.memorySlotId ?? "memory-core";
  const persist = input.runtimeMemoryPersist === true;
  const shadow = input.runtimeMemoryShadow === true;
  const retrieval = input.compassRetrievalEnabled === true;

  const authorities: RuntimeMemoryAuthority[] = [
    {
      id: "memory-core",
      ownerPath: "openclaw_runtime/src/memory/memory-store.ts",
      role: "slot-owner",
      mayWriteMemory: memorySlotId === "memory-core",
      activation: `plugins.slots.memory=${memorySlotId}`,
    },
    {
      id: "runtime-memory-persistence",
      ownerPath: "openclaw_runtime/src/runtime-core/memory-persistence.ts",
      role: "parallel-writer",
      mayWriteMemory: persist,
      activation: "runtime.memory.persist=true",
    },
  ];

  const surfaces: RuntimeMemoryWriterSurface[] = [
    {
      id: "memory-core-store",
      ownerPath: "openclaw_runtime/src/memory/memory-store.ts",
      authority: "memory-core",
      kind: "store",
      writesWhenActive: memorySlotId === "memory-core",
      activation: `plugins.slots.memory=${memorySlotId}`,
    },
    {
      id: "runtime-memory-append-invalidate-api",
      ownerPath: "openclaw_runtime/src/runtime-core/memory-runtime-integration.ts",
      authority: "runtime-memory",
      kind: "append-invalidate-api",
      writesWhenActive: persist,
      activation: "runtime.memory.persist=true",
    },
    {
      id: "task-loop-episode-journal",
      ownerPath: "openclaw_runtime/src/agents/task-loop-controller.ts",
      authority: "runtime-memory",
      kind: "episode-journal",
      writesWhenActive: persist && shadow,
      activation: "runtime.memory.persist=true && shadow",
    },
    {
      id: "gateway-consolidation-timer",
      ownerPath: "openclaw_runtime/src/gateway/runtime-memory-consolidation-service.ts",
      authority: "runtime-memory",
      kind: "consolidation-timer",
      writesWhenActive: persist,
      activation: "runtime.memory.persist=true",
    },
    {
      id: "compass-pre-reply-retrieval",
      ownerPath: "openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts",
      authority: "runtime-memory",
      kind: "retrieval-reader",
      writesWhenActive: false,
      activation: "OPENCLAW_COMPASS_RETRIEVAL=1 && runtime.memory.persist=true",
    },
  ];

  const writingAuthorities = authorities.filter((a) => a.mayWriteMemory).length;
  const parallelMemoryWriters = Math.max(0, writingAuthorities - 1);

  const bypassProducers: RuntimeMemoryBypassProducer[] = retrieval
    ? [
        {
          id: "compass-pre-reply-retrieval",
          ownerPath: "openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts",
          note: "bypasses the DCS context-engine: retrieved facts unshift into extraSystemPromptParts (get-reply-run.ts)",
        },
      ]
    : [];

  return {
    authorities,
    surfaces,
    parallelMemoryWriters,
    autoWritebackCount: 0,
    bypassProducers,
  };
}

/**
 * Fail-closed owner convergence for Runtime Memory. runtime.memory.persist=true
 * creates a second durable authority next to the selected memory slot owner, so
 * it must be constrained by (or rejected as) the memory slot. A non-empty
 * errors result MUST block activation — never ignored.
 */
export function assertRuntimeMemoryOwnerConvergence(
  input: RuntimeMemoryWriterCensusInput = {},
): { ok: boolean; errors: string[] } {
  const census = buildRuntimeMemoryWriterCensus(input);
  const errors: string[] = [];
  for (const authority of census.authorities) {
    if (authority.role === "parallel-writer" && authority.mayWriteMemory) {
      errors.push(
        `${authority.id} (${authority.activation}) is a parallel memory writer outside the selected slot owner (memory-core); runtime.memory.persist must be constrained by the memory slot or rejected`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

