import type { AgentToolUpdateCallback } from "../../agents/runtime/index.js";
import {
  runToolSearchCodeMode,
  type ToolSearchCodeModeBridge,
  type ToolSearchCodeModeCallOptions,
  type ToolSearchCodeModeRunner,
  type ToolSearchConfig,
} from "../../agents/tool-search.js";
import { CapabilityResultPointerService } from "./result-pointer.js";
import { TrustedCapabilityCatalog } from "./trusted-catalog.js";
import {
  CapabilityToolExecutionService,
  type CapabilityToolExecutionResult,
} from "./tool-execution-v3.js";
import { CapabilityUnifiedResolver } from "./unified-resolver.js";

export type CapabilityCodeModeAdapterInput = {
  /** Explicit opt-in. Legacy Tool Search Code Mode remains the default path. */
  enabled?: boolean;
  resolver: CapabilityUnifiedResolver;
  trustedCatalog: TrustedCapabilityCatalog;
  resultPointers: CapabilityResultPointerService;
  sessionId: string;
  taskId?: string;
  grantedPermissions: readonly string[];
  leaseTtlMs: number;
  resultPointerTtlMs: number;
  toolSearchConfig: ToolSearchConfig;
  runner?: ToolSearchCodeModeRunner;
};

export type CapabilityCodeModeRunInput = {
  code: string;
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback;
  /** Test-only injection; production uses the existing Tool Search runner. */
  runner?: ToolSearchCodeModeRunner;
};

export type CapabilityCodeModeRunResult =
  | {
      ok: true;
      value: Awaited<ReturnType<ToolSearchCodeModeRunner>>;
    }
  | {
      ok: false;
      failure: {
        code: "code-mode-disabled" | "code-mode-failed";
        message: string;
      };
    };

export type CapabilityCodeModeCallResult = CapabilityToolExecutionResult;

class CapabilityCodeModeBridgeError extends Error {
  constructor(code: string) {
    super(`Capability Registry V3 Code Mode bridge failed: ${code}`);
    this.name = "CapabilityCodeModeBridgeError";
  }
}

function requireOk<T>(result: { ok: true; value: T } | { ok: false; failure: { code: string } }): T {
  if (!result.ok) {
    throw new CapabilityCodeModeBridgeError(result.failure.code);
  }
  return result.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CODE_MODE_PROVENANCE_MAX_DEPTH = 64;
const CODE_MODE_PROVENANCE_MAX_NODES = 10_000;

type CodeModeProvenanceBudget = { nodes: number };

/**
 * Closed Code Mode runner output boundary. An injected runner is untrusted:
 * the bridge registers the canonical JSON identity of every container it
 * hands out (search navigation metadata, the describe L3 projection, call
 * pointer metadata, and every nested container inside them). A runner final
 * value is accepted only when it is a non-empty, JSON-safe composition whose
 * containers are either those exact registered identities or new envelopes
 * whose every child is likewise accounted and which contain at least one
 * registered container. Bare primitives can never appear outside a
 * registered container, so a runner cannot rebuild an object from known
 * strings or fabricate values even when the strings it reuses are genuine
 * bridge metadata. Primitives, plain unprovenanced objects, cycles,
 * non-JSON values, and over-budget values fail closed. This replaces the
 * former leaf-fingerprint and blacklist-only checks as the primary
 * mechanism.
 */
type CodeModeProvenance = {
  /** Canonical JSON identities of every container the bridge issued this run. */
  containers: Set<string>;
  register(value: unknown): boolean;
};

function canonicalJson(
  value: unknown,
  depth: number,
  budget: CodeModeProvenanceBudget,
  seen: Set<object>,
): string | null {
  if (depth > CODE_MODE_PROVENANCE_MAX_DEPTH) return null;
  budget.nodes += 1;
  if (budget.nodes > CODE_MODE_PROVENANCE_MAX_NODES) return null;
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : null;
    case "object": {
      if (seen.has(value)) return null;
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          const parts: string[] = [];
          for (const entry of value) {
            const child = canonicalJson(entry, depth + 1, budget, seen);
            if (child === null) return null;
            parts.push(child);
          }
          return "[" + parts.join(",") + "]";
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const parts: string[] = [];
        for (const key of keys) {
          const child = canonicalJson(record[key], depth + 1, budget, seen);
          if (child === null) return null;
          parts.push(JSON.stringify(key) + ":" + child);
        }
        return "{" + parts.join(",") + "}";
      } finally {
        seen.delete(value);
      }
    }
    default:
      return null;
  }
}

