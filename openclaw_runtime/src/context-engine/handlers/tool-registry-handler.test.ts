import { describe, expect, it, vi } from "vitest";
import type { ContextBlockSink } from "../block.js";
import {
  buildToolRegistryBlock,
  formatToolRegistryInjection,
  handleBeforeAgentStartToolRegistry,
  mapToolsToToolRegistryEntries,
  type ToolRegistryEntry,
} from "./tool-registry-handler.js";

describe("DCS Stage 3 tool-registry handler", () => {
  describe("buildToolRegistryBlock", () => {
    it("constructs a tool_registry Block with the spec-mandated presence fields", () => {
      const entries: ToolRegistryEntry[] = [
        { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit a file" },
        { resourceId: "write", kind: "toolset", title: "Write", purpose: "Write a file" },
      ];
      const block = buildToolRegistryBlock({
        sessionId: "agent:alpha:main",
        entries,
        now: new Date("2026-07-12T00:00:00.000Z"),
      });

      expect(block.block_id).toBe("tool-registry:agent:alpha:main");
      expect(block.block_type).toBe("tool_registry");
      expect(block.source_system).toBe("cvk");
      expect(block.session_id).toBe("agent:alpha:main");
      expect(block.mutability).toBe("system_managed");
      expect(block.presence).toEqual({
        always_on: true,
        token_budget: 200,
        priority: 7,
        on_demand: { expand_tool: "context_read", auto_register: true },
      });
      expect(block.compression_depth).toBe(0);
      expect(block.entity_extraction_status).toBe("empty");
    });

    it("summary follows the spec format with count and context_read hint", () => {
      const entries: ToolRegistryEntry[] = [
        { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit a file" },
        { resourceId: "write", kind: "toolset", title: "Write", purpose: "Write a file" },
        { resourceId: "bash", kind: "toolset", title: "Bash", purpose: "Run a command" },
      ];
      const block = buildToolRegistryBlock({
        sessionId: "session-a",
        entries,
      });

      expect(block.summary).toBe(
        "## Tools (3 available)\n→ context_read('tool_registry') for full schema",
      );
    });

    it("full_content contains structured tool entries JSON", () => {
      const entries: ToolRegistryEntry[] = [
        {
          resourceId: "edit",
          kind: "toolset",
          title: "Edit",
          purpose: "Edit a file",
          category: "filesystem",
        },
      ];
      const block = buildToolRegistryBlock({
        sessionId: "session-a",
        entries,
      });

      const parsed = JSON.parse(block.full_content ?? "{}") as {
        entries: ToolRegistryEntry[];
      };
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]).toEqual(entries[0]);
    });

    it("caps entries at 40 to match CVK registry view limit", () => {
      const entries: ToolRegistryEntry[] = Array.from({ length: 50 }, (_, i) => ({
        resourceId: `tool-${i}`,
        kind: "toolset",
        title: `Tool ${i}`,
        purpose: `Purpose ${i}`,
      }));
      const block = buildToolRegistryBlock({
        sessionId: "session-a",
        entries,
      });

      const parsed = JSON.parse(block.full_content ?? "{}") as {
        entries: ToolRegistryEntry[];
      };
      expect(parsed.entries).toHaveLength(40);
      expect(block.summary).toContain("40 available");
    });
  });

  describe("handleBeforeAgentStartToolRegistry", () => {
    it("returns undefined when no contextBlockSink is provided", async () => {
      const result = await handleBeforeAgentStartToolRegistry({
        sessionId: "session-a",
        entries: [
          { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit" },
        ],
      });
      expect(result).toBeUndefined();
    });

    it("writes a tool_registry Block through the sink and returns acceptance", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const result = await handleBeforeAgentStartToolRegistry({
        sessionId: "agent:alpha:main",
        entries: [
          { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit" },
        ],
        contextBlockSink: sink,
      });

      expect(result).toEqual({ accepted: true });
      expect(sink).toHaveBeenCalledTimes(1);
      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { block_type: string; source_system: string };
        admission: { significance: string; write_origin: string };
      }>;
      expect(writeArg[0].block.block_type).toBe("tool_registry");
      expect(writeArg[0].block.source_system).toBe("cvk");
      expect(writeArg[0].admission).toEqual({
        significance: "high",
        write_origin: "handler",
      });
    });

    it("returns the sink rejection result without fabricating acceptance", async () => {
      const sink: ContextBlockSink = vi.fn(async () => [{ accepted: false, reason: "full" }]);
      const result = await handleBeforeAgentStartToolRegistry({
        sessionId: "session-a",
        entries: [
          { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit" },
        ],
        contextBlockSink: sink,
      });

      expect(result).toEqual({ accepted: false });
    });
  });

  describe("formatToolRegistryInjection", () => {
    it("returns undefined when block is undefined", () => {
      expect(formatToolRegistryInjection(undefined)).toBeUndefined();
    });

    it("returns undefined when full_content is missing", () => {
      expect(
        formatToolRegistryInjection({
          block_id: "x",
          block_type: "tool_registry",
          source_system: "cvk",
          presence: { always_on: true },
          entities: [],
          valid_at: new Date(),
          mutability: "system_managed",
          summary: "",
          compression_depth: 0,
          entity_extraction_status: "empty",
        }),
      ).toBeUndefined();
    });

    it("returns undefined when full_content is not valid JSON", () => {
      expect(
        formatToolRegistryInjection({
          block_id: "x",
          block_type: "tool_registry",
          source_system: "cvk",
          presence: { always_on: true },
          entities: [],
          valid_at: new Date(),
          mutability: "system_managed",
          summary: "",
          full_content: "not-json",
          compression_depth: 0,
          entity_extraction_status: "empty",
        }),
      ).toBeUndefined();
    });

    it("returns undefined when entries array is empty or missing", () => {
      expect(
        formatToolRegistryInjection({
          block_id: "x",
          block_type: "tool_registry",
          source_system: "cvk",
          presence: { always_on: true },
          entities: [],
          valid_at: new Date(),
          mutability: "system_managed",
          summary: "",
          full_content: JSON.stringify({ entries: [] }),
          compression_depth: 0,
          entity_extraction_status: "empty",
        }),
      ).toBeUndefined();
    });

    it("formats the injection string with count when entries exist", () => {
      const block = buildToolRegistryBlock({
        sessionId: "session-a",
        entries: [
          { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit" },
          { resourceId: "write", kind: "toolset", title: "Write", purpose: "Write" },
        ],
      });
      const injection = formatToolRegistryInjection(block);
      expect(injection).toBe(
        "## Tools (2 available)\n→ context_read('tool_registry') for full schema",
      );
    });
  });


  describe("mapToolsToToolRegistryEntries", () => {
    it("maps production tools to ToolRegistryEntry fields", () => {
      const entries = mapToolsToToolRegistryEntries(
        [
          {
            name: "context_read",
            label: "Context Read",
            description: "Read context blocks on demand",
            parameters: {
              type: "object",
              properties: { block_type: { type: "string" }, category: { type: "string" } },
            },
            risk: "readonly",
          },
          {
            name: "edit",
            description: "Edit a file",
            displaySummary: "Edit files",
          },
        ],
        { schemaMode: "full" },
      );
      expect(entries).toEqual([
        {
          resourceId: "context_read",
          kind: "toolset",
          title: "Context Read",
          purpose: "Read context blocks on demand [block_type, category]",
          category: "readonly",
        },
        {
          resourceId: "edit",
          kind: "toolset",
          title: "Edit",
          purpose: "Edit a file",
        },
      ]);
    });

    it("on_demand summary mode stores inputSchema without prop dump in purpose", () => {
      const entries = mapToolsToToolRegistryEntries(
        [
          {
            name: "context_read",
            label: "Context Read",
            description: "Read context blocks on demand",
            parameters: {
              type: "object",
              properties: { block_type: { type: "string" }, category: { type: "string" } },
            },
            risk: "readonly",
          },
        ],
        { schemaMode: "summary" },
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.purpose).toBe("Read full content of a context block on demand");
      expect(entries[0]?.purpose).not.toContain("[");
      expect(entries[0]?.inputSchema).toEqual({
        type: "object",
        properties: { block_type: { type: "string" }, category: { type: "string" } },
      });
    });

    it("returns empty array for empty/missing tools without throwing", () => {
      expect(mapToolsToToolRegistryEntries([])).toEqual([]);
      expect(mapToolsToToolRegistryEntries(undefined)).toEqual([]);
      expect(mapToolsToToolRegistryEntries(null)).toEqual([]);
    });

    it("on_demand summary mode stores inputSchema without prop dump in purpose", () => {
      const entries = mapToolsToToolRegistryEntries(
        [
          {
            name: "context_read",
            label: "Context Read",
            description: "Read context blocks on demand",
            parameters: {
              type: "object",
              properties: { block_type: { type: "string" }, category: { type: "string" } },
            },
            risk: "readonly",
          },
        ],
        { schemaMode: "summary" },
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.purpose).toBe("Read full content of a context block on demand");
      expect(entries[0]?.purpose).not.toContain("[");
      expect(entries[0]?.inputSchema).toEqual({
        type: "object",
        properties: { block_type: { type: "string" }, category: { type: "string" } },
      });
    });

    it("skips nameless tools and dedupes by name", () => {
      const entries = mapToolsToToolRegistryEntries([
        { name: "  " },
        { name: "write", description: "first" },
        { name: "write", description: "second" },
        { description: "no name" },
      ]);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.resourceId).toBe("write");
      expect(entries[0]?.purpose).toBe("first");
    });
  });

});
