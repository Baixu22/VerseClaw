import type { ArchiveHandle } from "../../../../shared/types/context-family.js";
import { normalizeArchiveHandle, stableStringifyContextFamily } from "../../../../shared/types/context-family.js";
import {
  createContextArchiveHandleForPayload,
  createContextItemId,
  verifyContextArchiveHandle,
  type ContextArchiveCreateInput,
  type ContextArchiveVerifyResult,
} from "../../context-engine/registry/context-item-registry.js";
import { hashCapabilityMetadata } from "./capability-descriptor.js";

export const CAPABILITY_RESULT_POINTER_SCHEMA_VERSION =
  "capability-result-pointer/v1" as const;

export type CapabilityResultPointerBudget = {
  maxActivePointers: number;
  maxSummaryCharacters: number;
  maxTtlMs: number;
  maxReadCharacters: number;
  maxSliceCharacters: number;
  maxSearchScanCharacters: number;
  maxSearchOutputCharacters: number;
  maxSearchMatches: number;
  maxQueryCharacters: number;
};

export type CapabilityResultPointer = {
  schemaVersion: typeof CAPABILITY_RESULT_POINTER_SCHEMA_VERSION;
  pointerId: string;
  capabilityId: string;
  sessionId: string;
  taskId?: string;
  summary: string;
  archiveHandle: ArchiveHandle;
  requiredPermissions: string[];
  createdAt: string;
  expiresAt: string;
};

export type CapabilityResultArchiveOwner = {
  create(input: ContextArchiveCreateInput): Promise<ArchiveHandle>;
  verify(handle: ArchiveHandle): Promise<ContextArchiveVerifyResult>;
};

export type CapabilityResultPointerFailureCode =
  | "pointer-disabled"
  | "invalid-input"
  | "invalid-summary"
  | "invalid-ttl"
  | "invalid-slice"
  | "invalid-query"
  | "archive-create-failed"
  | "pointer-capacity-exhausted"
  | "pointer-not-issued"
  | "pointer-mismatch"
  | "session-mismatch"
  | "task-mismatch"
  | "permission-denied"
  | "pointer-expired"
  | "archive-invalid"
  | "archive-missing"
  | "archive-checksum-mismatch"
  | "archive-read-failed"
  | "payload-unreadable";

export type CapabilityResultPointerFailure = {
  code: CapabilityResultPointerFailureCode;
  message: string;
};

export type CapabilityResultPointerResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: CapabilityResultPointerFailure };

export type CapabilityResultPointerRead = {
  text: string;
  totalCharacters: number;
  returnedCharacters: number;
  truncated: boolean;
  nextOffset?: number;
};

export type CapabilityResultPointerSearch = {
  query: string;
  matches: Array<{ index: number; excerpt: string }>;
  scannedCharacters: number;
  scanTruncated: boolean;
  outputCharacterCount: number;
  matchLimitReached: boolean;
};

export type CapabilityResultPointerInput = {
  /** Explicit opt-in. Existing result payload behavior remains the default. */
  enabled?: boolean;
  budget: CapabilityResultPointerBudget;
  archiveOwner?: CapabilityResultArchiveOwner;
  now?: () => number;
};

type PointerAccess = {
  pointer: CapabilityResultPointer;
  sessionId: string;
  taskId?: string;
  grantedPermissions?: readonly string[];
};

