// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Metadata and configuration reads must stay usable without executable engines
// or the broad runtime barrel; these sentinels fail on the old reverse imports.
vi.mock('../../openclaw_runtime/src/context-engine/cvk/engine', () => {
  throw new Error('metadata must not load the CVK engine');
});
vi.mock('../../openclaw_runtime/src/runtime-core/index', () => {
  throw new Error('configuration must not load the runtime-core barrel');
});

describe('runtime dependency leaves', () => {
  it('registers and resolves an engine without loading the CVK implementation', async () => {
    const registry = await import('../../openclaw_runtime/src/context-engine/registry');
    const factory = vi.fn(async () => ({
      info: { id: 'dependency-leaf-test', name: 'Dependency leaf test' },
      ingest: async () => ({ ingested: false }),
      assemble: async () => ({ messages: [], estimatedTokens: 0 }),
      compact: async () => ({ ok: true, compacted: false }),
    }));
    const owner = 'architecture-runtime-cycles';
    try {
      expect(registry.registerContextEngineForOwner('dependency-leaf-test', factory, owner)).toEqual({ ok: true });
      expect(factory).not.toHaveBeenCalled();
      const engine = await registry.resolveContextEngine({
        plugins: { slots: { contextEngine: 'dependency-leaf-test' } },
      });
      expect(engine.info.id).toBe('dependency-leaf-test');
      expect(factory).toHaveBeenCalledOnce();
    } finally {
      registry.clearContextEnginesForOwner(owner);
    }
  });

  it('evaluates the kill switch without loading the runtime barrel', async () => {
    const { isContextEnhancementKillSwitchEngaged } = await import('../../openclaw_runtime/src/context-engine/enhancement-kill-switch');
    expect(isContextEnhancementKillSwitchEngaged({}, {})).toBe(false);
    expect(isContextEnhancementKillSwitchEngaged({ runtime: { contextEnhancement: { killSwitch: true } } }, {})).toBe(true);
    expect(isContextEnhancementKillSwitchEngaged({ get runtime() { throw new Error('unreadable config'); } }, {})).toBe(true);
  });

  it('resolves the retired VToken gate without loading the runtime barrel', async () => {
    const { resolveVtokenAssemblyConfig } = await import('../../openclaw_runtime/src/context-engine/chat-turn-vtoken-injection');
    expect(resolveVtokenAssemblyConfig({ runtime: { vtoken: { assembly: { enabled: true } } } }).enabled).toBe(false);
  });
});
