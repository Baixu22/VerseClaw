import { relative } from "node:path";
import {
  KnowledgeProjectionController,
  getWatcherHub,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import {
  type OpenKeyedStoreOptions,
  type PluginStateKeyedStore,
} from "openclaw/plugin-sdk/plugin-state-runtime";
import { digestOwnerReadContent, type SourceRefV2 } from "openclaw/plugin-sdk/memory-host-core";
import type { OpenClawConfig } from "../api.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import {
  createMemoryWikiReadContext,
  memoryWikiNamespaceId,
  type MemoryWikiReadIdentity,
} from "./owner-read.js";
import { getMemoryWikiPage, listMemoryWikiPagePaths } from "./query.js";
import { initializeMemoryWikiVault } from "./vault.js";

type IndexSelection = { enabled: boolean; identity: MemoryWikiReadIdentity; vault: string };
type IndexState = PluginStateKeyedStore<IndexSelection>;

/** One explicitly enabled source scope per vault. Startup restores only the saved scope. */
export function createMemoryWikiProjectionService(options: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  openKeyedStore: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>;
  onError: (error: Error) => void;
}) {
  const { config, appConfig } = options;
  const key = digestOwnerReadContent(config.vault.path);
  let selected: IndexSelection | undefined;
  let controller: KnowledgeProjectionController | undefined;
  let lastError: string | null = null;
  let serial: Promise<unknown> = Promise.resolve();
  const state = (): IndexState =>
    options.openKeyedStore<IndexSelection>({
      namespace: "retrieval-index-selection",
      maxEntries: 16,
    });
  const error = (value: Error) => {
    lastError = value.message;
    options.onError(value);
  };
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const job = serial.then(run);
    serial = job.catch(() => undefined);
    return job;
  };
  const context = (identity: MemoryWikiReadIdentity) =>
    createMemoryWikiReadContext({ config, appConfig, identity });
  const assertScope = (identity: MemoryWikiReadIdentity) => {
    if (
      !selected?.enabled ||
      ["workspaceId", "workspaceDir", "agentSessionKey", "sessionId"].some(
        (key) =>
          identity[key as keyof MemoryWikiReadIdentity] !==
          selected!.identity[key as keyof MemoryWikiReadIdentity],
      )
    )
      throw new Error("Projection scope is not enabled for this session/workspace");
  };

  const activate = async (selection: IndexSelection) => {
    await controller?.stop();
    controller = undefined;
    await initializeMemoryWikiVault(config);
    selected = selection;
    if (!selection.enabled) return;
    controller = new KnowledgeProjectionController({
      owner: {
        namespaceId: memoryWikiNamespaceId(config),
        list: () => listMemoryWikiPagePaths(config.vault.path),
        read: async (source: string | SourceRefV2) => {
          const lookup = typeof source === "string" ? source : source.subjectId;
          const page = await getMemoryWikiPage({
            config,
            appConfig,
            lookup,
            fromLine: 1,
            lineCount: Number.MAX_SAFE_INTEGER,
            ...(typeof source === "string" ? {} : { sourceRef: source }),
            readIdentity: selection.identity,
          });
          if (
            page?.ownerSnapshot &&
            page.ownerSnapshot.context.sessionId !== selection.identity.sessionId
          )
            return { status: "denied", reason: "session_generation_changed" };
          return !page || page.status === "denied" || !page.ownerSnapshot
            ? { status: "denied", reason: page?.reason ?? "not_found" }
            : { status: "admitted", snapshot: page.ownerSnapshot };
        },
        subscribe: (hint, onError) => {
          const handle = getWatcherHub().subscribeDirectory(
            config.vault.path,
            (_type, filename) => {
              if (!filename) {
                hint(null);
                return;
              }
              const subject = relative(
                config.vault.path,
                filename.startsWith(config.vault.path)
                  ? filename
                  : `${config.vault.path}/${filename}`,
              ).replaceAll("\\", "/");
              // Vault initialization can emit directory hints while an owner read runs.
              // Only page hints revoke immediately; the complete scan reconciles directories.
              if (/^(entities|concepts|sources|syntheses|reports)\/.*\.md$/.test(subject))
                hint(subject);
            },
            onError,
            { recursive: true, persistent: false },
          );
          return () => handle.close();
        },
      },
      onError: error,
    });
    await controller.start();
    lastError = null;
  };

  return {
    async start() {
      try {
        const restored = await state().lookup(key);
        if (restored?.enabled && restored.vault === config.vault.path)
          await enqueue(() => activate(restored));
      } catch (value) {
        error(value instanceof Error ? value : new Error(String(value)));
      }
    },
    async stop() {
      await enqueue(async () => {
        await controller?.stop();
        controller = undefined;
      });
    },
    enable(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        if (
          !identity.workspaceId ||
          !identity.agentSessionKey ||
          !identity.workspaceDir ||
          !identity.sessionId
        )
          throw new Error("Trusted workspace/session identity is required to enable an index");
        const selection: IndexSelection = {
          enabled: true,
          identity: structuredClone(identity),
          vault: config.vault.path,
        };
        await state().register(key, selection);
        await activate(selection);
        return controller!.status();
      });
    },
    disable(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        assertScope(identity);
        await state().register(key, { ...selected!, enabled: false });
        await controller?.stop();
        controller = undefined;
        selected = undefined;
        return { status: "stopped" as const };
      });
    },
    reconcile(identity: MemoryWikiReadIdentity, force = false) {
      return enqueue(async () => {
        assertScope(identity);
        await controller!.reconcile(force);
        return controller!.status();
      });
    },
    async idle(identity: MemoryWikiReadIdentity, timeoutMs?: number) {
      assertScope(identity);
      await controller!.idle(timeoutMs);
      return controller!.status();
    },
    status(identity: MemoryWikiReadIdentity) {
      if (!selected) return { status: lastError ? "unavailable" : "disabled", lastError };
      assertScope(identity);
      return controller?.status() ?? { status: "unavailable", lastError };
    },
    async search(identity: MemoryWikiReadIdentity, query: string, limit?: number) {
      assertScope(identity);
      return controller!.search(query, context(identity), limit);
    },
  };
}
export type MemoryWikiProjectionService = ReturnType<typeof createMemoryWikiProjectionService>;
