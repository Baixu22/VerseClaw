import {
  hashCapabilityMetadata,
  type CapabilityDescriptor,
} from "./capability-descriptor.js";
import type { CapabilityShadowCatalogSnapshot } from "./shadow-catalog.js";
import {
  CapabilityLeaseVerificationError,
  type CapabilityLeaseHandle,
  type CapabilityLeaseFailureCode,
  type TrustedCapabilityCatalog,
} from "./trusted-catalog.js";

export const CAPABILITY_UNIFIED_RESOLVER_SCHEMA_VERSION =
  "capability-unified-resolver/v1" as const;

export type CapabilityResolverKind = "skill" | "tool" | "context";

export type CapabilityResolverToolFallbackHit = {
  capabilityId: string;
  toolId: string;
  name: string;
  description: string;
};

export type CapabilityResolverToolDescription = {
  capabilityId: string;
  schema: unknown;
  schemaHash: string;
};

export type CapabilityResolverToolFallback = {
  search(query: string, limit?: number): Promise<readonly CapabilityResolverToolFallbackHit[]>;
  describe(capabilityId: string): Promise<CapabilityResolverToolDescription>;
};

export type CapabilityResolverOwnerLoader = {
  load(descriptor: CapabilityDescriptor): Promise<unknown>;
};

export type CapabilityResolverInput = {
  /** Explicit opt-in. The default path is the existing owner behavior. */
  enabled?: boolean;
  catalog: CapabilityShadowCatalogSnapshot;
  toolFallback?: CapabilityResolverToolFallback;
  skillLoader?: CapabilityResolverOwnerLoader;
  contextLoader?: CapabilityResolverOwnerLoader;
  trustedCatalog?: TrustedCapabilityCatalog;
};

export type CapabilityResolverFailureCode =
  | "resolver-disabled"
  | "invalid-input"
  | "unknown-capability"
  | "owner-unavailable"
  | "schema-mismatch"
  | "unsupported-kind"
  | "lease-required"
  | "invalid-reflection"
  | CapabilityLeaseFailureCode;

export type CapabilityResolverFailure = {
  code: CapabilityResolverFailureCode;
  message: string;
};

export type CapabilityResolverResult<T> =
  | { ok: true; value: T; diagnostics?: string[] }
  | { ok: false; failure: CapabilityResolverFailure };

export type CapabilityResolverCategory = {
  category: string;
  triggerKeywords: string[];
  workflowNamespaceCount: number;
  capabilityCount: number;
  kinds: CapabilityResolverKind[];
};

export type CapabilityResolverDiscovery = {
  capabilities: CapabilityDescriptor[];
  fallbackUsed: boolean;
  resolverHash: string;
};

export type CapabilityResolverLoadedValue =
  | { kind: "skill"; descriptor: CapabilityDescriptor; content: unknown }
  | { kind: "tool"; descriptor: CapabilityDescriptor; schema: unknown; schemaHash: string }
  | { kind: "context"; descriptor: CapabilityDescriptor; content: unknown };

export type CapabilityResolverExecution = {
  descriptor: CapabilityDescriptor;
  result: unknown;
};

