import { describe, expect, it, vi } from "vitest";
import type { ContextBlock, ContextBlockSink } from "../block.js";
import {
  writeContext,
  CONTEXT_WRITE_ROLE_WHITELIST,
} from "./context-write-tool.js";

function makeBlock(overrides: Partial<ContextBlock> = {}): ContextBlock {
  return {
    block_id: "notes:agent-notes:session-a",
    block_type: "notes",
    source_system: "agent-notes",
    session_id: "session-a",
    presence: {
      always_on: false,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: false,
    },
    entities: [],
    valid_at: new Date("2026-07-12T00:00:00.000Z"),
    mutability: "agent_writable",
    summary: "## Notes",
    full_content: "existing note",
    compression_depth: 0,
    entity_extraction_status: "empty",
    ...overrides,
  };
}

describe("DCS Stage 5 context-write-tool", () => {
  describe("CONTEXT_WRITE_ROLE_WHITELIST", () => {
    it("contains planner, architect, implementer", () => {
      expect(CONTEXT_WRITE_ROLE_WHITELIST).toContain("planner");
      expect(CONTEXT_WRITE_ROLE_WHITELIST).toContain("architect");
      expect(CONTEXT_WRITE_ROLE_WHITELIST).toContain("implementer");
    });
  });

  describe("writeContext — role whitelist (ANTI-7)", () => {
    it("rejects non-whitelisted role", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const result = await writeContext({
        operation: "append",
        content: "note content",
        role: "observer",
        sessionId: "session-a",
        contextBlockSink: sink,
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain("role");
      expect(sink).not.toHaveBeenCalled();
    });

    it("accepts whitelisted role (planner)", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const result = await writeContext({
        operation: "append",
        content: "note content",
        role: "planner",
        sessionId: "session-a",
        contextBlockSink: sink,
      });

      expect(result.accepted).toBe(true);
      expect(sink).toHaveBeenCalledTimes(1);
    });

    it("accepts whitelisted role (architect)", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const result = await writeContext({
        operation: "replace",
        content: "note content",
        role: "architect",
        sessionId: "session-a",
        contextBlockSink: sink,
      });

      expect(result.accepted).toBe(true);
    });

    it("accepts whitelisted role (implementer)", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const result = await writeContext({
        operation: "clear",
        content: "",
        role: "implementer",
        sessionId: "session-a",
        contextBlockSink: sink,
      });

      expect(result.accepted).toBe(true);
    });
  });

  describe("writeContext — block_type is always notes", () => {
    it("writes a notes Block (sole agent_writable type)", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      await writeContext({
        operation: "append",
        content: "note content",
        role: "planner",
        sessionId: "session-a",
        contextBlockSink: sink,
      });

      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { block_type: string; source_system: string; mutability: string };
        admission: { write_origin: string };
      }>;
      expect(writeArg[0].block.block_type).toBe("notes");
      expect(writeArg[0].block.source_system).toBe("agent-notes");
      expect(writeArg[0].block.mutability).toBe("agent_writable");
      expect(writeArg[0].admission.write_origin).toBe("context_write");
    });
  });

  describe("writeContext — operations", () => {
    it("append: concatenates with existing notes Block content", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      await writeContext({
        operation: "append",
        content: " new note",
        role: "planner",
        sessionId: "session-a",
        contextBlockSink: sink,
        existingBlock: makeBlock({ full_content: "existing note" }),
      });

      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { full_content?: string };
      }>;
      expect(writeArg[0].block.full_content).toBe("existing note new note");
    });

    it("replace: overwrites notes Block content", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      await writeContext({
        operation: "replace",
        content: "new content",
        role: "planner",
        sessionId: "session-a",
        contextBlockSink: sink,
        existingBlock: makeBlock({ full_content: "existing note" }),
      });

      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { full_content?: string };
      }>;
      expect(writeArg[0].block.full_content).toBe("new content");
    });

    it("clear: sets content to empty string", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      await writeContext({
        operation: "clear",
        content: "",
        role: "planner",
        sessionId: "session-a",
        contextBlockSink: sink,
        existingBlock: makeBlock({ full_content: "existing note" }),
      });

      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { full_content?: string };
      }>;
      expect(writeArg[0].block.full_content).toBe("");
    });

    it("append without existing Block: content is just the new note", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      await writeContext({
        operation: "append",
        content: "first note",
        role: "planner",
        sessionId: "session-a",
        contextBlockSink: sink,
        existingBlock: undefined,
      });

      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { full_content?: string };
      }>;
      expect(writeArg[0].block.full_content).toBe("first note");
    });
  });

  describe("writeContext — sink not provided", () => {
    it("returns accepted=false when sink is missing", async () => {
      const result = await writeContext({
        operation: "append",
        content: "note",
        role: "planner",
        sessionId: "session-a",
        contextBlockSink: undefined,
      });

      expect(result.accepted).toBe(false);
    });
  });
});