function registerProvenanceContainers(
  value: unknown,
  containers: Set<string>,
  depth: number,
  budget: CodeModeProvenanceBudget,
  seen: Set<object>,
): boolean {
  if (depth > CODE_MODE_PROVENANCE_MAX_DEPTH) return false;
  budget.nodes += 1;
  if (budget.nodes > CODE_MODE_PROVENANCE_MAX_NODES) return false;
  if (typeof value !== "object" || value === null) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    // Snapshot the identity now: if the runner mutates the shared object
    // afterwards, the returned value no longer matches this canonical form
    // and can never pass the final accounting.
    const identity = canonicalJson(value, 0, { nodes: 0 }, new Set<object>());
    if (identity === null) return false;
    containers.add(identity);
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (!registerProvenanceContainers(entry, containers, depth + 1, budget, seen)) return false;
      }
      return true;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!registerProvenanceContainers(record[key], containers, depth + 1, budget, seen)) return false;
    }
    return true;
  } finally {
    seen.delete(value);
  }
}

function createCodeModeProvenance(): CodeModeProvenance {
  const containers = new Set<string>();
  return {
    containers,
    register(value) {
      return registerProvenanceContainers(value, containers, 0, { nodes: 0 }, new Set<object>());
    },
  };
}

type FinalValueAccounting = { allAccounted: boolean; hasRegistered: boolean };

function accountFinalValue(
  value: unknown,
  containers: Set<string>,
  depth: number,
  budget: CodeModeProvenanceBudget,
  seen: Set<object>,
): FinalValueAccounting {
  if (depth > CODE_MODE_PROVENANCE_MAX_DEPTH) return { allAccounted: false, hasRegistered: false };
  budget.nodes += 1;
  if (budget.nodes > CODE_MODE_PROVENANCE_MAX_NODES) return { allAccounted: false, hasRegistered: false };
  // Bare primitives are never provable: only whole bridge-issued containers
  // may appear, so known strings cannot be re-keyed into fabricated objects.
  if (typeof value !== "object" || value === null) return { allAccounted: false, hasRegistered: false };
  if (seen.has(value)) return { allAccounted: false, hasRegistered: false };
  const identity = canonicalJson(value, 0, { nodes: 0 }, new Set<object>());
  if (identity !== null && containers.has(identity)) return { allAccounted: true, hasRegistered: true };
  seen.add(value);
  try {
    const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    let allAccounted = true;
    let hasRegistered = false;
    for (const child of children) {
      const childAccounting = accountFinalValue(child, containers, depth + 1, budget, seen);
      allAccounted = allAccounted && childAccounting.allAccounted;
      hasRegistered = hasRegistered || childAccounting.hasRegistered;
    }
    return { allAccounted, hasRegistered };
  } finally {
    seen.delete(value);
  }
}

function validateFinalValue(value: unknown, provenance: CodeModeProvenance): boolean {
  const isArray = Array.isArray(value);
  if (!isArray && !isRecord(value)) return false;
  if (isArray ? value.length === 0 : Object.keys(value).length === 0) return false;
  const accounting = accountFinalValue(value, provenance.containers, 0, { nodes: 0 }, new Set<object>());
  return accounting.allAccounted && accounting.hasRegistered;
}

function containsRawExecutionShape(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsRawExecutionShape(entry, nextSeen));
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) =>
      ["raw", "rawResult", "rawTargetResult", "credentials", "content", "details"].includes(key),
    ) ||
    (keys.includes("tool") && keys.includes("result"))
  ) {
    return true;
  }
  return Object.values(record).some((entry) => containsRawExecutionShape(entry, nextSeen));
}

function validateRunnerResult(
  value: unknown,
  provenance: CodeModeProvenance,
): value is Awaited<ReturnType<ToolSearchCodeModeRunner>> {
  if (!isRecord(value) || Object.keys(value).some((key) => !["value", "logs"].includes(key))) {
    return false;
  }
  if (
    !Array.isArray(value.logs) ||
    value.logs.length > 128 ||
    value.logs.some((entry) => typeof entry !== "string" || entry.length > 2_000) ||
    containsRawExecutionShape(value.value) ||
    !validateFinalValue(value.value, provenance)
  ) {
    return false;
  }
  return true;
}

type CodeModeRunnerAudit = { operations: number };

/**
 * Explicit V3 bridge over the one existing Tool Search Code Mode sandbox.
 * It changes only bridge ownership; process isolation, timeout, abort, and
 * Tool Search's approval/schema path stay with the established runner.
 */
