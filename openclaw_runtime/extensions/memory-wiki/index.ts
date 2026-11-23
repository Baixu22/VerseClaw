// Memory Wiki plugin entrypoint registers its OpenClaw integration.
import { relative } from "node:path";
import { getWatcherHub } from "openclaw/plugin-sdk/knowledge-retrieval";
import { definePluginEntry } from "./api.js";
import { registerWikiCli } from "./src/cli.js";
import { memoryWikiConfigSchema, resolveMemoryWikiConfig } from "./src/config.js";
import { createWikiCorpusSupplement } from "./src/corpus-supplement.js";
import { registerMemoryWikiGatewayMethods } from "./src/gateway.js";
import {
  configureMemoryWikiImportRunStateStore,
  createMemoryWikiImportRunStateStore,
} from "./src/import-runs-state.js";
import { createWikiPromptSectionBuilder } from "./src/prompt-section.js";
import { createMemoryWikiProjectionService } from "./src/retrieval-index.js";
import { createMemoryWikiEmbeddingService } from "./src/retrieval-embeddings.js";
import { createMemoryWikiVectorService } from "./src/retrieval/vector-service.js";
import { createMemoryWikiRerankService } from "./src/retrieval-rerank.js";
import { createMemoryWikiObservabilityService } from "./src/retrieval/observability-service.js";
import {
  configureMemoryWikiSourceSyncStateStore,
  createMemoryWikiSourceSyncStateStore,
} from "./src/source-sync-state.js";
import {
  createWikiApplyTool,
  createWikiGetTool,
  createWikiLintTool,
  createWikiSearchTool,
  createWikiStatusTool,
} from "./src/tool.js";

export default definePluginEntry({
  id: "memory-wiki",
  name: "Memory Wiki",
  description: "Persistent wiki compiler and Obsidian-friendly knowledge vault for OpenClaw.",
  configSchema: memoryWikiConfigSchema,
  register(api) {
    const config = resolveMemoryWikiConfig(api.pluginConfig);
    configureMemoryWikiSourceSyncStateStore(
      createMemoryWikiSourceSyncStateStore(api.runtime.state.openKeyedStore),
    );
    configureMemoryWikiImportRunStateStore(
      createMemoryWikiImportRunStateStore(api.runtime.state.openKeyedStore),
    );

    api.registerMemoryPromptSupplement(createWikiPromptSectionBuilder(config));
    api.registerMemoryCorpusSupplement(
      createWikiCorpusSupplement({ config, appConfig: api.config }),
    );
    const projection = createMemoryWikiProjectionService({
      config,
      appConfig: api.config,
      openKeyedStore: api.runtime.state.openKeyedStore,
      onError: (error) => api.logger.warn(`Knowledge projection unavailable: ${error.message}`),
    });
    api.registerService({
      id: "wiki-retrieval-projection",
      start: () => projection.start(),
      stop: () => projection.stop(),
    });
    const embedding = createMemoryWikiEmbeddingService({
      config,
      appConfig: api.config,
      openKeyedStore: api.runtime.state.openKeyedStore,
    });
    api.registerService({
      id: "wiki-retrieval-embedding",
      start: () => embedding.start(),
      stop: () => embedding.stop(),
    });
    const vector = createMemoryWikiVectorService({
      config,
      appConfig: api.config,
      projection,
      embedding,
      openKeyedStore: api.runtime.state.openKeyedStore,
    });
    const rerank = createMemoryWikiRerankService({
      config,
      appConfig: api.config,
      openKeyedStore: api.runtime.state.openKeyedStore,
    });
    api.registerService({
      id: "wiki-retrieval-rerank",
      start: () => rerank.start(),
      stop: () => rerank.close(),
    });
    api.registerService({
      id: "wiki-vector-projection",
      start: () => vector.start(),
      stop: () => vector.stop(),
    });
    const observability = createMemoryWikiObservabilityService({
      config,
      appConfig: api.config,
      projection,
      openKeyedStore: api.runtime.state.openKeyedStore,
    });
    let diagnosticsWatcher: { close(): void } | undefined;
    let diagnosticsMaintenance: ReturnType<typeof setInterval> | undefined;
    api.registerService({
      id: "wiki-retrieval-observability",
      start: async () => {
        await observability
          .pruneExpired()
          .catch((error) => api.logger.warn(`Retrieval retention unavailable: ${String(error)}`));
        diagnosticsMaintenance = setInterval(
          () => {
            void observability
              .pruneExpired()
              .catch((error) =>
                api.logger.warn(`Retrieval retention unavailable: ${String(error)}`),
              );
          },
          60 * 60 * 1000,
        );
        diagnosticsMaintenance.unref();
        diagnosticsWatcher = getWatcherHub().subscribeDirectory(
          config.vault.path,
          (_event, filename) => {
            const subject = filename
              ? relative(
                  config.vault.path,
                  filename.startsWith(config.vault.path)
                    ? filename
                    : `${config.vault.path}/${filename}`,
                ).replaceAll("\\", "/")
              : null;
            if (
              subject !== null &&
              !/^(entities|concepts|sources|syntheses|reports)\/.*\.md$/.test(subject)
            )
              return;
            void observability
              .invalidate(subject)
              .catch((error) =>
                api.logger.warn(`Retrieval receipt cleanup unavailable: ${String(error)}`),
              );
          },
          (error) => {
            api.logger.warn(`Retrieval receipt watcher unavailable: ${error.message}`);
            void observability.invalidate(null).catch(() => undefined);
          },
          { recursive: true, persistent: false },
        );
      },
      stop: async () => {
        if (diagnosticsMaintenance) clearInterval(diagnosticsMaintenance);
        diagnosticsMaintenance = undefined;
        diagnosticsWatcher?.close();
        diagnosticsWatcher = undefined;
        await observability.idle();
      },
    });
    registerMemoryWikiGatewayMethods({
      api,
      config,
      appConfig: api.config,
      projection,
      embedding,
      vector,
      rerank,
      observability,
    });
    api.registerTool(createWikiStatusTool(config, api.config), { name: "wiki_status" });
    api.registerTool(createWikiLintTool(config, api.config), { name: "wiki_lint" });
    if (config.tools.allowAgentApply) {
      api.registerTool(createWikiApplyTool(config, api.config), { name: "wiki_apply" });
    }
    api.registerTool(
      (ctx) =>
        createWikiSearchTool(config, api.config, {
          agentId: ctx.agentId,
          agentSessionKey: ctx.sessionKey,
          sandboxed: ctx.sandboxed,
        }),
      { name: "wiki_search" },
    );
    api.registerTool(
      (ctx) =>
        createWikiGetTool(config, api.config, {
          agentId: ctx.agentId,
          agentSessionKey: ctx.sessionKey,
          sandboxed: ctx.sandboxed,
        }),
      { name: "wiki_get" },
    );
    api.registerCli(
      ({ program }) => {
        registerWikiCli(program, config, api.config);
      },
      {
        descriptors: [
          {
            name: "wiki",
            description: "Inspect and initialize the memory wiki vault",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
