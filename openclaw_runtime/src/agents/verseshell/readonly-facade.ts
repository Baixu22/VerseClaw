import { createHash } from "node:crypto";
import path from "node:path";
import { Type } from "typebox";
import type { DiagnosticTraceContext } from "../../infra/diagnostic-trace-context.js";
import {
  jsonResult,
  ToolInputError,
  type AnyAgentTool,
} from "../tools/common.js";
import { resolveVerseShellFoundationRollout } from "../verseshell-foundation-flags.js";
import { CLAWX_VERSESHELL_FACADE } from "../../../../shared/verseshell/facade.js";
import {
  extractArtifactDescriptors,
  extractArtifactHandles,
} from "../../../../shared/verseshell/extraction.js";
import {
  decodeResultQueryRequest,
} from "../../../../shared/verseshell/validation.js";
import type {
  ArtifactOwnerLineage,
  JsonObject,
  Observation,
  ResultQueryMode,
} from "../../../../shared/verseshell/types.js";
import { normalizeAciObservation } from "./normalizer.js";
import { VerseShellAciClient } from "./aci-client.js";
import {
  createReadonlyVerseShellProcessConfig,
  getGovernedVerseShellManager,
} from "./governed-exec.js";
import { resolveVerseShellPolicyProfile, VERSESHELL_READONLY_FACADE_PROFILE_ID } from "./policy-profile.js";
import type { VerseShellProcessManager } from "./process-manager.js";

const MAX_FILE_WINDOW = 500;
const MAX_SEARCH_ITEMS = 200;
const MAX_SEARCH_CONTEXT_LINES = 20;
const MAX_QUERY_BYTES = 64 * 1024;
const MAX_QUERY_TOKENS = 4_000;
const MAX_QUERY_LINES = 500;
const MAX_QUERY_MATCHES = 200;
const RESULT_HANDLE = /^result:\/\/sha256\/[a-f0-9]{64}$/u;

type ReadonlyFacadeArgs = {
  cwd: string;
  agentId?: string;
  revision?: string;
  env?: NodeJS.ProcessEnv;
  manager?: VerseShellProcessManager;
  client?: VerseShellAciClient;
  cache?: ReadonlyFacadeCache;
  expectedOwner?: Partial<ArtifactOwnerLineage>;
  /** Host-owned parent trace; operation args never provide lineage. */
  trace?: DiagnosticTraceContext;
};

type ReadFileArgs = {
  path: string;
  cursor?: number;
  window?: number;
};

type SearchContentArgs = {
  query: string;
  glob?: string;
  context_lines?: number;
  max_items?: number;
};

type ResultQueryArgs = {
  handle: string;
  mode: ResultQueryMode;
  lines?: number;
  start_line?: number;
  end_line?: number;
  pattern?: string;
  max_matches?: number;
};

