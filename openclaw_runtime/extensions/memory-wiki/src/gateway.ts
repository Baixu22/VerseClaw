// Memory Wiki plugin module implements gateway behavior.
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { normalizeSourceRefV2, resolveDefaultAgentId } from "openclaw/plugin-sdk/memory-host-core";
import { readPositiveIntegerParam } from "openclaw/plugin-sdk/param-readers";
import type { OpenClawConfig, OpenClawPluginApi } from "../api.js";
import { applyMemoryWikiMutation, normalizeMemoryWikiMutationInput } from "./apply.js";
import { compileMemoryWikiVault } from "./compile.js";
import {
  WIKI_SEARCH_BACKENDS,
  WIKI_SEARCH_CORPORA,
  type ResolvedMemoryWikiConfig,
} from "./config.js";
import { listMemoryWikiImportInsights } from "./import-insights.js";
import { listMemoryWikiImportRuns } from "./import-runs.js";
import { ingestMemoryWikiSource } from "./ingest.js";
import { lintMemoryWikiVault } from "./lint.js";
import { listMemoryWikiPalace } from "./memory-palace.js";
import {
  probeObsidianCli,
  runObsidianCommand,
  runObsidianDaily,
  runObsidianOpen,
  runObsidianSearch,
} from "./obsidian.js";
import { getMemoryWikiPage, searchMemoryWiki, WIKI_SEARCH_MODES } from "./query.js";
import { syncMemoryWikiImportedSources } from "./source-sync.js";
import { buildMemoryWikiDoctorReport, resolveMemoryWikiStatus } from "./status.js";
import { initializeMemoryWikiVault } from "./vault.js";
import type { MemoryWikiReadIdentity } from "./owner-read.js";
import type { MemoryWikiProjectionService } from "./retrieval-index.js";
import type { MemoryWikiEmbeddingService } from "./retrieval-embeddings.js";
import type { MemoryWikiVectorService } from "./retrieval/vector-service.js";
import { retrieveMemoryWiki } from "./retrieval/plan-service.js";

const READ_SCOPE = "operator.read" as const;
const WRITE_SCOPE = "operator.write" as const;
const ADMIN_SCOPE = "operator.admin" as const;
const LOCAL_FILE_INGEST_SCOPE = ADMIN_SCOPE;
type GatewayMethodContext = Parameters<
  Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1]
>[0];
type GatewayRespond = GatewayMethodContext["respond"];

function readIdentity(
  request: Record<string, unknown>,
  client: GatewayMethodContext["client"],
): MemoryWikiReadIdentity | undefined {
  if (request.readIdentity === undefined) return undefined;
  if (client?.connect?.client?.mode !== "backend")
    throw new Error("Knowledge read identity is backend-owned.");
  const value = request.readIdentity;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid knowledge read identity.");
  const facts = value as Record<string, unknown>;
  const providerRefs =
    Array.isArray(facts.egressProviderRefs) &&
    facts.egressProviderRefs.every((entry) => typeof entry === "string" && entry.trim())
      ? (facts.egressProviderRefs as string[])
      : [];
  return {
    agentSessionKey: readStringParam(facts, "agentSessionKey"),
    sessionId: readStringParam(facts, "sessionId"),
    workspaceId: readStringParam(facts, "workspaceId"),
    workspaceDir: readStringParam(facts, "workspaceDir"),
    egressProviderRefs: providerRefs,
  };
}

