import { describe, expect, it, beforeEach } from 'vitest';
import type { AgentMessage } from '../../openclaw_runtime/src/agents/runtime';
import { OpenClawSchema } from '../../openclaw_runtime/src/config/zod-schema';
import { registerContextRuntimeKitContextEngine } from '../../openclaw_runtime/src/context-engine/cvk/registration';
import {
  clearContextEngineRuntimeQuarantine,
  clearContextEnginesForOwner,
  listContextEngineQuarantines,
  registerContextEngineForOwner,
  resolveContextEngine,
} from '../../openclaw_runtime/src/context-engine/registry';
import type { ContextEngine } from '../../openclaw_runtime/src/context-engine/types';

function legacyTestEngine(): ContextEngine {
  return {
    info: { id: 'legacy', name: 'Legacy Test Engine' },
    async ingest() {
      return { ingested: false };
    },
    async assemble(params) {
      return {
        messages: params.messages,
        estimatedTokens: 0,
      };
    },
    async compact() {
      return {
        ok: true,
        compacted: false,
        reason: 'legacy fallback',
      };
    },
  };
}

function registerTestBuiltins(): void {
  clearContextEngineRuntimeQuarantine();
  clearContextEnginesForOwner('core');
  registerContextEngineForOwner('legacy', async () => legacyTestEngine(), 'core', {
    allowSameOwnerRefresh: true,
  });
  registerContextRuntimeKitContextEngine();
}

describe('Context engine registry default-on CRK resolution', () => {
  beforeEach(() => {
    registerTestBuiltins();
  });

  it('defaults to context-runtime-kit when the slot is absent and CRK is enabled by default', async () => {
    const engine = await resolveContextEngine({});

    expect(engine.info.id).toBe('context-runtime-kit');
  });

  it('keeps explicit legacy slot authoritative', async () => {
    const engine = await resolveContextEngine({
      plugins: {
        slots: {
          contextEngine: 'legacy',
        },
      },
    });

    expect(engine.info.id).toBe('legacy');
  });

  it('uses legacy when runtime.contextRuntimeKit.enabled is false and accepts the rollback schema', async () => {
    const parsed = OpenClawSchema.parse({
      runtime: {
        contextRuntimeKit: {
          enabled: false,
          shadow: true,
        },
      },
    });
    const engine = await resolveContextEngine(parsed);

    expect(engine.info.id).toBe('legacy');
  });

  it('quarantines a default-on CRK assemble failure and falls back to legacy', async () => {
    const messages = [{ role: 'user', content: 'fallback please' }] as AgentMessage[];
    registerContextEngineForOwner('context-runtime-kit', async () => ({
      info: { id: 'context-runtime-kit', name: 'Broken CRK' },
      async ingest() {
        return { ingested: false };
      },
      async assemble() {
        throw new Error('CRK assemble exploded');
      },
      async compact() {
        throw new Error('CRK compact exploded');
      },
    }), 'core', { allowSameOwnerRefresh: true });

    const engine = await resolveContextEngine({});
    const assembled = await engine.assemble({
      sessionId: 'session-fallback',
      messages,
    });

    expect(assembled.messages).toBe(messages);
    expect(engine.info.id).toBe('legacy');
    expect(listContextEngineQuarantines()).toEqual([
      expect.objectContaining({
        engineId: 'context-runtime-kit',
        operation: 'assemble',
        reason: 'CRK assemble exploded',
      }),
    ]);
  });
});
