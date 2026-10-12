import { describe, expect, it } from "vitest";
import { canonicalizeProviderTools, summarizeProviderPayloadCacheShape } from "../../openclaw_runtime/src/agents/provider-payload-cache-shape.js";
import {
  createToolSearchCatalogRef,
  resolveToolSearchConfig,
  TOOL_CALL_RAW_TOOL_NAME,
  TOOL_DESCRIBE_RAW_TOOL_NAME,
  TOOL_SEARCH_RAW_TOOL_NAME,
  applyToolSearchCatalog,
} from "../../openclaw_runtime/src/agents/tool-search.js";
import type { AnyAgentTool } from "../../openclaw_runtime/src/agents/tools/common.js";
import type { OpenClawConfig } from "../../openclaw_runtime/src/config/types.openclaw.js";

function tool(name: string, description = name): AnyAgentTool {
  return {
    name,
    description,
    parameters: { type: "object", properties: { value: { type: "string" } } },
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  } as unknown as AnyAgentTool;
}

function autoConfig(overrides: Record<string, unknown> = {}): OpenClawConfig {
  return {
    tools: {
      toolSearch: {
        auto: true,
        mode: "tools",
        autoMinTools: 4,
        autoMinSchemaBytes: 1_000_000,
        ...overrides,
      },
    },
  } as OpenClawConfig;
}

function controls(): AnyAgentTool[] {
  return [
    tool(TOOL_SEARCH_RAW_TOOL_NAME),
    tool(TOOL_DESCRIBE_RAW_TOOL_NAME),
    tool(TOOL_CALL_RAW_TOOL_NAME),
  ];
}

function userTools(count: number, start = 0): AnyAgentTool[] {
  return Array.from({ length: count }, (_, index) =>
    tool(`mcp_tool_${start + index}`, `MCP tool ${start + index}`),
  );
}

function apply(tools: AnyAgentTool[], config = autoConfig()) {
  return applyToolSearchCatalog({
    tools,
    config,
    sessionKey: "tool-mask-test",
    catalogRef: createToolSearchCatalogRef(),
  });
}

function providerShape(tools: AnyAgentTool[]) {
  const providerTools = tools.map((entry) => ({
    type: "function",
    name: entry.name,
    description: entry.description ?? "",
    parameters: entry.parameters,
  }));
  return summarizeProviderPayloadCacheShape({ tools: providerTools });
}

describe("automatic Tool Search masking", () => {
  it("activates from tool count only when the opt-in threshold is met", () => {
    expect(resolveToolSearchConfig(autoConfig(), { toolCount: 3 }).enabled).toBe(false);
    expect(resolveToolSearchConfig(autoConfig(), { toolCount: 4 }).enabled).toBe(true);
    expect(resolveToolSearchConfig(autoConfig(), { toolCount: 4 }).auto).toBe(true);
  });

  it("activates from schema bytes independently of tool count", () => {
    const config = autoConfig({ autoMinTools: 100, autoMinSchemaBytes: 10 });
    expect(resolveToolSearchConfig(config, { toolCount: 1, schemaBytes: 9 }).enabled).toBe(false);
    expect(resolveToolSearchConfig(config, { toolCount: 1, schemaBytes: 10 }).enabled).toBe(true);
  });

  it("lets explicit enabled=false override auto and keeps the original array", () => {
    const config = autoConfig({ enabled: false, autoMinTools: 1 });
    const result = apply([...controls(), ...userTools(8)], config);
    expect(result.compacted).toBe(false);
    expect(result.tools.map((entry) => entry.name)).toEqual(userTools(8).map((entry) => entry.name));
  });

  it("keeps provider tools and hashes stable when a hidden member is removed or added", () => {
    const baseTools = userTools(8);
    const removed = apply([...controls(), ...baseTools.slice(1)]);
    const added = apply([...controls(), ...baseTools, tool("mcp_tool_new")]);

    expect(removed.compacted).toBe(true);
    expect(added.compacted).toBe(true);
    expect(removed.tools.map((entry) => entry.name).toSorted()).toEqual(
      [TOOL_SEARCH_RAW_TOOL_NAME, TOOL_DESCRIBE_RAW_TOOL_NAME, TOOL_CALL_RAW_TOOL_NAME].toSorted(),
    );
    expect(added.tools.map((entry) => entry.name).toSorted()).toEqual(
      [TOOL_SEARCH_RAW_TOOL_NAME, TOOL_DESCRIBE_RAW_TOOL_NAME, TOOL_CALL_RAW_TOOL_NAME].toSorted(),
    );
    expect(providerShape(removed.tools).toolsHash).toBe(providerShape(added.tools).toolsHash);
    expect(providerShape(removed.tools).prefixShapeHash).toBe(
      providerShape(added.tools).prefixShapeHash,
    );
  });

  it("does not expose controls below threshold and removed tools stay out of the catalog surface", () => {
    const belowThreshold = apply([...controls(), ...userTools(2)]);
    expect(belowThreshold.compacted).toBe(false);
    expect(belowThreshold.tools.map((entry) => entry.name)).not.toContain(TOOL_SEARCH_RAW_TOOL_NAME);
    expect(canonicalizeProviderTools(providerShape(belowThreshold.tools).toolNames)).toEqual(
      belowThreshold.tools.map((entry) => entry.name),
    );
  });
});
