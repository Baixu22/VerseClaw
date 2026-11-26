import {
  createEndpointRerankProvider,
  type RerankProviderV1,
  type RetrievalSpendCall,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/config-runtime";
import {
  fetchWithSsrFGuard,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
} from "openclaw/plugin-sdk/ssrf-runtime";
import { digestOwnerReadContent } from "openclaw/plugin-sdk/memory-host-core";
import { RERANK_MODEL_MANIFEST } from "../../../../shared/knowledge/rerank.js";
import type { OpenClawConfig } from "../api.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { createMemoryWikiReadContext, type MemoryWikiReadIdentity } from "./owner-read.js";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
} from "openclaw/plugin-sdk/plugin-state-runtime";

type Selection = {
  mode: "local" | "remote";
  providerRef?: string;
  model?: string;
  endpoint?: string;
};
type Saved = {
  selection: Selection;
  identity: MemoryWikiReadIdentity;
  credentialEpoch: number;
  suspended: boolean;
};
const defaultModel = RERANK_MODEL_MANIFEST[0].model;

export function createMemoryWikiRerankService(options: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  openKeyedStore: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>;
}) {
  const key = digestOwnerReadContent(options.config.vault.path);
  const state = () =>
    options.openKeyedStore<Saved>({ namespace: "retrieval-rerank-selection", maxEntries: 16 });
  let saved: Saved | undefined;
  let lifecycle = new AbortController();
  let status: {
    mode: "disabled" | "local" | "remote";
    status: "disabled" | "ready" | "unavailable" | "cancelled";
    credentialEpoch: number;
  } = { mode: "disabled", status: "disabled", credentialEpoch: 0 };
  let serial: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>) => {
    const next = serial.then(run);
    serial = next.catch(() => undefined);
    return next;
  };
  const assertScope = (identity: MemoryWikiReadIdentity) => {
    if (
      !identity.workspaceId ||
      !identity.workspaceDir ||
      !identity.agentSessionKey ||
      !identity.sessionId
    )
      throw new Error("Rerank requires a trusted workspace and physical session");
    if (
      saved &&
      ["workspaceId", "workspaceDir", "agentSessionKey", "sessionId"].some(
        (field) =>
          identity[field as keyof MemoryWikiReadIdentity] !==
          saved!.identity[field as keyof MemoryWikiReadIdentity],
      )
    )
      throw new Error("Rerank selection belongs to a different workspace or session");
    if (
      createMemoryWikiReadContext({
        config: options.config,
        appConfig: options.appConfig,
        identity,
      }).sessionId !== identity.sessionId
    )
      throw new Error("Rerank physical session generation has changed");
  };
  const endpoint = (selection: Selection) => {
    const configured =
      selection.mode === "local"
        ? selection.endpoint
        : options.appConfig?.models?.providers?.[selection.providerRef || "siliconflow"]?.baseUrl;
    const value =
      configured ||
      (selection.mode === "local"
        ? "http://127.0.0.1:9931"
        : process.env.SILICONFLOW_BASE_URL?.trim() || "https://api.siliconflow.cn/v1");
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid rerank endpoint");
    if (selection.mode === "local" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname))
      throw new Error("Local rerank endpoints must use loopback");
    const base = url.toString().replace(/\/$/, "");
    return url.pathname.endsWith("/rerank") ? base : `${base}/rerank`;
  };
  async function activate(selection: Selection, identity: MemoryWikiReadIdentity) {
    assertScope(identity);
    const model = selection.model || defaultModel;
    if (!RERANK_MODEL_MANIFEST.some((entry) => entry.model === model))
      throw new Error("Rerank model is not in the model manifest");
    const providerRef =
      selection.mode === "local" ? "local:rerank" : selection.providerRef || "siliconflow";
    const normalized = { ...selection, providerRef, model };
    endpoint(normalized);
    if (selection.mode === "remote" && !identity.egressProviderRefs?.includes(providerRef))
      throw new Error("Rerank egress was not admitted by the owner");
    const configured = options.appConfig?.models?.providers?.[providerRef];
    if (selection.mode === "remote" && !configured && !process.env.SILICONFLOW_API_KEY)
      throw new Error("Remote rerank credential is not configured");
    if (selection.mode === "remote" && configured) {
      const secret = await resolveConfiguredSecretInputString({
        config: options.appConfig ?? {},
        env: process.env,
        value: configured.apiKey,
        path: `models.providers.${providerRef}.apiKey`,
      });
      if (configured.apiKey && !secret.value)
        throw new Error("Remote rerank credential is not configured");
    }
    lifecycle.abort(new Error("Rerank selection changed"));
    lifecycle = new AbortController();
    saved = {
      selection: normalized,
      identity: structuredClone(identity),
      credentialEpoch: (saved?.credentialEpoch ?? 0) + 1,
      suspended: false,
    };
    await state().register(key, saved);
    status = { mode: selection.mode, status: "ready", credentialEpoch: saved.credentialEpoch };
    return status;
  }
  return {
    async start() {
      await enqueue(async () => {
        const previous = await state().lookup(key);
        if (!previous) return;
        saved = previous;
        status = {
          mode: previous.selection.mode,
          status: previous.suspended ? "cancelled" : "ready",
          credentialEpoch: previous.credentialEpoch,
        };
      });
    },
    status(identity: MemoryWikiReadIdentity) {
      assertScope(identity);
      return {
        ...status,
        ...(saved
          ? {
              providerRef: saved.selection.providerRef,
              model: saved.selection.model,
              endpoint: endpoint(saved.selection),
            }
          : {}),
        models: RERANK_MODEL_MANIFEST,
      };
    },
    configure(selection: Selection, identity: MemoryWikiReadIdentity) {
      return enqueue(() => activate(selection, identity));
    },
    retry(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        const previous = saved ?? (await state().lookup(key));
        if (!previous) throw new Error("Rerank selection is not configured");
        return activate(previous.selection, {
          ...identity,
          egressProviderRefs: previous.identity.egressProviderRefs,
        });
      });
    },
    cancel(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        assertScope(identity);
        lifecycle.abort(new Error("Rerank provider cancelled"));
        if (saved) {
          saved = { ...saved, suspended: true };
          await state().register(key, saved);
        }
        status = {
          mode: status.mode,
          status: "cancelled",
          credentialEpoch: status.credentialEpoch,
        };
        return status;
      });
    },
    disable(identity: MemoryWikiReadIdentity) {
      return enqueue(async () => {
        assertScope(identity);
        lifecycle.abort(new Error("Rerank provider disabled"));
        await state().delete(key);
        saved = undefined;
        status = { mode: "disabled", status: "disabled", credentialEpoch: status.credentialEpoch };
        return status;
      });
    },
    async close() {
      await enqueue(async () => {
        lifecycle.abort(new Error("Rerank provider closed"));
        saved = undefined;
      });
    },
    async provider(
      identity: MemoryWikiReadIdentity,
      remoteSpend?: RetrievalSpendCall,
    ): Promise<RerankProviderV1> {
      assertScope(identity);
      if (!saved || saved.suspended) throw new Error("Rerank provider is not configured");
      const active = saved, lifecycleSignal = lifecycle.signal;
      const assertCurrent = () => {
        lifecycleSignal.throwIfAborted(); assertScope(identity);
        if (saved !== active || saved.suspended) throw new Error("Rerank provider selection changed");
      };
      status = {
        mode: saved.selection.mode,
        status: "ready",
        credentialEpoch: saved.credentialEpoch,
      };
      const selection = saved.selection;
      const providerRef = selection.providerRef || "local:rerank",
        model = selection.model || defaultModel;
      const url = endpoint(selection);
      const configured = options.appConfig?.models?.providers?.[providerRef];
      const secret =
        selection.mode === "remote"
          ? await resolveConfiguredSecretInputString({
              config: options.appConfig ?? {},
              env: process.env,
              value: configured?.apiKey,
              path: `models.providers.${providerRef}.apiKey`,
            })
          : undefined;
      const apiKey =
        selection.mode === "remote" && !configured
          ? process.env.SILICONFLOW_API_KEY
          : secret?.value;
      assertCurrent();
      return createEndpointRerankProvider({
        providerRef,
        model,
        endpoint: url,
        request: async (body, requestSignal) => {
          assertCurrent();
          const signal = AbortSignal.any([requestSignal, lifecycleSignal]);
          const dispatch = async (reportInputTokens?: (tokens: unknown) => void) => {
            signal.throwIfAborted();
            assertCurrent();
            const { response, release } = await fetchWithSsrFGuard({
              url,
              signal,
              init: {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
                body: JSON.stringify(body),
              },
              policy:
                selection.mode === "local"
                  ? { allowPrivateNetwork: true, hostnameAllowlist: [new URL(url).hostname] }
                  : ssrfPolicyFromHttpBaseUrlAllowedHostname(url),
              auditContext: "project-rag:rerank",
            });
            try {
              if (!response.ok) throw new Error(`Rerank endpoint failed: HTTP ${response.status}`);
              const result = (await response.json()) as {
                results: Array<{ index: number; relevance_score: number }>;
                tokens?: { input_tokens?: number };
                meta?: {
                  tokens?: { input_tokens?: number };
                  billed_units?: { input_tokens?: number };
                };
              };
              reportInputTokens?.(
                result.meta?.billed_units?.input_tokens ??
                  result.tokens?.input_tokens ??
                  result.meta?.tokens?.input_tokens,
              );
              assertCurrent();
              return result;
            } finally {
              await release();
            }
          };
          return selection.mode === "remote" && remoteSpend
            ? remoteSpend(
                {
                  providerRef,
                  model,
                  texts: body.documents.map((text) => body.query + "\n" + text),
                  signal,
                },
                dispatch,
              )
            : dispatch();
        },
      });
    },
  };
}
export type MemoryWikiRerankService = ReturnType<typeof createMemoryWikiRerankService>;
