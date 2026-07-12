import { describe, expectTypeOf, it } from "vitest";
import type { RuntimeTaskStatus } from "../runtime-core/types.js";
import type {
  BlockAdmissionContext,
  BlockMutability,
  BlockPresence,
  BlockType,
  ContextBlock,
  EntityExtractionStatus,
  HandoffPack,
  SourceSystem,
} from "./block.js";

describe("DCS ContextBlock 类型契约", () => {
  it("导出收敛后的 Block 类型与治理字段", () => {
    expectTypeOf<BlockType>().toEqualTypeOf<
      | "persona"
      | "task_state"
      | "working_memory"
      | "tool_registry"
      | "knowledge"
      | "experience"
      | "environment"
      | "notes"
    >();
    expectTypeOf<BlockMutability>().toEqualTypeOf<"system_managed" | "agent_writable">();
    expectTypeOf<EntityExtractionStatus>().toEqualTypeOf<
      "pending" | "failed" | "empty" | "success"
    >();
    expectTypeOf<ContextBlock["compression_depth"]>().toEqualTypeOf<0 | 1>();
    expectTypeOf<ContextBlock["fallback_mode"]>().toEqualTypeOf<"vector_only" | undefined>();
    expectTypeOf<ContextBlock["presence"]>().toEqualTypeOf<BlockPresence>();
    expectTypeOf<ContextBlock["source_system"]>().toEqualTypeOf<SourceSystem>();
  });

  it("HandoffPack 复用 RuntimeTaskStatus，并暴露 P0 准入事实", () => {
    expectTypeOf<HandoffPack["current_phase"]>().toEqualTypeOf<RuntimeTaskStatus>();
    expectTypeOf<BlockAdmissionContext["confidence"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<BlockAdmissionContext["write_origin"]>().toEqualTypeOf<
      "context_write" | "handler" | undefined
    >();
  });
});
