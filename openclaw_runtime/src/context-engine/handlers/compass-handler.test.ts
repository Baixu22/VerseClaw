import { describe, expect, it, vi } from "vitest";
import type { ContextBlockSink } from "../block.js";
import type { PreReplyInjection } from "../../runtime-core/memory-pre-reply-injection.js";
import {
  buildCompassKnowledgeBlock,
  formatKnowledgeInjection,
  handleCompassKnowledge,
} from "./compass-handler.js";

describe("DCS Stage 4 compass-handler", () => {
  describe("buildCompassKnowledgeBlock", () => {
    it("constructs a knowledge Block with spec-mandated presence fields", () => {
      const injection: PreReplyInjection = {
        sspString: "## SSP\nobjective: ship feature",
        top5FactsString: "## Top 5 Facts\n- fact A",
        iFrameRefreshed: false,
      };
      const block = buildCompassKnowledgeBlock({
        sessionId: "agent:alpha:main",
        injection,
        now: new Date("2026-07-12T00:00:00.000Z"),
      });

      expect(block.block_id).toBe("knowledge:compass:agent:alpha:main");
      expect(block.block_type).toBe("knowledge");
      expect(block.source_system).toBe("compass");
      expect(block.session_id).toBe("agent:alpha:main");
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

    it("full_content concatenates sspString and top5FactsString", () => {
      const injection: PreReplyInjection = {
        sspString: "## SSP\nobjective: ship feature",
        top5FactsString: "## Top 5 Facts\n- fact A",
        iFrameRefreshed: false,
      };
      const block = buildCompassKnowledgeBlock({
        sessionId: "session-a",
        injection,
      });

      expect(block.full_content).toBe(
        "## SSP\nobjective: ship feature\n\n## Top 5 Facts\n- fact A",
      );
    });

    it("full_content is undefined when both sspString and top5FactsString are absent", () => {
      const injection: PreReplyInjection = {
        iFrameRefreshed: false,
      };
      const block = buildCompassKnowledgeBlock({
        sessionId: "session-a",
        injection,
      });

      expect(block.full_content).toBeUndefined();
    });

    it("summary follows the spec format with context_search hint", () => {
      const injection: PreReplyInjection = { iFrameRefreshed: false };
      const block = buildCompassKnowledgeBlock({
        sessionId: "session-a",
        injection,
      });

      expect(block.summary).toBe("## Knowledge\n→ context_search('compass') for full facts");
    });
  });

  describe("handleCompassKnowledge", () => {
    it("returns undefined when no sink is provided", async () => {
      const injection: PreReplyInjection = { iFrameRefreshed: false };
      const result = await handleCompassKnowledge({
        sessionId: "session-a",
        injection,
        contextBlockSink: undefined,
      });
      expect(result).toBeUndefined();
    });

    it("writes a knowledge Block through the sink with significance=high", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const injection: PreReplyInjection = {
        sspString: "## SSP",
        iFrameRefreshed: false,
      };
      const result = await handleCompassKnowledge({
        sessionId: "session-a",
        injection,
        contextBlockSink: sink,
      });

      expect(result).toEqual({ accepted: true });
      expect(sink).toHaveBeenCalledTimes(1);
      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { block_type: string; source_system: string };
        admission: {
          significance: string;
          write_origin: string;
          verification_status: string;
          confidence: number;
          audn_state: string;
        };
      }>;
      expect(writeArg[0].block.block_type).toBe("knowledge");
      expect(writeArg[0].block.source_system).toBe("compass");
      expect(writeArg[0].admission).toEqual({
        significance: "high",
        write_origin: "handler",
        verification_status: "verified",
        confidence: 1.0,
        audn_state: "ACTIVE",
      });
    });
  });

  describe("formatKnowledgeInjection", () => {
    it("returns undefined when block is undefined", () => {
      expect(formatKnowledgeInjection(undefined)).toBeUndefined();
    });

    it("returns undefined when full_content is absent", () => {
      const block = {
        full_content: undefined,
      };
      expect(formatKnowledgeInjection(block as never)).toBeUndefined();
    });

    it("returns undefined when full_content is empty", () => {
      const block = {
        full_content: "   ",
      };
      expect(formatKnowledgeInjection(block as never)).toBeUndefined();
    });

    it("returns ## Knowledge heading with content", () => {
      const block = {
        full_content: "## SSP\nobjective: ship feature",
      };
      const result = formatKnowledgeInjection(block as never);
      expect(result).toBe("## Knowledge\n## SSP\nobjective: ship feature");
    });
  });
});
