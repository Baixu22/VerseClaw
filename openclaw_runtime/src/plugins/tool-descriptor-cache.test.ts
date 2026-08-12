import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPluginMetadataLifecycleCaches } from "./plugin-metadata-lifecycle.js";
import { clearPluginLoaderCache } from "./loader.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "./runtime.js";
import { resolvePluginTools } from "./tools.js";
import {
  buildPluginToolDescriptorCacheKey,
  capturePluginToolDescriptor,
  readCachedPluginToolDescriptors,
  resetPluginToolDescriptorCache,
  writeCachedPluginToolDescriptors,
} from "./tool-descriptor-cache.js";

const context = {
  config: {},
  runtimeConfig: {},
  workspaceDir: "C:/workspace",
  agentDir: "C:/agent",
  agentId: "main",
  activeModel: { provider: "test", modelId: "model" },
  messageChannel: "test",
  agentAccountId: "account",
  deliveryContext: { channel: "test", to: "user" },
  requesterSenderId: "sender",
  sandboxed: false,
} as const;

const cacheKeyParams = {
  pluginId: "fixture-plugin",
  source: "C:/plugins/fixture-plugin/index.js",
  rootDir: "C:/plugins/fixture-plugin",
  contractToolNames: ["fixture_tool"],
  ctx: context,
};

const descriptor = capturePluginToolDescriptor({
  pluginId: cacheKeyParams.pluginId,
  optional: false,
  tool: {
    name: "fixture_tool",
    description: "Fixture tool",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [] }),
  } as never,
});

afterEach(() => {
  resetPluginToolDescriptorCache();
});

