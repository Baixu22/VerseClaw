import type {
  AnyAgentTool,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it } from "vitest";
import fileTransferPlugin from "./index.js";

type ToolRegistration = AnyAgentTool | OpenClawPluginToolFactory;

function captureToolRegistrations(): ToolRegistration[] {
  const registrations: ToolRegistration[] = [];
  fileTransferPlugin.register({
    registerNodeInvokePolicy() {},
    registerTool(tool: ToolRegistration) {
      registrations.push(tool);
    },
  } as never);
  return registrations;
}

function materializeToolNames(
  registrations: ToolRegistration[],
  context: OpenClawPluginToolContext,
): string[] {
  return registrations.flatMap((registration) => {
    const result = typeof registration === "function" ? registration(context) : registration;
    if (!result) {
      return [];
    }
    return (Array.isArray(result) ? result : [result]).map((tool) => tool.name);
  });
}

function createContext(params?: {
  allowCommands?: string[];
  denyCommands?: string[];
  nodes?: Record<string, Record<string, unknown>>;
}): OpenClawPluginToolContext {
  return {
    config: {
      gateway: {
        nodes: {
          allowCommands: params?.allowCommands,
          denyCommands: params?.denyCommands,
        },
      },
      plugins: {
        entries: {
          "file-transfer": {
            config: { nodes: params?.nodes },
          },
        },
      },
    } as never,
  };
}

function createReadPolicyContext(): OpenClawPluginToolContext {
  return createContext({
    allowCommands: ["file.fetch", "dir.list", "dir.fetch"],
    nodes: { "*": { allowReadPaths: ["/srv/**"] } },
  });
}

describe("file-transfer tool publication", () => {
  const registrations = captureToolRegistrations();

  it("hides paired-node tools from the default single-machine surface", () => {
    expect(materializeToolNames(registrations, createContext())).toEqual([]);
  });

  it("requires both gateway command and node path policy configuration", () => {
    const commandsOnly = createContext({
      allowCommands: ["file.fetch", "dir.list", "dir.fetch", "file.write"],
    });
    const policiesOnly = createContext({
      nodes: { "*": { allowReadPaths: ["/srv/**"], allowWritePaths: ["/srv/out/**"] } },
    });
    expect(materializeToolNames(registrations, commandsOnly)).toEqual([]);
    expect(materializeToolNames(registrations, policiesOnly)).toEqual([]);
  });

  it("publishes only configured read-side tools", () => {
    const context = createReadPolicyContext();
    expect(materializeToolNames(registrations, context)).toEqual([
      "file_fetch",
      "dir_list",
      "dir_fetch",
    ]);
  });

  it("uses the latest runtime config instead of a stale startup snapshot", () => {
    const staleContext = createReadPolicyContext();
    const context: OpenClawPluginToolContext = {
      ...staleContext,
      getRuntimeConfig: () => createContext().config,
    };
    expect(materializeToolNames(registrations, context)).toEqual([]);
  });

  it("publishes file_write for an approval-enabled write policy", () => {
    const context = createContext({
      allowCommands: ["file.write"],
      nodes: { workstation: { ask: "on-miss" } },
    });
    expect(materializeToolNames(registrations, context)).toEqual(["file_write"]);
  });

  it("honors gateway denyCommands over explicit allows", () => {
    const context = createContext({
      allowCommands: ["file.fetch", "dir.list"],
      denyCommands: ["dir.list"],
      nodes: { "*": { allowReadPaths: ["/srv/**"] } },
    });
    expect(materializeToolNames(registrations, context)).toEqual(["file_fetch"]);
  });
});
