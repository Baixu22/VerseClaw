import { describe, expect, it, vi } from "vitest";
import type { ContextBlockSink } from "../block.js";
import type { ContextPack } from "../../memory/types.js";
import {
  buildRoleMemoryKnowledgeBlock,
  handleRoleMemoryKnowledge,
} from "./role-memory-handler.js";
import { formatKnowledgeInjection } from "./compass-handler.js";

describe("DCS Stage 4 role-memory-handler", () => {
  describe("buildRoleMemoryKnowledgeBlock", () => {
    it("constructs a knowledge Block with spec-mandated presence fields", () => {
      const pack: ContextPack = {
        budget: { total: 0 } as ContextPack["budget"],
        buckets: {} as ContextPack["buckets"],
        estimatedTokens: { total: 0 } as ContextPack["estimatedTokens"],
        truncated: false,
      };
      const block = buildRoleMemoryKnowledgeBlock({
        sessionId: "agent:alpha:subagent:child",
        pack,
        now: new Date("2026-07-12T00:00:00.000Z"),
      });

      expect(block.block_id).toBe("knowledge:role-memory:agent:alpha:subagent:child");
      expect(block.block_type).toBe("knowledge");
      expect(block.source_system).toBe("role-memory");
      expect(block.session_id).toBe("agent:alpha:subagent:child");
      expect(block.mutability).toBe("system_managed");
      expect(block.presence).toEqual({
        always_on: false,
        token_budget: 400,
        priority: 5,
        on_demand: { expand_tool: "context_search", auto_register: false },
        background: true,
      });
      expect(block.compression_depth).toBe(0);
      expect(block.entity_extraction_status).toBe("empty");
    });

    it("full_content serializes ContextPack buckets", () => {
      const pack: ContextPack = {
        budget: { total: 100 } as ContextPack["budget"],
        buckets: {
          hardConstraints: [],
          rolePlaybook: ["objective: ship feature"],
          projectFacts: [],
          teamHandoffs: [],
          recentEpisodes: [],
          openConflicts: [],
          taskState: [],
        },
        estimatedTokens: { total: 50 } as ContextPack["estimatedTokens"],
        truncated: false,
        policyVersion: "v1",
      };
      const block = buildRoleMemoryKnowledgeBlock({
        sessionId: "session-a",
        pack,
      });

      const parsed = JSON.parse(block.full_content ?? "{}") as Record<string, string[]>;
      expect(parsed.rolePlaybook).toEqual(["objective: ship feature"]);
    });

    it("summary follows the spec format with context_search hint", () => {
      const pack: ContextPack = {
        budget: { total: 0 } as ContextPack["budget"],
        buckets: {} as ContextPack["buckets"],
        estimatedTokens: { total: 0 } as ContextPack["estimatedTokens"],
        truncated: false,
      };
      const block = buildRoleMemoryKnowledgeBlock({
        sessionId: "session-a",
        pack,
      });

      expect(block.summary).toBe("## Knowledge\n→ context_search('role-memory') for full pack");
    });
  });

  describe("handleRoleMemoryKnowledge", () => {
    it("returns undefined when no sink is provided", async () => {
      const pack: ContextPack = {
        budget: { total: 0 } as ContextPack["budget"],
        buckets: {} as ContextPack["buckets"],
        estimatedTokens: { total: 0 } as ContextPack["estimatedTokens"],
        truncated: false,
      };
      const result = await handleRoleMemoryKnowledge({
        sessionId: "session-a",
        pack,
        contextBlockSink: undefined,
      });
      expect(result).toBeUndefined();
    });

    it("writes a knowledge Block through the sink with significance=medium", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const pack: ContextPack = {
        budget: { total: 0 } as ContextPack["budget"],
        buckets: {} as ContextPack["buckets"],
        estimatedTokens: { total: 0 } as ContextPack["estimatedTokens"],
        truncated: false,
      };
      const result = await handleRoleMemoryKnowledge({
        sessionId: "session-a",
        pack,
        contextBlockSink: sink,
      });

      expect(result).toEqual({ accepted: true });
      expect(sink).toHaveBeenCalledTimes(1);
      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { block_type: string; source_system: string };
        admission: { significance: string; write_origin: string };
      }>;
      expect(writeArg[0].block.block_type).toBe("knowledge");
      expect(writeArg[0].block.source_system).toBe("role-memory");
      expect(writeArg[0].admission).toEqual({
        significance: "medium",
        write_origin: "handler",
      });
    });
  });

  describe("formatKnowledgeInjection (shared)", () => {
    it("returns ## Knowledge heading with role-memory content", () => {
      const block = {
        full_content: JSON.stringify({
          buckets: { role: ["objective"] },
        }),
      };
      const result = formatKnowledgeInjection(block as never);
      expect(result).toContain("## Knowledge");
      expect(result).toContain("objective");
    });
  });
});
