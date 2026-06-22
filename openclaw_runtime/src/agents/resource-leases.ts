/**
 * In-process resource leases for agent tool concurrency.
 *
 * The manager is intentionally ephemeral: it coordinates concurrent work in a
 * single runtime process and does not persist queue state.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type ResourceLeaseKind =
  | "workspaceWriter"
  | "workspaceSearch"
  | "workspaceExec"
  | "subtreeMutation"
  | "fileMutation";

export type ResourceLeaseMode = "semaphore" | "path";

export type ResourceLeaseResource = {
  kind: ResourceLeaseKind;
  key: string;
  capacity?: number;
  mode?: ResourceLeaseMode;
};

export type ResourceLease = {
  id: number;
  resources: readonly ResourceLeaseResource[];
  leaseKind: ResourceLeaseKind;
  leaseKey: string;
  queuedMs: number;
  release: () => void;
};

export type ResourceLeaseDetails = {
  queuedMs: number;
  leaseKind: ResourceLeaseKind;
  leaseKey: string;
};

type ResourceLeaseLogger = {
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type ResourceLeaseManagerOptions = {
  capacities?: Partial<Record<ResourceLeaseKind, number>>;
  acquireTimeoutMs?: number;
  logger?: ResourceLeaseLogger | null;
};

type AcquireOptions = {
  resources: readonly ResourceLeaseResource[];
  timeoutMs?: number;
  signal?: AbortSignal;
};

type PendingRequest = {
  id: number;
  resources: readonly Required<ResourceLeaseResource>[];
  requestedAt: number;
  timeoutMs: number;
  resolve: (lease: ResourceLease) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

type ActiveLease = {
  id: number;
  resources: readonly Required<ResourceLeaseResource>[];
  acquiredAt: number;
  queuedMs: number;
};

export class ResourceLeaseTimeoutError extends Error {
  readonly code = "RESOURCE_LEASE_TIMEOUT";
  readonly kind: ResourceLeaseKind;
  readonly key: string;
  readonly timeoutMs: number;

  constructor(params: { kind: ResourceLeaseKind; key: string; timeoutMs: number }) {
    super(
      `Timed out waiting for ${params.kind} lease (${params.key}) after ${params.timeoutMs}ms`,
    );
    this.name = "ResourceLeaseTimeoutError";
    this.kind = params.kind;
    this.key = params.key;
    this.timeoutMs = params.timeoutMs;
  }
}

const DEFAULT_RESOURCE_LEASE_CAPACITIES: Record<ResourceLeaseKind, number> = {
  workspaceWriter: 1,
  workspaceSearch: 2,
  workspaceExec: 2,
  subtreeMutation: 1,
  fileMutation: 1,
};

const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const PATH_LEASE_KINDS = new Set<ResourceLeaseKind>(["subtreeMutation", "fileMutation"]);

let nextLeaseId = 1;

function dedupeResources(
  resources: readonly Required<ResourceLeaseResource>[],
): Required<ResourceLeaseResource>[] {
  const seen = new Set<string>();
  const unique: Required<ResourceLeaseResource>[] = [];
  for (const resource of resources) {
    const id = `${resource.kind}:${resource.mode}:${resource.key}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(resource);
  }
  return unique;
}

function stableResourceSort(
  resources: readonly Required<ResourceLeaseResource>[],
): Required<ResourceLeaseResource>[] {
  return [...resources].sort((a, b) => {
    const kindCompare = a.kind.localeCompare(b.kind);
    if (kindCompare !== 0) {
      return kindCompare;
    }
    return a.key.localeCompare(b.key);
  });
}

function normalizeResource(
  resource: ResourceLeaseResource,
  capacities: Record<ResourceLeaseKind, number>,
): Required<ResourceLeaseResource> {
  return {
    kind: resource.kind,
    key: resource.key,
    capacity: resource.capacity ?? capacities[resource.kind] ?? 1,
    mode: resource.mode ?? (PATH_LEASE_KINDS.has(resource.kind) ? "path" : "semaphore"),
  };
}

function isSameOrDescendantPath(pathKey: string, maybeAncestor: string): boolean {
  if (pathKey === maybeAncestor) {
    return true;
  }
  if (maybeAncestor === "/" || maybeAncestor.endsWith(":/")) {
    return pathKey.startsWith(maybeAncestor);
  }
  return pathKey.startsWith(`${maybeAncestor}/`);
}

function pathResourcesConflict(
  requested: Required<ResourceLeaseResource>,
  active: Required<ResourceLeaseResource>,
): boolean {
  if (requested.kind === "fileMutation" && active.kind === "fileMutation") {
    return requested.key === active.key;
  }
  return (
    isSameOrDescendantPath(requested.key, active.key) ||
    isSameOrDescendantPath(active.key, requested.key)
  );
}

function resourcesConflict(
  requested: Required<ResourceLeaseResource>,
  active: Required<ResourceLeaseResource>,
): boolean {
  if (requested.mode === "path" && active.mode === "path") {
    return pathResourcesConflict(requested, active);
  }
  return requested.kind === active.kind && requested.key === active.key;
}

function summarizeLease(resources: readonly Required<ResourceLeaseResource>[]): {
  leaseKind: ResourceLeaseKind;
  leaseKey: string;
} {
  const primary =
    resources.find((resource) => resource.kind === "subtreeMutation") ??
    resources.find((resource) => resource.kind === "fileMutation") ??
    resources[0];
  if (!primary) {
    throw new Error("Resource lease requires at least one resource");
  }
  return {
    leaseKind: primary.kind,
    leaseKey: primary.key,
  };
}

export class ResourceLeaseManager {
  private readonly capacities: Record<ResourceLeaseKind, number>;
  private readonly acquireTimeoutMs: number;
  private readonly logger: ResourceLeaseLogger | null;
  private readonly active: ActiveLease[] = [];
  private readonly pending: PendingRequest[] = [];

  constructor(options: ResourceLeaseManagerOptions = {}) {
    this.capacities = {
      ...DEFAULT_RESOURCE_LEASE_CAPACITIES,
      ...options.capacities,
    };
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    this.logger = options.logger ?? null;
  }

  acquire(options: AcquireOptions): Promise<ResourceLease> {
    const resources = stableResourceSort(
      dedupeResources(options.resources.map((resource) => normalizeResource(resource, this.capacities))),
    );
    if (resources.length === 0) {
      return Promise.reject(new Error("Resource lease requires at least one resource"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new Error("Operation aborted"));
    }

    const id = nextLeaseId++;
    const requestedAt = Date.now();
    const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? this.acquireTimeoutMs));
    return new Promise<ResourceLease>((resolve, reject) => {
      const request: PendingRequest = {
        id,
        resources,
        requestedAt,
        timeoutMs,
        resolve,
        reject,
        timer: null,
        signal: options.signal,
      };

      request.timer = setTimeout(() => {
        this.timeoutRequest(request);
      }, timeoutMs);

      if (options.signal) {
        request.abortHandler = () => {
          this.rejectRequest(request, new Error("Operation aborted"));
        };
        options.signal.addEventListener("abort", request.abortHandler, { once: true });
      }

      this.pending.push(request);
      this.drain();
    });
  }

  async withLease<T>(
    options: AcquireOptions,
    fn: (lease: ResourceLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(options);
    try {
      return await fn(lease);
    } finally {
      lease.release();
    }
  }

  snapshot(): { active: number; pending: number } {
    return {
      active: this.active.length,
      pending: this.pending.length,
    };
  }

  private drain(): void {
    for (const request of [...this.pending]) {
      if (!this.pending.includes(request)) {
        continue;
      }
      if (this.hasEarlierConflictingPending(request) || this.hasActiveConflict(request)) {
        continue;
      }
      this.grant(request);
    }
  }

  private hasEarlierConflictingPending(request: PendingRequest): boolean {
    for (const earlier of this.pending) {
      if (earlier === request) {
        return false;
      }
      if (this.requestsConflict(request, earlier)) {
        return true;
      }
    }
    return false;
  }

  private requestsConflict(first: PendingRequest, second: PendingRequest): boolean {
    return first.resources.some((requested) =>
      second.resources.some((active) => resourcesConflict(requested, active)),
    );
  }

  private hasActiveConflict(request: PendingRequest): boolean {
    for (const resource of request.resources) {
      const activeConflicts = this.active.filter((active) =>
        active.resources.some((activeResource) => resourcesConflict(resource, activeResource)),
      );
      if (resource.mode === "path") {
        if (activeConflicts.length > 0) {
          return true;
        }
        continue;
      }
      if (activeConflicts.length >= resource.capacity) {
        return true;
      }
    }
    return false;
  }

  private grant(request: PendingRequest): void {
    this.removePending(request);
    const queuedMs = Date.now() - request.requestedAt;
    const active: ActiveLease = {
      id: request.id,
      resources: request.resources,
      acquiredAt: Date.now(),
      queuedMs,
    };
    this.active.push(active);
    const summary = summarizeLease(request.resources);
    this.logger?.info?.("resource lease acquired", {
      id: request.id,
      queuedMs,
      leaseKind: summary.leaseKind,
      leaseKey: summary.leaseKey,
      resources: request.resources.map((resource) => `${resource.kind}:${resource.key}`),
    });
    let released = false;
    request.resolve({
      id: request.id,
      resources: request.resources,
      queuedMs,
      ...summary,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.release(active);
      },
    });
  }

  private release(lease: ActiveLease): void {
    const index = this.active.indexOf(lease);
    if (index >= 0) {
      this.active.splice(index, 1);
    }
    const summary = summarizeLease(lease.resources);
    this.logger?.info?.("resource lease released", {
      id: lease.id,
      heldMs: Date.now() - lease.acquiredAt,
      queuedMs: lease.queuedMs,
      leaseKind: summary.leaseKind,
      leaseKey: summary.leaseKey,
    });
    this.drain();
  }

  private timeoutRequest(request: PendingRequest): void {
    const summary = summarizeLease(request.resources);
    this.logger?.warn?.("resource lease timeout", {
      id: request.id,
      timeoutMs: request.timeoutMs,
      waitMs: Date.now() - request.requestedAt,
      leaseKind: summary.leaseKind,
      leaseKey: summary.leaseKey,
    });
    this.rejectRequest(
      request,
      new ResourceLeaseTimeoutError({
        kind: summary.leaseKind,
        key: summary.leaseKey,
        timeoutMs: request.timeoutMs,
      }),
    );
  }

  private rejectRequest(request: PendingRequest, error: Error): void {
    if (!this.removePending(request)) {
      return;
    }
    request.reject(error);
    this.drain();
  }

  private removePending(request: PendingRequest): boolean {
    const index = this.pending.indexOf(request);
    if (index < 0) {
      return false;
    }
    this.pending.splice(index, 1);
    if (request.timer) {
      clearTimeout(request.timer);
      request.timer = null;
    }
    if (request.signal && request.abortHandler) {
      request.signal.removeEventListener("abort", request.abortHandler);
      request.abortHandler = undefined;
    }
    return true;
  }
}

type LeasePathPlatform = "win32" | NodeJS.Platform;

export type CanonicalLeasePathOptions = {
  platform?: LeasePathPlatform;
  realpath?: (absolutePath: string) => string;
};

function pathModuleFor(platform: LeasePathPlatform): typeof path.win32 | typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizeLeasePath(value: string, platform: LeasePathPlatform): string {
  const slashNormalized = value.replace(/\\/g, "/");
  const uncPrefix = slashNormalized.startsWith("//") ? "//" : "";
  const normalized =
    uncPrefix + slashNormalized.slice(uncPrefix.length).replace(/\/+/g, "/");
  const trimmed =
    normalized.length > 1 && normalized.endsWith("/") && !/^[a-zA-Z]:\/$/.test(normalized)
      ? normalized.replace(/\/+$/, "")
      : normalized;
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

export function canonicalizePathForLease(
  filePath: string,
  options: CanonicalLeasePathOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const pathModule = pathModuleFor(platform);
  const realpath = options.realpath ?? realpathSync.native;
  const resolved = pathModule.resolve(filePath);
  try {
    return normalizeLeasePath(realpath(resolved), platform);
  } catch {
    // Missing targets derive from the closest existing parent plus normalized
    // missing path segments so new-file writes get the same key consistently.
  }

  const missingSegments: string[] = [pathModule.basename(resolved)];
  let parent = pathModule.dirname(resolved);
  while (parent && parent !== pathModule.dirname(parent)) {
    try {
      const realParent = realpath(parent);
      return normalizeLeasePath(pathModule.join(realParent, ...missingSegments), platform);
    } catch {
      missingSegments.unshift(pathModule.basename(parent));
      parent = pathModule.dirname(parent);
    }
  }
  return normalizeLeasePath(resolved, platform);
}

export function leaseDetails(lease: ResourceLease): ResourceLeaseDetails {
  return {
    queuedMs: lease.queuedMs,
    leaseKind: lease.leaseKind,
    leaseKey: lease.leaseKey,
  };
}

const resourceLeaseLog = createSubsystemLogger("agent/resource-leases");

export const agentResourceLeases = new ResourceLeaseManager({
  logger: resourceLeaseLog,
});

export async function withWorkspaceSearchLease<T>(
  workspacePath: string,
  fn: (lease: ResourceLease) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const key = canonicalizePathForLease(workspacePath);
  return agentResourceLeases.withLease(
    {
      resources: [{ kind: "workspaceSearch", key }],
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    },
    fn,
  );
}

export async function withWorkspaceExecLease<T>(
  workspacePath: string,
  fn: (lease: ResourceLease) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const key = canonicalizePathForLease(workspacePath);
  return agentResourceLeases.withLease(
    {
      resources: [{ kind: "workspaceExec", key }],
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    },
    fn,
  );
}

export async function withFileMutationLease<T>(
  params: { filePath: string; workspacePath?: string; signal?: AbortSignal; timeoutMs?: number },
  fn: (lease: ResourceLease) => Promise<T>,
): Promise<T> {
  const fileKey = canonicalizePathForLease(params.filePath);
  const workspaceKey = canonicalizePathForLease(params.workspacePath ?? path.dirname(params.filePath));
  return agentResourceLeases.withLease(
    {
      resources: [
        { kind: "workspaceWriter", key: workspaceKey },
        { kind: "fileMutation", key: fileKey },
      ],
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    },
    fn,
  );
}

export async function withSubtreeMutationLease<T>(
  params: {
    paths: string | readonly string[];
    workspacePath?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
  fn: (lease: ResourceLease) => Promise<T>,
): Promise<T> {
  const paths = Array.isArray(params.paths) ? params.paths : [params.paths];
  if (paths.length === 0) {
    return await fn({
      id: 0,
      resources: [],
      queuedMs: 0,
      leaseKind: "subtreeMutation",
      leaseKey: "",
      release: () => {},
    });
  }
  const subtreeKeys = paths.map((entry) => canonicalizePathForLease(entry));
  const workspaceKey = canonicalizePathForLease(params.workspacePath ?? path.dirname(paths[0] ?? "."));
  return agentResourceLeases.withLease(
    {
      resources: [
        { kind: "workspaceWriter", key: workspaceKey },
        ...subtreeKeys.map((key) => ({ kind: "subtreeMutation" as const, key })),
      ],
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    },
    fn,
  );
}