const defaultArchiveOwner: CapabilityResultArchiveOwner = {
  create: createContextArchiveHandleForPayload,
  verify: verifyContextArchiveHandle,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePermissions(value: readonly string[] | undefined): string[] | undefined {
  if (!value) {
    return [];
  }
  const permissions: string[] = [];
  for (const item of value) {
    const permission = nonEmptyString(item);
    if (!permission) {
      return undefined;
    }
    permissions.push(permission);
  }
  return [...new Set(permissions)].toSorted();
}

function validateBudget(
  budget: CapabilityResultPointerBudget,
): CapabilityResultPointerFailure | undefined {
  for (const [name, value] of Object.entries(budget)) {
    if (!isPositiveInteger(value)) {
      return { code: "invalid-input", message: `${name} must be a positive integer` };
    }
  }
  return undefined;
}

function cloneArchiveHandle(handle: ArchiveHandle): ArchiveHandle {
  const normalized = normalizeArchiveHandle(handle);
  return {
    ...normalized,
    ...(normalized.source
      ? {
          source: {
            ...normalized.source,
            ...(normalized.source.range ? { range: { ...normalized.source.range } } : {}),
          },
        }
      : {}),
  };
}

function clonePointer(pointer: CapabilityResultPointer): CapabilityResultPointer {
  return {
    ...pointer,
    archiveHandle: cloneArchiveHandle(pointer.archiveHandle),
    requiredPermissions: [...pointer.requiredPermissions],
  };
}

function pointerMetadata(pointer: Omit<CapabilityResultPointer, "pointerId">): Record<string, unknown> {
  return {
    schemaVersion: pointer.schemaVersion,
    capabilityId: pointer.capabilityId,
    sessionId: pointer.sessionId,
    ...(pointer.taskId ? { taskId: pointer.taskId } : {}),
    summary: pointer.summary,
    archiveHandle: pointer.archiveHandle,
    requiredPermissions: pointer.requiredPermissions,
    createdAt: pointer.createdAt,
    expiresAt: pointer.expiresAt,
  };
}

function pointerId(pointer: Omit<CapabilityResultPointer, "pointerId">): string {
  return `resultptr_${hashCapabilityMetadata(pointerMetadata(pointer)).slice("sha256:".length)}`;
}

function disabledFailure(): CapabilityResultPointerResult<never> {
  return {
    ok: false,
    failure: {
      code: "pointer-disabled",
      message: "Capability Registry V3 Result Pointer is disabled",
    },
  };
}

function archiveFailure(
  result: Exclude<ContextArchiveVerifyResult, { ok: true }>,
): CapabilityResultPointerResult<never> {
  switch (result.reason) {
    case "invalid_uri":
      return { ok: false, failure: { code: "archive-invalid", message: "archive handle is invalid" } };
    case "missing":
      return { ok: false, failure: { code: "archive-missing", message: "archive artifact is missing" } };
    case "checksum_mismatch":
      return {
        ok: false,
        failure: { code: "archive-checksum-mismatch", message: "archive checksum mismatched" },
      };
    case "read_error":
      return {
        ok: false,
        failure: { code: "archive-read-failed", message: result.error ?? "archive could not be read" },
      };
  }
}

function toPayloadText(payload: unknown): CapabilityResultPointerResult<string> {
  try {
    return {
      ok: true,
      value: typeof payload === "string" ? payload : stableStringifyContextFamily(payload),
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: "payload-unreadable",
        message: error instanceof Error ? error.message : "archive payload cannot be rendered",
      },
    };
  }
}

/**
 * A bounded facade over the existing Context Family archive owner. It stores
 * no result body and deliberately performs no direct file or store access.
 */
export class CapabilityResultPointerService {
  readonly #archiveOwner: CapabilityResultArchiveOwner;
  readonly #now: () => number;
  readonly #issuedPointers = new Map<string, CapabilityResultPointer>();

  constructor(private readonly input: CapabilityResultPointerInput) {
    this.#archiveOwner = input.archiveOwner ?? defaultArchiveOwner;
    this.#now = input.now ?? Date.now;
  }

