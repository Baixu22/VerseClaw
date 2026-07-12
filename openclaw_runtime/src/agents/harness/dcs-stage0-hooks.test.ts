import { describe, expect, it, vi } from "vitest";
import type {
  ContextBlock,
  ContextBlockSink,
  ContextBlockWrite,
} from "../../context-engine/block.js";
import type { GlobalHookRunnerRegistry } from "../../plugins/hook-registry.types.js";
import {
  PLUGIN_HOOK_NAMES,
  type PluginHookRegistration,
  type PluginHookTaskPhaseChangeEvent,
} from "../../plugins/hook-types.js";
import { createHookRunner } from "../../plugins/hooks.js";
import { buildAgentHookContext, createContextBlockSink } from "./hook-context.js";
import { runAgentHarnessTaskPhaseChangeHook } from "./lifecycle-hook-helpers.js";

describe("DCS 阶段 0 hook 扩展", () => {
  it("构建 hook context 时保留 contextBlockSink 引用", () => {
    const sink: ContextBlockSink = vi.fn(async () => []);
    const context = buildAgentHookContext({
      runId: "run-1",
      sessionId: "session-1",
      contextBlockSink: sink,
    });

    expect(context.contextBlockSink).toBe(sink);
  });


  it("contextBlockSink 逐项按序调用 BlockStore.upsert 并返回同序结果", async () => {
    const writes: ContextBlockWrite[] = [
      { block: makeContextBlock("first"), admission: { significance: "high" } },
      { block: makeContextBlock("second"), admission: { significance: "medium" } },
    ];
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({ accepted: true })
      .mockResolvedValueOnce({ accepted: false, reason: "rejected" });
    const sink = createContextBlockSink({ upsert });

    await expect(sink(writes)).resolves.toEqual([
      { accepted: true },
      { accepted: false, reason: "rejected" },
    ]);
    expect(upsert).toHaveBeenNthCalledWith(1, writes[0]?.block, writes[0]?.admission);
    expect(upsert).toHaveBeenNthCalledWith(2, writes[1]?.block, writes[1]?.admission);
  });
  it("只新增 task_phase_change，并复用唯一的 agent_end", async () => {
    expect(PLUGIN_HOOK_NAMES.filter((name) => name === "agent_end")).toHaveLength(1);
    expect(PLUGIN_HOOK_NAMES.filter((name) => name === "task_phase_change")).toHaveLength(1);

    const handler = vi.fn();
    const registry: GlobalHookRunnerRegistry = {
      plugins: [{ id: "dcs-test", status: "loaded" }],
      hooks: [],
      typedHooks: [
        {
          pluginId: "dcs-test",
          hookName: "task_phase_change",
          handler,
          source: "unit-test",
        } as PluginHookRegistration,
      ],
    };
    const runner = createHookRunner(registry, {
      logger: {
        warn() {},
        error() {},
      },
    });
    const event: PluginHookTaskPhaseChangeEvent = {
      sessionId: "session-1",
      taskId: "task-1",
      fromStatus: "running",
      toStatus: "completed",
    };

    await runAgentHarnessTaskPhaseChangeHook({
      event,
      ctx: {
        runId: "run-1",
        sessionId: "session-1",
      },
      hookRunner: runner,
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        runId: "run-1",
        sessionId: "session-1",
      }),
    );
  });
});
function makeContextBlock(block_id: string): ContextBlock {
  return {
    block_id,
    block_type: "working_memory",
    source_system: "working-memory",
    session_id: "session-1",
    presence: { always_on: false, background: true },
    entities: [],
    valid_at: new Date("2026-07-10T00:00:00.000Z"),
    mutability: "system_managed",
    summary: block_id,
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}