export class CapabilityCodeModeAdapter {
  constructor(private readonly input: CapabilityCodeModeAdapterInput) {}

  async run(params: CapabilityCodeModeRunInput): Promise<CapabilityCodeModeRunResult> {
    if (this.input.enabled !== true) {
      return {
        ok: false,
        failure: {
          code: "code-mode-disabled",
          message: "Capability Registry V3 Code Mode is disabled",
        },
      };
    }

    try {
      const injectedRunner = params.runner ?? this.input.runner;
      const runner = injectedRunner ?? runToolSearchCodeMode;
      const audit: CodeModeRunnerAudit = { operations: 0 };
      const provenance = createCodeModeProvenance();
      const value = await runner({
        code: params.code,
        config: this.input.toolSearchConfig,
        parentToolCallId: params.toolCallId,
        bridge: this.#createBridge(params.toolCallId, params.signal, params.onUpdate, audit, provenance),
        ...(params.signal ? { signal: params.signal } : {}),
        ...(params.onUpdate ? { onUpdate: params.onUpdate } : {}),
      });
      if (!validateRunnerResult(value, provenance) || (injectedRunner !== undefined && audit.operations === 0)) {
        throw new CapabilityCodeModeBridgeError("invalid-runner-result");
      }
      return { ok: true, value };
    } catch {
      // Bridge failure messages can originate in a target tool. Do not put
      // them into a model-visible Code Mode result where raw inputs/results
      // might be reflected.
      return {
        ok: false,
        failure: {
          code: "code-mode-failed",
          message: "Capability Registry V3 Code Mode execution failed",
        },
      };
    }
  }

  #createBridge(
    parentToolCallId: string,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback | undefined,
    audit: CodeModeRunnerAudit,
    provenance: CodeModeProvenance,
  ): ToolSearchCodeModeBridge {
    const callsByRequestId = new Map<string, Promise<unknown>>();
    // Every value handed to the runner is registered in provenance first. A
    // bridge value that cannot be registered is not controlled metadata, so
    // the bridge fails closed instead of handing the runner an unprovable
    // value it could later echo back.
    const register = (value: unknown): unknown => {
      if (!provenance.register(value)) {
        throw new CapabilityCodeModeBridgeError("invalid-bridge-value");
      }
      return value;
    };
    return {
      search: async (query, options) => {
        audit.operations += 1;
        const discovered = await this.input.resolver.discover({
          query,
          ...(options?.limit !== undefined ? { limit: options.limit } : {}),
          kind: "tool",
        });
        // bridge.search may only return V3 navigation metadata.
        return register(requireOk(discovered).capabilities);
      },
      describe: async (capabilityId) => {
        audit.operations += 1;
        const loaded = await this.input.resolver.load(capabilityId);
        // bridge.describe may only return the L3 descriptor/schema projection.
        return register(requireOk(loaded));
      },
      call: async (capabilityId, callInput, options) => {
        audit.operations += 1;
        const requestId = options?.requestId;
        if (requestId) {
          const existing = callsByRequestId.get(requestId);
          if (existing) {
            return register(await existing);
          }
        }
        const invocation = this.#callCapability({
          capabilityId,
          callInput,
          parentToolCallId,
          signal,
          onUpdate,
          options,
        });
        if (requestId) {
          callsByRequestId.set(requestId, invocation);
        }
        // bridge.call may only return Result Pointer metadata; the raw target
        // result stays behind the archive handle and never crosses the bridge.
        return register(await invocation);
      },
    };
  }

  async #callCapability(params: {
    capabilityId: string;
    callInput: unknown;
    parentToolCallId: string;
    signal?: AbortSignal;
    onUpdate?: AgentToolUpdateCallback;
    options?: ToolSearchCodeModeCallOptions;
  }): Promise<CapabilityCodeModeCallResult> {
    return await new CapabilityToolExecutionService({
      resolver: this.input.resolver,
      trustedCatalog: this.input.trustedCatalog,
      resultPointers: this.input.resultPointers,
      sessionId: this.input.sessionId,
      ...(this.input.taskId ? { taskId: this.input.taskId } : {}),
      grantedPermissions: this.input.grantedPermissions,
      leaseTtlMs: this.input.leaseTtlMs,
      resultPointerTtlMs: this.input.resultPointerTtlMs,
    }).execute({
      capabilityId: params.capabilityId,
      input: params.callInput,
      toolCallId: params.options?.parentToolCallId ?? params.parentToolCallId,
      signal: params.options?.signal ?? params.signal,
      onUpdate: params.options?.onUpdate ?? params.onUpdate,
    });
  }
}