  async create(params: {
    sessionId: string;
    taskId?: string;
    capabilityId: string;
    toolCallId?: string;
    summary: string;
    result: unknown;
    ttlMs: number;
    permissions?: readonly string[];
  }): Promise<CapabilityResultPointerResult<CapabilityResultPointer>> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const budgetFailure = validateBudget(this.input.budget);
    if (budgetFailure) {
      return { ok: false, failure: budgetFailure };
    }
    const sessionId = nonEmptyString(params.sessionId);
    const capabilityId = nonEmptyString(params.capabilityId);
    const taskId = params.taskId === undefined ? undefined : nonEmptyString(params.taskId);
    const summary = typeof params.summary === "string" ? params.summary.trim() : "";
    const permissions = normalizePermissions(params.permissions);
    if (!sessionId || !capabilityId || (params.taskId !== undefined && !taskId)) {
      return { ok: false, failure: { code: "invalid-input", message: "sessionId, taskId, and capabilityId must be non-empty strings" } };
    }
    if (!summary || summary.length > this.input.budget.maxSummaryCharacters) {
      return { ok: false, failure: { code: "invalid-summary", message: "summary must be non-empty and within budget" } };
    }
    if (!permissions) {
      return { ok: false, failure: { code: "invalid-input", message: "permissions must be non-empty strings" } };
    }
    if (!isPositiveInteger(params.ttlMs) || params.ttlMs > this.input.budget.maxTtlMs) {
      return { ok: false, failure: { code: "invalid-ttl", message: "ttlMs must be within the configured budget" } };
    }
    const now = this.#now();
    if (!Number.isFinite(now)) {
      return { ok: false, failure: { code: "invalid-input", message: "clock returned an invalid timestamp" } };
    }
    let createdAt: string;
    let expiresAt: string;
    try {
      createdAt = new Date(now).toISOString();
      expiresAt = new Date(now + params.ttlMs).toISOString();
    } catch {
      return { ok: false, failure: { code: "invalid-input", message: "clock timestamp is out of range" } };
    }
    this.#discardExpiredPointers(now);
    if (this.#issuedPointers.size >= this.input.budget.maxActivePointers) {
      return {
        ok: false,
        failure: {
          code: "pointer-capacity-exhausted",
          message: "Result Pointer capacity is exhausted",
        },
      };
    }
    const toolCallId = params.toolCallId === undefined ? undefined : nonEmptyString(params.toolCallId);
    if (params.toolCallId !== undefined && !toolCallId) {
      return { ok: false, failure: { code: "invalid-input", message: "toolCallId must be a non-empty string" } };
    }
    let archiveHandle: ArchiveHandle;
    try {
      archiveHandle = cloneArchiveHandle(
        await this.#archiveOwner.create({
          sessionId,
          itemId: createContextItemId(sessionId, "observation", capabilityId, toolCallId ?? "result"),
          payload: params.result,
          source: {
            type: "tool_call",
            sessionId,
            ...(toolCallId ? { toolCallId } : {}),
            ownerId: capabilityId,
            label: "capability-result",
          },
          createdAt,
        }),
      );
      if (archiveHandle.source?.sessionId !== sessionId) {
        return {
          ok: false,
          failure: {
            code: "archive-create-failed",
            message: "archive owner returned a handle outside the pointer session",
          },
        };
      }
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: "archive-create-failed",
          message: error instanceof Error ? error.message : "archive owner rejected result",
        },
      };
    }
    const base: Omit<CapabilityResultPointer, "pointerId"> = {
      schemaVersion: CAPABILITY_RESULT_POINTER_SCHEMA_VERSION,
      capabilityId,
      sessionId,
      ...(taskId ? { taskId } : {}),
      summary,
      archiveHandle,
      requiredPermissions: permissions,
      createdAt,
      expiresAt,
    };
    const pointer = { ...base, pointerId: pointerId(base) };
    this.#issuedPointers.set(pointer.pointerId, clonePointer(pointer));
    return { ok: true, value: pointer };
  }

  async read(params: PointerAccess & { maxCharacters?: number }): Promise<CapabilityResultPointerResult<CapabilityResultPointerRead>> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const budgetFailure = validateBudget(this.input.budget);
    if (budgetFailure) {
      return { ok: false, failure: budgetFailure };
    }
    if (params.maxCharacters !== undefined && !isPositiveInteger(params.maxCharacters)) {
      return { ok: false, failure: { code: "invalid-input", message: "maxCharacters must be a positive integer" } };
    }
    const loaded = await this.#load(params);
    if (!loaded.ok) {
      return loaded;
    }
    const maxCharacters = Math.min(params.maxCharacters ?? this.input.budget.maxReadCharacters, this.input.budget.maxReadCharacters);
    const text = loaded.value;
    const returned = text.slice(0, maxCharacters);
    return {
      ok: true,
      value: {
        text: returned,
        totalCharacters: text.length,
        returnedCharacters: returned.length,
        truncated: returned.length < text.length,
        ...(returned.length < text.length ? { nextOffset: returned.length } : {}),
      },
    };
  }

  async slice(params: PointerAccess & { offset: number; length: number }): Promise<CapabilityResultPointerResult<CapabilityResultPointerRead>> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const budgetFailure = validateBudget(this.input.budget);
    if (budgetFailure) {
      return { ok: false, failure: budgetFailure };
    }
    if (!Number.isInteger(params.offset) || params.offset < 0 || !isPositiveInteger(params.length)) {
      return { ok: false, failure: { code: "invalid-slice", message: "offset and length must be valid positive bounds" } };
    }
    const loaded = await this.#load(params);
    if (!loaded.ok) {
      return loaded;
    }
    const text = loaded.value;
    const boundedLength = Math.min(params.length, this.input.budget.maxSliceCharacters);
    const returned = text.slice(params.offset, params.offset + boundedLength);
    const nextOffset = params.offset + returned.length;
    return {
      ok: true,
      value: {
        text: returned,
        totalCharacters: text.length,
        returnedCharacters: returned.length,
        truncated: nextOffset < text.length,
        ...(nextOffset < text.length ? { nextOffset } : {}),
      },
    };
  }

  async search(params: PointerAccess & { query: string; limit?: number }): Promise<CapabilityResultPointerResult<CapabilityResultPointerSearch>> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const budgetFailure = validateBudget(this.input.budget);
    if (budgetFailure) {
      return { ok: false, failure: budgetFailure };
    }
    const query = typeof params.query === "string" ? params.query.trim() : "";
    if (!query || query.length > this.input.budget.maxQueryCharacters) {
      return { ok: false, failure: { code: "invalid-query", message: "query must be non-empty and within budget" } };
    }
    if (params.limit !== undefined && !isPositiveInteger(params.limit)) {
      return { ok: false, failure: { code: "invalid-query", message: "limit must be a positive integer" } };
    }
    const loaded = await this.#load(params);
    if (!loaded.ok) {
      return loaded;
    }
    const scanned = loaded.value.slice(0, this.input.budget.maxSearchScanCharacters);
    const queryLower = query.toLowerCase();
    const scannedLower = scanned.toLowerCase();
    const maxMatches = Math.min(params.limit ?? this.input.budget.maxSearchMatches, this.input.budget.maxSearchMatches);
    const matches: Array<{ index: number; excerpt: string }> = [];
    let outputCharacterCount = 0;
    let cursor = 0;
    while (matches.length < maxMatches) {
      const index = scannedLower.indexOf(queryLower, cursor);
      if (index === -1) {
        break;
      }
      const excerptStart = Math.max(0, index - 32);
      const excerptEnd = Math.min(scanned.length, index + query.length + 32);
      const remaining = this.input.budget.maxSearchOutputCharacters - outputCharacterCount;
      if (remaining <= 0) {
        break;
      }
      const excerpt = scanned.slice(excerptStart, Math.min(excerptEnd, excerptStart + remaining));
      matches.push({ index, excerpt });
      outputCharacterCount += excerpt.length;
      cursor = index + Math.max(query.length, 1);
    }
    const nextMatch = scannedLower.indexOf(queryLower, cursor);
    return {
      ok: true,
      value: {
        query,
        matches,
        scannedCharacters: scanned.length,
        scanTruncated: scanned.length < loaded.value.length,
        outputCharacterCount,
        matchLimitReached: nextMatch !== -1,
      },
    };
  }

  async #load(params: PointerAccess): Promise<CapabilityResultPointerResult<string>> {
    const access = this.#validateAccess(params);
    if (!access.ok) {
      return access;
    }
    let verification: ContextArchiveVerifyResult;
    try {
      verification = await this.#archiveOwner.verify(access.value.archiveHandle);
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: "archive-read-failed",
          message: error instanceof Error ? error.message : "archive owner failed to verify result",
        },
      };
    }
    if (!verification.ok) {
      return archiveFailure(verification);
    }
    return toPayloadText(verification.payload);
  }

  #validateAccess(params: PointerAccess): CapabilityResultPointerResult<CapabilityResultPointer> {
    if (!isRecord(params.pointer)) {
      return { ok: false, failure: { code: "pointer-mismatch", message: "pointer must be an object" } };
    }
    const pointer = params.pointer;
    const suppliedPointerId = nonEmptyString(pointer.pointerId);
    const sessionId = nonEmptyString(pointer.sessionId);
    const capabilityId = nonEmptyString(pointer.capabilityId);
    const summary = nonEmptyString(pointer.summary);
    const createdAt = typeof pointer.createdAt === "string" ? Date.parse(pointer.createdAt) : Number.NaN;
    const expiresAt = typeof pointer.expiresAt === "string" ? Date.parse(pointer.expiresAt) : Number.NaN;
    const requiredPermissions = normalizePermissions(pointer.requiredPermissions);
    let archiveHandle: ArchiveHandle;
    try {
      archiveHandle = cloneArchiveHandle(pointer.archiveHandle);
    } catch {
      return { ok: false, failure: { code: "pointer-mismatch", message: "pointer archive handle is invalid" } };
    }
    const taskId = pointer.taskId === undefined ? undefined : nonEmptyString(pointer.taskId);
    if (
      pointer.schemaVersion !== CAPABILITY_RESULT_POINTER_SCHEMA_VERSION ||
      !suppliedPointerId ||
      !sessionId ||
      !capabilityId ||
      !summary ||
      !requiredPermissions ||
      !Number.isFinite(createdAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt < createdAt ||
      (pointer.taskId !== undefined && !taskId) ||
      archiveHandle.source?.sessionId !== sessionId
    ) {
      return { ok: false, failure: { code: "pointer-mismatch", message: "pointer metadata is invalid" } };
    }
    const base: Omit<CapabilityResultPointer, "pointerId"> = {
      schemaVersion: pointer.schemaVersion,
      capabilityId,
      sessionId,
      ...(taskId ? { taskId } : {}),
      summary,
      archiveHandle,
      requiredPermissions,
      createdAt: pointer.createdAt,
      expiresAt: pointer.expiresAt,
    };
    if (suppliedPointerId !== pointerId(base)) {
      return { ok: false, failure: { code: "pointer-mismatch", message: "pointer checksum mismatched" } };
    }
    const issued = this.#issuedPointers.get(suppliedPointerId);
    if (!issued) {
      return { ok: false, failure: { code: "pointer-not-issued", message: "pointer was not issued by this runtime" } };
    }
    if (hashCapabilityMetadata(pointerMetadata(issued)) !== hashCapabilityMetadata(pointerMetadata(base))) {
      return { ok: false, failure: { code: "pointer-mismatch", message: "pointer metadata differs from its issued binding" } };
    }
    const requesterSessionId = nonEmptyString(params.sessionId);
    if (!requesterSessionId || requesterSessionId !== sessionId) {
      return { ok: false, failure: { code: "session-mismatch", message: "pointer belongs to another session" } };
    }
    if (taskId !== undefined && params.taskId !== taskId) {
      return { ok: false, failure: { code: "task-mismatch", message: "pointer belongs to another task" } };
    }
    const granted = new Set(normalizePermissions(params.grantedPermissions));
    if (requiredPermissions.some((permission) => !granted.has(permission))) {
      return { ok: false, failure: { code: "permission-denied", message: "pointer permissions are not granted" } };
    }
    if (this.#now() >= expiresAt) {
      this.#issuedPointers.delete(suppliedPointerId);
      return { ok: false, failure: { code: "pointer-expired", message: "pointer has expired" } };
    }
    return { ok: true, value: clonePointer(issued) };
  }

  #discardExpiredPointers(now: number): void {
    for (const [id, pointer] of this.#issuedPointers) {
      if (Date.parse(pointer.expiresAt) <= now) {
        this.#issuedPointers.delete(id);
      }
    }
  }
}