export type CapabilityResolverReflection = {
  capabilityId: string;
  status: "success" | "error";
  summary: string;
  reflectionHash: string;
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptor {
  return {
    ...descriptor,
    triggerKeywords: [...descriptor.triggerKeywords],
    source: { ...descriptor.source },
    ...(descriptor.dependsOn ? { dependsOn: [...descriptor.dependsOn] } : {}),
    ...(descriptor.permissions ? { permissions: [...descriptor.permissions] } : {}),
    ...(descriptor.executionTopologies ? { executionTopologies: [...descriptor.executionTopologies] } : {}),
  };
}

function normalizeTokens(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function scoreDescriptor(descriptor: CapabilityDescriptor, query: string): number {
  const queryTokens = normalizeTokens(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const fields: Array<[string, number]> = [
    [descriptor.title, 8],
    [descriptor.triggerKeywords.join(" "), 6],
    [descriptor.description, 3],
    [descriptor.workflowNamespace.replaceAll(".", " "), 2],
    [descriptor.category, 1],
    [descriptor.capabilityId, 1],
  ];
  return fields.reduce((score, [field, weight]) => {
    const tokens = new Set(normalizeTokens(field));
    return score + queryTokens.filter((token) => tokens.has(token)).length * weight;
  }, 0);
}

function aggregateKeywords(descriptors: readonly CapabilityDescriptor[]): string[] {
  return [...new Set(descriptors.flatMap((descriptor) => descriptor.triggerKeywords))].toSorted(compareStrings);
}

function buildCategories(descriptors: readonly CapabilityDescriptor[]): CapabilityResolverCategory[] {
  const groups = new Map<string, CapabilityDescriptor[]>();
  for (const descriptor of descriptors) {
    const group = groups.get(descriptor.category) ?? [];
    group.push(descriptor);
    groups.set(descriptor.category, group);
  }
  return [...groups.entries()]
    .map(([category, group]) => ({
      category,
      triggerKeywords: aggregateKeywords(group),
      workflowNamespaceCount: new Set(group.map((descriptor) => descriptor.workflowNamespace)).size,
      capabilityCount: group.length,
      kinds: [...new Set(group.map((descriptor) => descriptor.kind))].toSorted(compareStrings),
    }))
    .toSorted((left, right) => compareStrings(left.category, right.category));
}

function findDescriptor(
  descriptors: readonly CapabilityDescriptor[],
  capabilityId: string,
): CapabilityDescriptor | undefined {
  return descriptors.find((descriptor) => descriptor.capabilityId === capabilityId);
}

function disabledFailure(): CapabilityResolverResult<never> {
  return {
    ok: false,
    failure: {
      code: "resolver-disabled",
      message: "Capability Registry V3 unified resolver is disabled",
    },
  };
}

function invalidReflection(message: string): CapabilityResolverResult<never> {
  return { ok: false, failure: { code: "invalid-reflection", message } };
}

/**
 * Explicit opt-in facade for V3 discovery and owner delegation. It never
 * constructs a Tool Search catalog or a Skill/Context loader itself.
 */
export class CapabilityUnifiedResolver {
  constructor(private readonly input: CapabilityResolverInput) {}

  categories(): CapabilityResolverResult<CapabilityResolverCategory[]> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    return { ok: true, value: buildCategories(this.input.catalog.descriptors) };
  }

  async discover(params: {
    query: string;
    limit?: number;
    kind?: CapabilityResolverKind;
  }): Promise<CapabilityResolverResult<CapabilityResolverDiscovery>> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    if (typeof params.query !== "string") {
      return {
        ok: false,
        failure: { code: "invalid-input", message: "discover query must be a string" },
      };
    }
    if (
      params.limit !== undefined &&
      (!Number.isInteger(params.limit) || params.limit < 1)
    ) {
      return {
        ok: false,
        failure: { code: "invalid-input", message: "discover limit must be a positive integer" },
      };
    }
    const descriptors = this.input.catalog.descriptors
      .filter((descriptor) => !params.kind || descriptor.kind === params.kind)
      .map(cloneDescriptor);
    const fallbackHits =
      params.kind === "skill" || params.kind === "context"
        ? []
        : this.input.toolFallback
          ? await this.input.toolFallback.search(params.query, params.limit)
          : [];
    const fallbackRank = new Map(fallbackHits.map((hit, index) => [hit.capabilityId, fallbackHits.length - index]));
    const ranked = descriptors.toSorted((left, right) => {
      const rightFallback = fallbackRank.get(right.capabilityId) ?? 0;
      const leftFallback = fallbackRank.get(left.capabilityId) ?? 0;
      return (
        rightFallback - leftFallback ||
        scoreDescriptor(right, params.query) - scoreDescriptor(left, params.query) ||
        compareStrings(left.category, right.category) ||
        compareStrings(left.workflowNamespace, right.workflowNamespace) ||
        compareStrings(left.capabilityId, right.capabilityId)
      );
    });
    const limit = params.limit === undefined ? ranked.length : params.limit;
    const capabilities = ranked.slice(0, limit);
    return {
      ok: true,
      value: {
        capabilities,
        fallbackUsed: fallbackHits.length > 0,
        resolverHash: hashCapabilityMetadata({
          schemaVersion: CAPABILITY_UNIFIED_RESOLVER_SCHEMA_VERSION,
          query: params.query,
          capabilities,
          fallbackUsed: fallbackHits.length > 0,
        }),
      },
    };
  }

  describe(capabilityId: string): CapabilityResolverResult<CapabilityDescriptor> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const descriptor = findDescriptor(this.input.catalog.descriptors, capabilityId);
    return descriptor
      ? { ok: true, value: cloneDescriptor(descriptor) }
      : {
          ok: false,
          failure: { code: "unknown-capability", message: `unknown capability: ${capabilityId}` },
        };
  }

  async load(capabilityId: string): Promise<CapabilityResolverResult<CapabilityResolverLoadedValue>> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const descriptor = findDescriptor(this.input.catalog.descriptors, capabilityId);
    if (!descriptor) {
      return {
        ok: false,
        failure: { code: "unknown-capability", message: `unknown capability: ${capabilityId}` },
      };
    }
    if (descriptor.kind === "tool") {
      if (!this.input.toolFallback) {
        return {
          ok: false,
          failure: { code: "owner-unavailable", message: "Tool Search owner is unavailable" },
        };
      }
      const loaded = await this.input.toolFallback.describe(capabilityId);
      if (loaded.schemaHash !== descriptor.schemaHash) {
        return {
          ok: false,
          failure: { code: "schema-mismatch", message: "Tool Search schema hash mismatched descriptor" },
        };
      }
      return {
        ok: true,
        value: {
          kind: "tool",
          descriptor: cloneDescriptor(descriptor),
          schema: loaded.schema,
          schemaHash: loaded.schemaHash,
        },
      };
    }
    const loader = descriptor.kind === "skill" ? this.input.skillLoader : this.input.contextLoader;
    if (!loader) {
      return {
        ok: false,
        failure: {
          code: "owner-unavailable",
          message: `${descriptor.kind} owner loader is unavailable`,
        },
      };
    }
    const content = await loader.load(descriptor);
    return {
      ok: true,
      value:
        descriptor.kind === "skill"
          ? { kind: "skill", descriptor: cloneDescriptor(descriptor), content }
          : { kind: "context", descriptor: cloneDescriptor(descriptor), content },
    };
  }

  async execute(params: {
    capabilityId: string;
    lease: CapabilityLeaseHandle;
    sessionId: string;
    input: unknown;
    toolCallId?: string;
    signal?: AbortSignal;
    onUpdate?: import("../../agents/runtime/index.js").AgentToolUpdateCallback;
    requiredPermissions?: readonly string[];
    expectedExecutorRegistrationId?: string;
  }): Promise<CapabilityResolverResult<CapabilityResolverExecution>> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const descriptor = findDescriptor(this.input.catalog.descriptors, params.capabilityId);
    if (!descriptor) {
      return {
        ok: false,
        failure: { code: "unknown-capability", message: `unknown capability: ${params.capabilityId}` },
      };
    }
    if (descriptor.kind !== "tool") {
      return {
        ok: false,
        failure: { code: "unsupported-kind", message: "only Tool capabilities can execute" },
      };
    }
    if (!this.input.trustedCatalog) {
      return {
        ok: false,
        failure: { code: "lease-required", message: "a trusted catalog is required for execution" },
      };
    }
    const requiredPermissions = params.requiredPermissions ?? descriptor.permissions ?? [];
    try {
      const result = await this.input.trustedCatalog.invokeLease({
        verification: {
          handle: params.lease,
          sessionId: params.sessionId,
          capabilityId: descriptor.capabilityId,
          revision: descriptor.revision,
          manifestHash: descriptor.manifestHash,
          schemaHash: descriptor.schemaHash,
          requiredPermissions,
          ...(params.expectedExecutorRegistrationId
            ? { expectedExecutorRegistrationId: params.expectedExecutorRegistrationId }
            : {}),
        },
        input: params.input,
        context: {
          ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
          ...(params.signal ? { signal: params.signal } : {}),
          ...(params.onUpdate ? { onUpdate: params.onUpdate } : {}),
        },
      });
      return { ok: true, value: { descriptor: cloneDescriptor(descriptor), result } };
    } catch (error) {
      if (error instanceof CapabilityLeaseVerificationError) {
        return { ok: false, failure: error.failure };
      }
      throw error;
    }
  }

  reflect(params: {
    capabilityId: string;
    status: "success" | "error";
    summary: string;
  }): CapabilityResolverResult<CapabilityResolverReflection> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const descriptor = findDescriptor(this.input.catalog.descriptors, params.capabilityId);
    if (!descriptor) {
      return {
        ok: false,
        failure: { code: "unknown-capability", message: `unknown capability: ${params.capabilityId}` },
      };
    }
    if (typeof params.summary !== "string" || params.summary.trim().length === 0 || params.summary.length > 4_096) {
      return invalidReflection("reflection summary must be a bounded non-empty string");
    }
    const value = {
      capabilityId: descriptor.capabilityId,
      status: params.status,
      summary: params.summary.trim(),
    } as const;
    return {
      ok: true,
      value: { ...value, reflectionHash: hashCapabilityMetadata(value) },
    };
  }
}