function readStringParam(params: Record<string, unknown>, key: string): string | undefined;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: { required: true },
): string;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: { required?: boolean },
): string | undefined {
  const value = params[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (options?.required) {
    throw new Error(`${key} is required.`);
  }
  return undefined;
}

function readEnumParam<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = readStringParam(params, key);
  if (!value) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${key} must be one of: ${allowed.join(", ")}.`);
}

function respondError(respond: GatewayRespond, error: unknown) {
  const message = formatErrorMessage(error);
  respond(false, undefined, { code: "internal_error", message });
}

function resolveGatewayAgentId(
  requestParams: Record<string, unknown>,
  appConfig: OpenClawConfig | undefined,
): string | undefined {
  return (
    readStringParam(requestParams, "agentId") ??
    (appConfig ? resolveDefaultAgentId(appConfig) : undefined)
  );
}

async function syncImportedSourcesIfNeeded(
  config: ResolvedMemoryWikiConfig,
  appConfig?: OpenClawConfig,
) {
  await syncMemoryWikiImportedSources({ config, appConfig });
}

export function registerMemoryWikiGatewayMethods(params: {
  api: OpenClawPluginApi;
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  projection?: MemoryWikiProjectionService;
  embedding?: MemoryWikiEmbeddingService;
  vector?: MemoryWikiVectorService;
}) {
  const { api, config, appConfig } = params;
  api.registerGatewayMethod(
    "wiki.retrieve",
    async ({ params: request, respond, client }) => {
      try {
        const identity = readIdentity(request, client);
        if (!identity) throw new Error("Retrieval requires a backend-owned identity");
        if (typeof request.query !== "string") throw new Error("Retrieval query must be a string");
        for (const key of ["profile", "mode"] as const) {
          if (request[key] !== undefined && (typeof request[key] !== "string" || !request[key]))
            throw new Error(`Invalid retrieval ${key}`);
        }
        const refs = Array.isArray(request.sourceRefs)
          ? request.sourceRefs.map(normalizeSourceRefV2)
          : [];
        if (
          request.sourceRefs !== undefined &&
          (!Array.isArray(request.sourceRefs) || refs.some((ref) => !ref))
        )
          throw new Error("Invalid retrieval source pins");
        if (
          request.deadlineAtMs !== undefined &&
          (typeof request.deadlineAtMs !== "number" || !Number.isFinite(request.deadlineAtMs))
        )
          throw new Error("Invalid retrieval deadline");
        respond(
          true,
          await retrieveMemoryWiki({
            config,
            appConfig,
            identity,
            query: readStringParam(request, "query") ?? "",
            profile: readEnumParam(request, "profile", ["local", "quality", "research"] as const),
            mode: readEnumParam(request, "mode", [
              "off",
              "manual",
              "suggest",
              "auto-read",
            ] as const),
            explicitRefs: refs.filter((ref) => ref !== undefined),
            deadlineAtMs: request.deadlineAtMs as number | undefined,
            requestId: readStringParam(request, "requestId"),
            projection: params.projection,
            embedding: params.embedding,
            vector: params.vector,
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );
  if (params.vector) {
    const vector = params.vector;
    for (const operation of [
      "start",
      "stop",
      "status",
      "idle",
      "rebuild",
      "optimize",
      "search",
    ] as const) {
      api.registerGatewayMethod(
        `wiki.vector.${operation}`,
        async ({ params: request, respond, client }) => {
          try {
            const identity = readIdentity(request, client);
            if (!identity) throw new Error("Vector operations require a backend-owned identity");
            let result: unknown;
            if (operation === "start") {
              const backend = readEnumParam(request, "backend", [
                "sqlite-flat",
                "lancedb-ann",
              ] as const);
              if (!backend) throw new Error("Vector backend is required");
              await vector.enable(identity, backend);
              result = await vector.status(identity);
            } else if (operation === "search") {
              result = await vector.search(
                identity,
                readStringParam(request, "query", { required: true }),
                readPositiveIntegerParam(request, "limit"),
              );
            } else if (operation === "status") result = await vector.status(identity);
            else {
              if (operation === "stop") await vector.disable(identity);
              else await vector[operation](identity);
              result = await vector.status(identity);
            }
            respond(true, result);
          } catch (error) {
            respondError(respond, error);
          }
        },
        { scope: ["status", "search"].includes(operation) ? READ_SCOPE : WRITE_SCOPE },
      );
    }
  }

  if (params.embedding) {
    const embedding = params.embedding;
    for (const operation of [
      "status",
      "configure",
      "retry",
      "cancel",
      "disable",
      "embed",
    ] as const) {
      api.registerGatewayMethod(
        `wiki.embedding.${operation}`,
        async ({ params: request, respond, client }) => {
          try {
            const identity = readIdentity(request, client);
            if (!identity)
              throw new Error("Embedding operations require a backend-owned read identity");
            let result: unknown;
            if (operation === "configure") {
              const mode = readEnumParam(request, "mode", ["local", "remote"] as const);
              if (!mode) throw new Error("Embedding mode is required");
              result = await embedding.configure(
                {
                  mode,
                  providerRef: readStringParam(request, "providerRef"),
                  model: readStringParam(request, "model"),
                },
                identity,
              );
            } else if (operation === "embed") {
              if (
                request.deadlineAt !== undefined &&
                (typeof request.deadlineAt !== "number" || !Number.isFinite(request.deadlineAt))
              ) {
                throw new Error("Invalid embedding deadline");
              }
              const deadlineAt =
                typeof request.deadlineAt === "number" ? request.deadlineAt : undefined;
              const kind = readEnumParam(request, "kind", ["query", "document"] as const);
              if (kind === "query") {
                result = await embedding.embed(identity, {
                  kind,
                  text: readStringParam(request, "text", { required: true }),
                  expectedSpaceId: readStringParam(request, "expectedSpaceId"),
                  deadlineAt,
                });
              } else if (kind === "document" && Array.isArray(request.sources)) {
                const sources = request.sources.map(normalizeSourceRefV2);
                if (sources.some((source) => !source))
                  throw new Error("Invalid embedding source pins");
                result = await embedding.embed(identity, {
                  kind,
                  sources: sources.filter((source) => source !== undefined),
                  expectedSpaceId: readStringParam(request, "expectedSpaceId"),
                  deadlineAt,
                });
              } else throw new Error("Embedding inputs are required");
            } else {
              result = await embedding[operation](identity);
            }
            respond(true, result);
          } catch (error) {
            respondError(respond, error);
          }
        },
        { scope: operation === "status" ? READ_SCOPE : WRITE_SCOPE },
      );
    }
  }

  if (params.projection) {
    const projection = params.projection;
    const operations = [
      "start",
      "stop",
      "status",
      "reconcile",
      "rebuild",
      "idle",
      "search",
    ] as const;
    for (const operation of operations) {
      api.registerGatewayMethod(
        `wiki.index.${operation}`,
        async ({ params: request, respond, client }) => {
          try {
            const identity = readIdentity(request, client);
            if (!identity)
              throw new Error("Projection operations require a backend-owned read identity");
            const result =
              operation === "start"
                ? await projection.enable(identity)
                : operation === "stop"
                  ? await projection.disable(identity)
                  : operation === "status"
                    ? projection.status(identity)
                    : operation === "reconcile" || operation === "rebuild"
                      ? await projection.reconcile(identity, operation === "rebuild")
                      : operation === "idle"
                        ? await projection.idle(identity)
                        : await projection.search(
                            identity,
                            readStringParam(request, "query", { required: true }),
                            readPositiveIntegerParam(request, "limit"),
                          );
            respond(true, result);
          } catch (error) {
            respondError(respond, error);
          }
        },
        { scope: ["status", "search"].includes(operation) ? READ_SCOPE : WRITE_SCOPE },
      );
    }
  }

  api.registerGatewayMethod(
    "wiki.status",
    async ({ respond }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        respond(
          true,
          await resolveMemoryWikiStatus(config, {
            appConfig,
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.importRuns",
    async ({ params: requestParams, respond }) => {
      try {
        const limit = readPositiveIntegerParam(requestParams, "limit");
        respond(true, await listMemoryWikiImportRuns(config, limit !== undefined ? { limit } : {}));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.importInsights",
    async ({ respond }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        respond(true, await listMemoryWikiImportInsights(config));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.palace",
    async ({ respond }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        respond(true, await listMemoryWikiPalace(config));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.init",
    async ({ respond }) => {
      try {
        respond(true, await initializeMemoryWikiVault(config));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.doctor",
    async ({ respond }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        const status = await resolveMemoryWikiStatus(config, {
          appConfig,
        });
        respond(true, buildMemoryWikiDoctorReport(status));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.compile",
    async ({ respond }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        respond(true, await compileMemoryWikiVault(config));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.ingest",
    async ({ params: requestParams, respond }) => {
      try {
        const inputPath = readStringParam(requestParams, "inputPath", { required: true });
        const title = readStringParam(requestParams, "title");
        respond(
          true,
          await ingestMemoryWikiSource({
            config,
            inputPath,
            ...(title ? { title } : {}),
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: LOCAL_FILE_INGEST_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.lint",
    async ({ respond }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        respond(true, await lintMemoryWikiVault(config));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.bridge.import",
    async ({ respond }) => {
      try {
        respond(
          true,
          await syncMemoryWikiImportedSources({
            config: { ...config, vaultMode: "bridge" },
            appConfig,
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.unsafeLocal.import",
    async ({ respond }) => {
      try {
        respond(
          true,
          await syncMemoryWikiImportedSources({
            config: { ...config, vaultMode: "unsafe-local" },
            appConfig,
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.search",
    async ({ params: requestParams, respond, client }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        const query = readStringParam(requestParams, "query", { required: true });
        const maxResults = readPositiveIntegerParam(requestParams, "maxResults");
        const searchBackend = readEnumParam(requestParams, "backend", WIKI_SEARCH_BACKENDS);
        const searchCorpus = readEnumParam(requestParams, "corpus", WIKI_SEARCH_CORPORA);
        const mode = readEnumParam(requestParams, "mode", WIKI_SEARCH_MODES);
        const agentId = resolveGatewayAgentId(requestParams, appConfig);
        respond(
          true,
          await searchMemoryWiki({
            config,
            appConfig,
            ...(agentId ? { agentId } : {}),
            query,
            maxResults,
            searchBackend,
            searchCorpus,
            mode,
            readIdentity: readIdentity(requestParams, client),
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.apply",
    async ({ params: requestParams, respond }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        respond(
          true,
          await applyMemoryWikiMutation({
            config,
            mutation: normalizeMemoryWikiMutationInput(requestParams),
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  const wikiLifecycleMethods = [
    ["wiki.update", "update"],
    ["wiki.merge", "merge"],
    ["wiki.archive", "archive"],
    ["wiki.revoke", "revoke"],
    ["wiki.delete", "delete"],
    ["wiki.restore", "restore"],
  ] as const;
  for (const [method, op] of wikiLifecycleMethods) {
    api.registerGatewayMethod(
      method,
      async ({ params: requestParams, respond }) => {
        try {
          await syncImportedSourcesIfNeeded(config, appConfig);
          respond(
            true,
            await applyMemoryWikiMutation({
              config,
              mutation: normalizeMemoryWikiMutationInput({
                ...requestParams,
                op,
              }),
            }),
          );
        } catch (error) {
          respondError(respond, error);
        }
      },
      { scope: WRITE_SCOPE },
    );
  }

  api.registerGatewayMethod(
    "wiki.get",
    async ({ params: requestParams, respond, client }) => {
      try {
        await syncImportedSourcesIfNeeded(config, appConfig);
        const lookup = readStringParam(requestParams, "lookup", { required: true });
        const fromLine = readPositiveIntegerParam(requestParams, "fromLine");
        const lineCount = readPositiveIntegerParam(requestParams, "lineCount");
        const searchBackend = readEnumParam(requestParams, "backend", WIKI_SEARCH_BACKENDS);
        const searchCorpus = readEnumParam(requestParams, "corpus", WIKI_SEARCH_CORPORA);
        const agentId = resolveGatewayAgentId(requestParams, appConfig);
        const sourceRef = normalizeSourceRefV2(requestParams.sourceRef);
        if (requestParams.sourceRef !== undefined && !sourceRef)
          throw new Error("Invalid SourceRef/v2 pin.");
        respond(
          true,
          await getMemoryWikiPage({
            config,
            appConfig,
            ...(agentId ? { agentId } : {}),
            lookup,
            fromLine,
            lineCount,
            searchBackend,
            searchCorpus,
            sourceRef,
            readIdentity: readIdentity(requestParams, client),
          }),
        );
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.obsidian.status",
    async ({ respond }) => {
      try {
        respond(true, await probeObsidianCli());
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: READ_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.obsidian.search",
    async ({ params: requestParams, respond }) => {
      try {
        const query = readStringParam(requestParams, "query", { required: true });
        respond(true, await runObsidianSearch({ config, query }));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.obsidian.open",
    async ({ params: requestParams, respond }) => {
      try {
        const vaultPath = readStringParam(requestParams, "path", { required: true });
        respond(true, await runObsidianOpen({ config, vaultPath }));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.obsidian.command",
    async ({ params: requestParams, respond }) => {
      try {
        const id = readStringParam(requestParams, "id", { required: true });
        respond(true, await runObsidianCommand({ config, id }));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "wiki.obsidian.daily",
    async ({ respond }) => {
      try {
        respond(true, await runObsidianDaily({ config }));
      } catch (error) {
        respondError(respond, error);
      }
    },
    { scope: WRITE_SCOPE },
  );
}
