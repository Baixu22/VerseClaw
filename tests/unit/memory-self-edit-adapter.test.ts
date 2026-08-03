// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemorySelfEditTools } from '../../openclaw_runtime/src/runtime-core/memory-self-edit-adapter';

const persistConfig = {
  runtime: {
    memory: {
      persist: true,
    },
  },
};

const disabledConfig = {
  runtime: {
    memory: {
      persist: false,
    },
  },
};

describe('P1-2 memory self-edit adapter', () => {
  it('registers four tools when persist is enabled', () => {
    const tools = createMemorySelfEditTools({ config: persistConfig });
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['memory_forget', 'memory_recall', 'memory_strengthen', 'memory_update']);
  });

  it('returns no tools when persist is disabled', () => {
    const tools = createMemorySelfEditTools({ config: disabledConfig });
    expect(tools).toEqual([]);
  });

  it('returns no tools when config is empty', () => {
    const tools = createMemorySelfEditTools({ config: {} });
    expect(tools).toEqual([]);
  });

  it('memory_recall executes against the runtime store', async () => {
    const tools = createMemorySelfEditTools({ config: persistConfig });
    const recall = tools.find((t) => t.name === 'memory_recall');
    expect(recall).toBeDefined();
    // execute signature is (toolCallId, params, signal, onUpdate); the
    // adapter wraps the self-edit result in an AgentToolResult via
    // payloadTextResult, so the underlying {ok, message} sits in `details`.
    const result = await recall!.execute('call-1', { subject: 'nonexistent' });
    expect(result).toHaveProperty('details');
    expect((result as { details?: { ok?: boolean } }).details).toHaveProperty('ok');
  });

  it('memory_update reports failure for an unknown fact id', async () => {
    const tools = createMemorySelfEditTools({ config: persistConfig });
    const update = tools.find((t) => t.name === 'memory_update');
    expect(update).toBeDefined();
    const result = await update!.execute('call-2', { factId: 'no-such-fact' });
    const details = (result as { details?: { ok?: boolean; message?: string } }).details;
    expect(details?.ok).toBe(false);
    expect(details?.message).toContain('not found');
  });

  it('tools expose schema and display summary', () => {
    const tools = createMemorySelfEditTools({ config: persistConfig });
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expect(tool.displaySummary).toBeTruthy();
    }
  });
});
