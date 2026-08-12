import { GatewayClientRequestError } from "../../gateway/client.js";
import { buildConfigSchema, lookupConfigSchema } from "../../config/schema.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  callGatewayTool: vi.fn(),
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: gatewayMocks.callGatewayTool,
  readGatewayCallOptions: () => ({}),
}));

import { createGatewayTool } from "./gateway-tool.js";

async function executeLookup(params: Record<string, unknown>) {
  const tool = createGatewayTool();
  if (!tool.execute) {
    throw new Error("gateway tool execute missing");
  }
  return await tool.execute("lookup-call", {
    action: "config.schema.lookup",
    ...params,
  });
}

describe("gateway config schema lookup discovery", () => {
  beforeEach(() => {
    gatewayMocks.callGatewayTool.mockReset();
  });

  it.each([{ path: undefined }, { path: "   " }])(
    "uses the root lookup when path is omitted or blank",
    async ({ path }) => {
      const rootResult = {
        path: ".",
        children: [{ key: "agents", path: "agents" }],
      };
      gatewayMocks.callGatewayTool.mockResolvedValue(rootResult);

      const result = await executeLookup(path === undefined ? {} : { path });

      expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
        "config.schema.lookup",
        {},
        { path: "." },
      );
      expect(result.details).toEqual({ ok: true, result: rootResult });
    },
  );

  it("forwards a valid targeted path unchanged", async () => {
    const lookupResult = { path: "agents.defaults.compaction", children: [] };
    gatewayMocks.callGatewayTool.mockResolvedValue(lookupResult);

    const result = await executeLookup({ path: "agents.defaults.compaction" });

    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "config.schema.lookup",
      {},
      { path: "agents.defaults.compaction" },
    );
    expect(result.details).toEqual({ ok: true, result: lookupResult });
  });

  it("exposes agent settings at their canonical path from the schema root", () => {
    const schema = buildConfigSchema({ cache: false });
    const root = lookupConfigSchema(schema, ".");

    expect(root?.children).toContainEqual(expect.objectContaining({ path: "agents" }));
    expect(lookupConfigSchema(schema, "agents.defaults.compaction")).not.toBeNull();
    expect(lookupConfigSchema(schema, "context.compaction")).toBeNull();
  });

  it("returns a root recovery path when the requested path is missing", async () => {
    gatewayMocks.callGatewayTool.mockRejectedValue(
      new GatewayClientRequestError({
        code: "INVALID_REQUEST",
        message: "config schema path not found",
      }),
    );

    const result = await executeLookup({ path: "context.compaction" });

    expect(result.details).toMatchObject({
      ok: false,
      code: "schema_path_not_found",
      path: "context.compaction",
      recoveryPath: ".",
      message: expect.stringContaining("agents.defaults"),
    });
  });
});
