import { describe, expect, it } from "vitest";
import entry from "../index.js";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";

describe("VerseConf plugin registration", () => {
  it("registers the runtime tool factory and gateway read/write methods", async () => {
    const factories: Array<(context: OpenClawPluginToolContext) => unknown> = [];
    const gatewayMethods: string[] = [];
    const services: Array<{ id: string; stop?: () => Promise<void> }> = [];
    const api = {
      registerTool(factory: unknown) {
        if (typeof factory === "function") factories.push(factory as (context: OpenClawPluginToolContext) => unknown);
      },
      registerGatewayMethod(name: string) { gatewayMethods.push(name); },
      registerService(service: { id: string; stop?: () => Promise<void> }) { services.push(service); },
    } as never;
    entry.register(api);
    expect(factories).toHaveLength(1);
    expect(gatewayMethods).toEqual([
      "verseconf.artifacts.list",
      "verseconf.artifacts.history",
      "verseconf.artifacts.outputs",
      "verseconf.artifacts.disable",
    ]);
    expect(services.map((service) => service.id)).toEqual(["verseconf-artifacts"]);
    const tools = factories[0]!({
      workspaceDir: "C:/workspace",
      sessionKey: "agent:main:plugin",
      sessionId: "session-plugin",
      agentId: "main",
    });
    expect(Array.isArray(tools)).toBe(true);
    expect((tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual([
      "structured_artifact_create",
      "structured_artifact_inspect",
      "structured_artifact_revise",
      "structured_artifact_record_ops",
      "structured_artifact_restore",
      "structured_artifact_history",
      "structured_artifact_export",
      "structured_artifact_disable",
    ]);
    await services[0]?.stop?.();
  });
});
