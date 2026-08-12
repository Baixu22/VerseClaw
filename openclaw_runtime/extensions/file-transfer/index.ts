// File Transfer plugin entrypoint registers its OpenClaw integration.
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginNodeHostCommand,
  type OpenClawPluginToolContext,
  type OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/plugin-entry";
import { resolveNodeCommandAllowlist } from "openclaw/plugin-sdk/gateway-runtime";
import { createLazyFileTransferNodeInvokePolicy } from "./src/shared/lazy-node-invoke-policy.js";
import {
  DIR_FETCH_TOOL_DESCRIPTOR,
  DIR_LIST_TOOL_DESCRIPTOR,
  FILE_FETCH_TOOL_DESCRIPTOR,
  FILE_WRITE_TOOL_DESCRIPTOR,
} from "./src/tools/descriptors.js";

type FileTransferToolDescriptor = Pick<
  AnyAgentTool,
  "label" | "name" | "description" | "parameters"
>;

type FileTransferPolicyKind = "read" | "write";
type FileTransferRuntimeConfig = NonNullable<OpenClawPluginToolContext["config"]>;

type FileTransferNodePolicy = {
  allowReadPaths?: string[];
  allowWritePaths?: string[];
  ask?: "off" | "on-miss" | "always";
};

type FileTransferToolRegistration = {
  command: string;
  descriptor: FileTransferToolDescriptor;
  kind: FileTransferPolicyKind;
  loadTool: () => Promise<AnyAgentTool>;
};

function readNodeCommandParams(paramsJSON: string | null | undefined): unknown {
  return paramsJSON ? JSON.parse(paramsJSON) : {};
}

function createLazyTool(
  descriptor: FileTransferToolDescriptor,
  loadTool: () => Promise<AnyAgentTool>,
): AnyAgentTool {
  let toolPromise: Promise<AnyAgentTool> | undefined;
  const loadOnce = () => {
    toolPromise ??= loadTool();
    return toolPromise;
  };
  return {
    ...descriptor,
    async execute(toolCallId, args, signal, onUpdate) {
      const tool = await loadOnce();
      return await tool.execute(toolCallId, args, signal, onUpdate);
    },
  };
}

function hasConfiguredNodePolicy(
  config: FileTransferRuntimeConfig,
  kind: FileTransferPolicyKind,
): boolean {
  const pluginConfig = config?.plugins?.entries?.["file-transfer"]?.config;
  const nodes = (pluginConfig as { nodes?: Record<string, FileTransferNodePolicy> } | undefined)
    ?.nodes;
  if (!nodes) {
    return false;
  }
  const allowKey = kind === "read" ? "allowReadPaths" : "allowWritePaths";
  return Object.values(nodes).some((policy) => {
    const allowPaths = policy[allowKey];
    const hasAllowedPath = allowPaths?.some((entry) => entry.trim().length > 0) === true;
    return policy.ask === "always" || policy.ask === "on-miss" || hasAllowedPath;
  });
}

function createConfiguredToolFactory(
  params: FileTransferToolRegistration,
): OpenClawPluginToolFactory {
  const tool = createLazyTool(params.descriptor, params.loadTool);
  return (context) => {
    const config = context.getRuntimeConfig?.() ?? context.runtimeConfig ?? context.config;
    if (!config || !resolveNodeCommandAllowlist(config).has(params.command)) {
      return null;
    }
    // Factories are synchronous: active policy controls publication, while
    // transient node disconnects remain an execution-time error.
    return hasConfiguredNodePolicy(config, params.kind) ? tool : null;
  };
}

const fileTransferTools = [
  {
    command: "file.fetch",
    descriptor: FILE_FETCH_TOOL_DESCRIPTOR,
    kind: "read",
    loadTool: async () => {
      const { createFileFetchTool } = await import("./src/tools/file-fetch-tool.js");
      return createFileFetchTool();
    },
  },
  {
    command: "dir.list",
    descriptor: DIR_LIST_TOOL_DESCRIPTOR,
    kind: "read",
    loadTool: async () => {
      const { createDirListTool } = await import("./src/tools/dir-list-tool.js");
      return createDirListTool();
    },
  },
  {
    command: "dir.fetch",
    descriptor: DIR_FETCH_TOOL_DESCRIPTOR,
    kind: "read",
    loadTool: async () => {
      const { createDirFetchTool } = await import("./src/tools/dir-fetch-tool.js");
      return createDirFetchTool();
    },
  },
  {
    command: "file.write",
    descriptor: FILE_WRITE_TOOL_DESCRIPTOR,
    kind: "write",
    loadTool: async () => {
      const { createFileWriteTool } = await import("./src/tools/file-write-tool.js");
      return createFileWriteTool();
    },
  },
] satisfies FileTransferToolRegistration[];

const fileTransferNodeHostCommands: OpenClawPluginNodeHostCommand[] = [
  {
    command: "file.fetch",
    cap: "file",
    dangerous: true,
    handle: async (paramsJSON) => {
      const { handleFileFetch } = await import("./src/node-host/file-fetch.js");
      const params = readNodeCommandParams(paramsJSON) as Parameters<typeof handleFileFetch>[0];
      const result = await handleFileFetch(params);
      return JSON.stringify(result);
    },
  },
  {
    command: "dir.list",
    cap: "file",
    dangerous: true,
    handle: async (paramsJSON) => {
      const { handleDirList } = await import("./src/node-host/dir-list.js");
      const params = readNodeCommandParams(paramsJSON) as Parameters<typeof handleDirList>[0];
      const result = await handleDirList(params);
      return JSON.stringify(result);
    },
  },
  {
    command: "dir.fetch",
    cap: "file",
    dangerous: true,
    handle: async (paramsJSON) => {
      const { handleDirFetch } = await import("./src/node-host/dir-fetch.js");
      const params = readNodeCommandParams(paramsJSON) as Parameters<typeof handleDirFetch>[0];
      const result = await handleDirFetch(params);
      return JSON.stringify(result);
    },
  },
  {
    command: "file.write",
    cap: "file",
    dangerous: true,
    handle: async (paramsJSON) => {
      const { handleFileWrite } = await import("./src/node-host/file-write.js");
      const params = readNodeCommandParams(paramsJSON) as Parameters<typeof handleFileWrite>[0];
      const result = await handleFileWrite(params);
      return JSON.stringify(result);
    },
  },
];

export default definePluginEntry({
  id: "file-transfer",
  name: "File Transfer",
  description: "Fetch, list, and write files on paired nodes via dedicated node commands.",
  nodeHostCommands: fileTransferNodeHostCommands,
  register(api) {
    api.registerNodeInvokePolicy(createLazyFileTransferNodeInvokePolicy());
    for (const tool of fileTransferTools) {
      api.registerTool(createConfiguredToolFactory(tool), { name: tool.descriptor.name });
    }
  },
});