type CacheEntry = {
  observation: Observation;
  expiresAt: number;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalWorkspace(cwd: string): string {
  const value = cwd.trim();
  if (!value || value.includes("\0")) throw new ToolInputError("workspace is invalid");
  return path.resolve(value);
}

function workspaceIdentity(cwd: string): string {
  const workspace = canonicalWorkspace(cwd);
  const identity = process.platform === "win32" ? workspace.toLowerCase() : workspace;
  return `ws_sha256_${createHash("sha256").update(identity).digest("hex")}`;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError(`${label} is required`);
  }
  const result = value.trim();
  if (result.length > maxLength || result.includes("\0")) {
    throw new ToolInputError(`${label} exceeds the bounded input contract`);
  }
  return result;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ToolInputError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

/** Resolve a workspace-relative path without touching the filesystem. */
export function resolveReadonlyWorkspacePath(cwd: string, input: unknown): string {
  const workspace = canonicalWorkspace(cwd);
  const raw = boundedString(input, "path", 4_096);
  if (path.isAbsolute(raw)) throw new ToolInputError("path must be workspace-relative");
  const candidate = path.resolve(workspace, raw);
  const relative = path.relative(workspace, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ToolInputError("path escapes the workspace");
  }
  return relative.split(path.sep).join("/");
}

function resolveReadonlyGlob(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const glob = boundedString(value, "glob", 512);
  if (path.isAbsolute(glob) || glob.split(/[\\/]/u).includes("..")) {
    throw new ToolInputError("glob must remain workspace-relative");
  }
  return glob.replace(/\\/gu, "/");
}

export function buildReadonlyFacadeCacheKey(params: {
  workspace: string;
  revision: string;
  policyDigest: string;
  op: string;
  args: JsonObject;
}): string {
  return [
    "verseshell-readonly-v1",
    workspaceIdentity(params.workspace),
    boundedString(params.revision, "revision", 256),
    boundedString(params.policyDigest, "policyDigest", 256),
    params.op,
    canonicalJson(params.args),
  ].join("|");
}

export class ReadonlyFacadeCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs = 15_000,
    private readonly maxEntries = 64,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): Observation | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.observation;
  }

  set(key: string, observation: Observation): void {
    while (this.entries.size >= this.maxEntries) {
      const first = this.entries.keys().next().value;
      if (typeof first !== "string") break;
      this.entries.delete(first);
    }
    this.entries.set(key, { observation, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}

function assertExpectedOperation(observation: Observation, expectedOp: string): Observation {
  if (observation.op !== expectedOp) {
    throw new Error(`VerseShell facade response operation mismatch: ${observation.op}`);
  }
  // normalizeAciObservation re-validates artifact handles, stream bounds, and
  // the bounded observation envelope before it becomes tool output.
  normalizeAciObservation(observation);
  return observation;
}

function validateResultQueryArgs(args: ResultQueryArgs): JsonObject {
  if (!RESULT_HANDLE.test(args.handle)) throw new ToolInputError("handle is not a valid result artifact");
  const decoded = decodeResultQueryRequest(
    {
      handle: args.handle,
      mode: args.mode,
      ...(args.lines === undefined ? {} : { lines: args.lines }),
      ...(args.start_line === undefined ? {} : { start_line: args.start_line }),
      ...(args.end_line === undefined ? {} : { end_line: args.end_line }),
      ...(args.pattern === undefined ? {} : { pattern: args.pattern }),
      ...(args.max_matches === undefined ? {} : { max_matches: args.max_matches }),
    },
    {
      max_bytes: MAX_QUERY_BYTES,
      max_tokens: MAX_QUERY_TOKENS,
      max_lines: MAX_QUERY_LINES,
      max_matches: MAX_QUERY_MATCHES,
    },
  );
  return decoded as unknown as JsonObject;
}

function validateArtifactOwnership(
  observation: Observation,
  expectedOwner: Partial<ArtifactOwnerLineage>,
): void {
  extractArtifactHandles(observation);
  if (Array.isArray((observation.data as Record<string, unknown> | undefined)?.artifacts)) {
    extractArtifactDescriptors(observation, { expected_owner: expectedOwner });
  }
}

export class VerseShellReadonlyFacadeAdapter {
  private readonly workspace: string;
  private readonly revision: string;
  private readonly cache: ReadonlyFacadeCache;
  private readonly policyDigest = resolveVerseShellPolicyProfile(
    VERSESHELL_READONLY_FACADE_PROFILE_ID,
  ).digest;
  private clientPromise?: Promise<VerseShellAciClient>;

  constructor(private readonly options: ReadonlyFacadeArgs) {
    this.workspace = canonicalWorkspace(options.cwd);
    this.revision = boundedString(options.revision ?? "untracked", "revision", 256);
    this.cache = options.cache ?? new ReadonlyFacadeCache();
  }

  private traceId(): string | undefined {
    return this.options.trace?.traceId;
  }

  private client(): Promise<VerseShellAciClient> {
    if (this.options.client) return Promise.resolve(this.options.client);
    this.clientPromise ??= (async () => {
      const manager = getGovernedVerseShellManager(this.options.manager);
      const config = createReadonlyVerseShellProcessConfig({
        cwd: this.workspace,
        agentId: this.options.agentId,
        env: this.options.env,
      });
      return manager.getClient(config);
    })();
    return this.clientPromise;
  }

  async readFile(args: ReadFileArgs, signal?: AbortSignal): Promise<Observation> {
    const pathValue = resolveReadonlyWorkspacePath(this.workspace, args.path);
    const cursor = args.cursor === undefined
      ? undefined
      : boundedInteger(args.cursor, "cursor", 1, 1_000_000, 1);
    const window = boundedInteger(args.window, "window", 1, MAX_FILE_WINDOW, 40);
    const requestArgs: JsonObject = {
      path: pathValue,
      ...(cursor === undefined ? {} : { cursor }),
      window,
    };
    const key = buildReadonlyFacadeCacheKey({
      workspace: this.workspace,
      revision: this.revision,
      policyDigest: this.policyDigest,
      op: "file.view",
      args: requestArgs,
    });
    const cached = this.cache.get(key);
    if (cached) return cached;
    const observation = assertExpectedOperation(
      await (await this.client()).execute("file.view", requestArgs, {
        signal,
        retryable: true,
        effectful: false,
        traceId: this.traceId(),
      }),
      "file.view",
    );
    this.cache.set(key, observation);
    return observation;
  }

  async searchContent(args: SearchContentArgs, signal?: AbortSignal): Promise<Observation> {
    const query = boundedString(args.query, "query", 500);
    const glob = resolveReadonlyGlob(args.glob);
    const requestArgs: JsonObject = {
      query,
      ...(glob ? { glob } : {}),
      context_lines: boundedInteger(args.context_lines, "context_lines", 0, MAX_SEARCH_CONTEXT_LINES, 0),
      max_items: boundedInteger(args.max_items, "max_items", 1, MAX_SEARCH_ITEMS, 50),
    };
    const key = buildReadonlyFacadeCacheKey({
      workspace: this.workspace,
      revision: this.revision,
      policyDigest: this.policyDigest,
      op: "repo.search",
      args: requestArgs,
    });
    const cached = this.cache.get(key);
    if (cached) return cached;
    const observation = assertExpectedOperation(
      await (await this.client()).execute("repo.search", requestArgs, {
        signal,
        retryable: true,
        effectful: false,
        traceId: this.traceId(),
      }),
      "repo.search",
    );
    this.cache.set(key, observation);
    return observation;
  }

  async resultQuery(args: ResultQueryArgs, signal?: AbortSignal): Promise<Observation> {
    const requestArgs = validateResultQueryArgs(args);
    const observation = assertExpectedOperation(
      await (await this.client()).queryResult(args.handle, requestArgs, {
        signal,
        retryable: true,
        effectful: false,
        traceId: this.traceId(),
      }),
      "result.query",
    );
    validateArtifactOwnership(observation, this.options.expectedOwner ?? {
      workspace_id: workspaceIdentity(this.workspace),
    });
    return observation;
  }
}

const READ_FILE_SCHEMA = Type.Object({
  path: Type.String({ description: "Workspace-relative file path." }),
  cursor: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  window: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_FILE_WINDOW })),
}, { additionalProperties: false });