describe("plugin tool descriptor cache", () => {
  it("keeps the lifecycle key stable without request-time filesystem freshness polling", () => {
    const statSync = vi.spyOn(fs, "statSync");
    const first = buildPluginToolDescriptorCacheKey(cacheKeyParams);

    expect(first).toContain(cacheKeyParams.source);
    expect(JSON.parse(first)).not.toHaveProperty("sourceFingerprint");
    expect(statSync).not.toHaveBeenCalled();
  });

  it("separates descriptors across active plugin registry generations", () => {
    const first = buildPluginToolDescriptorCacheKey({
      ...cacheKeyParams,
      runtimeRegistryVersion: 1,
    });
    const afterReload = buildPluginToolDescriptorCacheKey({
      ...cacheKeyParams,
      runtimeRegistryVersion: 2,
    });

    expect(first).not.toBe(afterReload);
  });

  it("hits written descriptors and clears them at the plugin metadata lifecycle boundary", () => {
    const cacheKey = buildPluginToolDescriptorCacheKey(cacheKeyParams);
    writeCachedPluginToolDescriptors({ cacheKey, descriptors: [descriptor] });

    expect(readCachedPluginToolDescriptors(cacheKey)).toEqual([descriptor]);

    clearPluginMetadataLifecycleCaches();

    expect(readCachedPluginToolDescriptors(cacheKey)).toBeUndefined();
  });

  it("avoids rerunning a real plugin factory on warm resolution, invalidates after registry replacement, and preserves policy gates", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-plugin-tools-cache-"));
    const pluginId = "descriptor-cache-fixture";
    const countFile = path.join(fixtureRoot, "factory-count.txt");
    const pluginSource = path.join(fixtureRoot, "index.cjs");
    const stateDir = path.join(fixtureRoot, "state");
    const workspaceDir = path.join(fixtureRoot, "workspace");
    const agentDir = path.join(fixtureRoot, "agent");
    const config: {
      plugins: {
        enabled: boolean;
        load: { paths: string[] };
        entries: Record<string, { enabled: boolean }>;
      };
    } = {
      plugins: {
        enabled: true,
        load: { paths: [fixtureRoot] },
        entries: { [pluginId]: { enabled: true } },
      },
    };
    const env = {
      ...process.env,
      OPENCLAW_HOME: path.join(fixtureRoot, "home"),
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
      OPENCLAW_BUNDLED_PLUGINS_DIR: undefined,
      VITEST: "true",
    };
    const context = {
      config,
      runtimeConfig: config,
      workspaceDir,
      agentDir,
      agentId: "main",
      messageChannel: "test",
      deliveryContext: { channel: "test", to: "user" },
      requesterSenderId: "sender",
      sandboxed: false,
    };

    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "descriptor-cache-fixture",
        version: "1.0.0",
        openclaw: { extensions: ["./index.cjs"] },
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(fixtureRoot, "openclaw.plugin.json"),
      JSON.stringify({
        id: pluginId,
        name: "Descriptor Cache Fixture",
        configSchema: { type: "object" },
        contracts: { tools: ["fixture_tool"] },
        toolMetadata: {
          fixture_tool: { authProviders: ["fixture-provider"] },
        },
      }),
      "utf8",
    );
    fs.writeFileSync(
      pluginSource,
      `const fs = require("node:fs");
const countFile = ${JSON.stringify(countFile)};
module.exports = {
  register(api) {
    api.registerTool(() => {
      const count = Number(fs.readFileSync(countFile, "utf8") || "0") + 1;
      fs.writeFileSync(countFile, String(count), "utf8");
      const instance = count;
      return {
        name: "fixture_tool",
        description: "Descriptor cache fixture tool",
        parameters: { type: "object", properties: {} },
        executionMode: "sequential",
        prepareArguments: (params) => ({ ...params, prepared: instance }),
        prepareBeforeToolCallParams: (params) => ({ ...params, beforeHook: instance }),
        finalizeBeforeToolCallParams: (params, prepared) => ({ ...params, prepared, finalized: instance }),
        risk: "write",
        writeRiskProfile: { kind: "declared_paths", writePaths: ["fixture.txt"] },
        execute: async () => ({ content: [] }),
      };
    }, { name: "fixture_tool" });
  },
};
`,
      "utf8",
    );
    fs.writeFileSync(countFile, "0", "utf8");

    try {
      const resolve = (
        options: {
          toolAllowlist?: string[];
          toolDenylist?: string[];
          hasAuthForProvider?: (providerId: string) => boolean;
        } = {},
      ) =>
        resolvePluginTools({
          context,
          env,
          toolAllowlist: options.toolAllowlist,
          toolDenylist: options.toolDenylist,
          hasAuthForProvider: options.hasAuthForProvider,
        });

      expect(resolve({ hasAuthForProvider: () => false })).toEqual([]);
      expect(fs.readFileSync(countFile, "utf8")).toBe("0");

      const coldTools = resolve({
        toolAllowlist: ["fixture_tool"],
        hasAuthForProvider: (providerId) => providerId === "fixture-provider",
      });
      expect(coldTools.map((tool) => tool.name)).toEqual(["fixture_tool"]);
      expect(fs.readFileSync(countFile, "utf8")).toBe("1");

      const warmTools = resolve({
        toolAllowlist: ["fixture_tool"],
        hasAuthForProvider: (providerId) => providerId === "fixture-provider",
      });
      expect(warmTools.map((tool) => tool.name)).toEqual(["fixture_tool"]);
      expect(fs.readFileSync(countFile, "utf8")).toBe("1");
      expect(warmTools[0]?.executionMode).toBe("sequential");
      // Dynamic callbacks resolve the current runtime tool only when called;
      // constructing the warm tool list itself remains factory-free.
      expect(warmTools[0]?.prepareArguments?.({ raw: true })).toEqual({
        raw: true,
        prepared: 2,
      });
      expect(warmTools[0]?.prepareBeforeToolCallParams?.({ raw: true }, {})).toEqual({
        raw: true,
        beforeHook: 2,
      });
      expect(warmTools[0]?.finalizeBeforeToolCallParams?.({ raw: true }, "prepared")).toEqual({
        raw: true,
        prepared: "prepared",
        finalized: 2,
      });
      expect(warmTools[0]?.risk).toBe("write");
      expect(warmTools[0]?.writeRiskProfile).toEqual({
        kind: "declared_paths",
        writePaths: ["fixture.txt"],
      });
      expect(fs.readFileSync(countFile, "utf8")).toBe("2");

      await expect(warmTools[0]?.execute("call-1", {})).resolves.toEqual({ content: [] });
      // The callbacks and execution share one runtime instance for a registry generation.
      expect(fs.readFileSync(countFile, "utf8")).toBe("2");

      // Do not clear the descriptor cache here. A replacement registry changes
      // its generation, so the next resolution must not reuse the old descriptor.
      setActivePluginRegistry(createEmptyPluginRegistry());
      // The old cached tool must also resolve a current factory instance rather
      // than retaining the callback closure captured before registry replacement.
      expect(warmTools[0]?.prepareArguments?.({ afterReplacement: true })).toEqual({
        afterReplacement: true,
        prepared: 3,
      });
      expect(fs.readFileSync(countFile, "utf8")).toBe("3");
      const afterRegistryReplacementTools = resolve({
        toolAllowlist: ["fixture_tool"],
        hasAuthForProvider: (providerId) => providerId === "fixture-provider",
      });
      expect(afterRegistryReplacementTools.map((tool) => tool.name)).toEqual(["fixture_tool"]);
      expect(fs.readFileSync(countFile, "utf8")).toBe("4");

      expect(
        resolve({
          toolAllowlist: ["fixture_tool"],
          toolDenylist: ["fixture_tool"],
          hasAuthForProvider: () => true,
        }),
      ).toEqual([]);
      expect(fs.readFileSync(countFile, "utf8")).toBe("4");

      clearPluginLoaderCache();
      resetPluginRuntimeStateForTest();
      const reloadedTools = resolve({
        toolAllowlist: ["fixture_tool"],
        hasAuthForProvider: (providerId) => providerId === "fixture-provider",
      });
      expect(reloadedTools.map((tool) => tool.name)).toEqual(["fixture_tool"]);
      expect(fs.readFileSync(countFile, "utf8")).toBe("5");
    } finally {
      clearPluginLoaderCache();
      resetPluginRuntimeStateForTest();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