const SEARCH_CONTENT_SCHEMA = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500 }),
  glob: Type.Optional(Type.String({ maxLength: 512 })),
  contextLines: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_SEARCH_CONTEXT_LINES })),
  maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SEARCH_ITEMS })),
}, { additionalProperties: false });

const RESULT_QUERY_SCHEMA = Type.Object({
  handle: Type.String({ description: "result://sha256 artifact handle returned earlier." }),
  mode: Type.Union([
    Type.Literal("meta"),
    Type.Literal("head"),
    Type.Literal("tail"),
    Type.Literal("slice"),
    Type.Literal("grep"),
    Type.Literal("raw"),
  ]),
  lines: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_QUERY_LINES })),
  startLine: Type.Optional(Type.Integer({ minimum: 1 })),
  endLine: Type.Optional(Type.Integer({ minimum: 1 })),
  pattern: Type.Optional(Type.String({ maxLength: 500 })),
  maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_QUERY_MATCHES })),
}, { additionalProperties: false });

/** Materialize only the three P2 read-only facade tools when rollout is ready. */
export function createVerseShellReadonlyFacadeTools(options: {
  cwd: string;
  agentId?: string;
  revision?: string;
  config?: unknown;
  env?: NodeJS.ProcessEnv;
  manager?: VerseShellProcessManager;
  client?: VerseShellAciClient;
  cache?: ReadonlyFacadeCache;
  expectedOwner?: Partial<ArtifactOwnerLineage>;
  trace?: DiagnosticTraceContext;
}): AnyAgentTool[] | null {
  const rollout = resolveVerseShellFoundationRollout({ config: options.config });
  const required = ["verifiedRuntime", "typedAci", "facade", "governedExec", "artifactResults"] as const;
  if (rollout.killSwitch.engaged || required.some((flag) => !rollout.enabled[flag])) return null;

  const adapter = new VerseShellReadonlyFacadeAdapter(options);
  const readMeta = CLAWX_VERSESHELL_FACADE.find((entry) => entry.name === "read_file")!;
  const searchMeta = CLAWX_VERSESHELL_FACADE.find((entry) => entry.name === "search_content")!;
  const resultMeta = CLAWX_VERSESHELL_FACADE.find((entry) => entry.name === "result_query")!;
  return [
    {
      name: "read_file",
      label: "read_file",
      displaySummary: readMeta.when_to_use,
      description: `${readMeta.when_to_use} ${readMeta.when_not_to_use}`,
      parameters: READ_FILE_SCHEMA,
      risk: "readonly",
      execute: async (_toolCallId, raw, signal) => jsonResult(await adapter.readFile(raw as ReadFileArgs, signal)),
    },
    {
      name: "search_content",
      label: "search_content",
      displaySummary: searchMeta.when_to_use,
      description: `${searchMeta.when_to_use} ${searchMeta.when_not_to_use}`,
      parameters: SEARCH_CONTENT_SCHEMA,
      risk: "readonly",
      execute: async (_toolCallId, raw, signal) => {
        const input = raw as Record<string, unknown>;
        return jsonResult(await adapter.searchContent({
          query: input.query as string,
          glob: input.glob as string | undefined,
          context_lines: input.contextLines as number | undefined,
          max_items: input.maxItems as number | undefined,
        }, signal));
      },
    },
    {
      name: "result_query",
      label: "result_query",
      displaySummary: resultMeta.when_to_use,
      description: `${resultMeta.when_to_use} ${resultMeta.when_not_to_use}`,
      parameters: RESULT_QUERY_SCHEMA,
      risk: "readonly",
      execute: async (_toolCallId, raw, signal) => {
        const input = raw as Record<string, unknown>;
        return jsonResult(await adapter.resultQuery({
          handle: input.handle as string,
          mode: input.mode as ResultQueryMode,
          lines: input.lines as number | undefined,
          start_line: input.startLine as number | undefined,
          end_line: input.endLine as number | undefined,
          pattern: input.pattern as string | undefined,
          max_matches: input.maxMatches as number | undefined,
        }, signal));
      },
    },
  ] as AnyAgentTool[];
}
