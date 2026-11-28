import { createHash, randomUUID } from "node:crypto";

export type SourceDomain =
  | "wiki"
  | "native-memory"
  | "role-memory"
  | "experience"
  | "code"
  | "task";
export type RawSourceLocator = {
  coordinateSpace: "raw-source-utf8-v1";
  startByte: number;
  endByteExclusive: number;
  startLine: number;
  endLine: number;
};
export type SourceRefV2 = {
  schema: "SourceRef/v2";
  domain: SourceDomain;
  authorityId: string;
  namespaceId: string;
  subjectId: string;
  revision: string;
  sourceDigest: string;
  policyEpoch: string;
  locator?: RawSourceLocator;
};
export type ReadAdmissionContextV1 = {
  schema: "ReadAdmissionContext/v1";
  contextId: string;
  principalId: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  workspaceId: string;
  workspaceRootDigest?: string;
  ownerNamespaces: string[];
  policyDigest: string;
  purpose: "knowledge-read";
  egressProviderRefs: string[];
  expiresAt: string;
};
export type OwnerReadPolicy = {
  status: "active" | "stale" | "archived" | "revoked" | "deleted" | "denied";
  trust: "untrusted" | "advisory" | "confirmed" | "high-trust";
  sensitivity: "public" | "workspace" | "sensitive" | "secret-adjacent" | "secret";
  acl: { read: string[] };
  scope?: { workspaceId?: string; agentId?: string; sessionKey?: string; taskId?: string };
  retention: {
    policy: "source-coupled" | "promoted" | "ephemeral" | "legal-hold";
    expiresAt?: string;
  };
  verifiedAt?: string;
  updatedAt?: string;
};
export type OwnerReadSnapshotV1 = {
  schema: "OwnerReadSnapshot/v1";
  source: SourceRefV2;
  context: ReadAdmissionContextV1;
  policy: OwnerReadPolicy;
  title: string;
  content: string;
  contentDigest: string;
  readAt: string;
  totalLines: number;
  truncated: boolean;
};
export type OwnerReadRejectionCode =
  | "invalid_context"
  | "namespace_mismatch"
  | "scope_mismatch"
  | "expired"
  | "archived"
  | "revoked"
  | "deleted"
  | "denied"
  | "stale"
  | "acl_denied"
  | "sensitive"
  | "invalid_range"
  | "revision_mismatch"
  | "digest_mismatch"
  | "policy_changed"
  | "cancelled"
  | "egress_denied"
  | "not_found";
export type OwnerReadStage = "snippet" | "embedding" | "rerank" | "prompt";

export function digestOwnerReadContent(content: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Pins constrain a read. They never carry a grant or owner policy. */
export function isSourceRefV2(value: unknown): value is SourceRefV2 {
  if (!record(value) || value.schema !== "SourceRef/v2") return false;
  if (
    typeof value.domain !== "string" ||
    !["wiki", "native-memory", "role-memory", "experience", "code", "task"].includes(value.domain)
  )
    return false;
  if (
    ![
      value.authorityId,
      value.authorityId,
      value.subjectId,
      value.revision,
      value.policyEpoch,
    ].every(nonempty)
  )
    return false;
  if (typeof value.sourceDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.sourceDigest))
    return false;
  if (value.locator === undefined) return true;
  const range = value.locator;
  return (
    record(range) &&
    range.coordinateSpace === "raw-source-utf8-v1" &&
    [range.startByte, range.endByteExclusive, range.startLine, range.endLine].every(
      Number.isSafeInteger,
    ) &&
    Number(range.startByte) >= 0 &&
    Number(range.endByteExclusive) >= Number(range.startByte) &&
    Number(range.startLine) >= 1 &&
    Number(range.endLine) >= Number(range.startLine)
  );
}

export function normalizeSourceRefV2(value: unknown): SourceRefV2 | undefined {
  if (!isSourceRefV2(value)) return undefined;
  return {
    schema: "SourceRef/v2",
    domain: value.domain,
    authorityId: value.authorityId,
    namespaceId: value.namespaceId,
    subjectId: value.subjectId,
    revision: value.revision,
    sourceDigest: value.sourceDigest,
    policyEpoch: value.policyEpoch,
    ...(value.locator
      ? {
          locator: {
            coordinateSpace: "raw-source-utf8-v1",
            startByte: value.locator.startByte,
            endByteExclusive: value.locator.endByteExclusive,
            startLine: value.locator.startLine,
            endLine: value.locator.endLine,
          },
        }
      : {}),
  };
}

export function isOwnerReadSnapshotV1(value: unknown): value is OwnerReadSnapshotV1 {
  if (
    !record(value) ||
    value.schema !== "OwnerReadSnapshot/v1" ||
    !isSourceRefV2(value.source) ||
    !value.source.locator ||
    typeof value.content !== "string" ||
    typeof value.title !== "string" ||
    !nonempty(value.contentDigest) ||
    !nonempty(value.readAt) ||
    typeof value.truncated !== "boolean" ||
    !Number.isSafeInteger(value.totalLines) ||
    Number(value.totalLines) < value.source.locator.endLine
  )
    return false;
  const context = value.context,
    policy = value.policy;
  if (
    !record(context) ||
    context.schema !== "ReadAdmissionContext/v1" ||
    context.purpose !== "knowledge-read" ||
    ![
      context.contextId,
      context.principalId,
      context.sessionId,
      context.workspaceId,
      context.policyDigest,
      context.expiresAt,
    ].every(nonempty) ||
    !Array.isArray(context.ownerNamespaces) ||
    !context.ownerNamespaces.every(nonempty) ||
    !Array.isArray(context.egressProviderRefs) ||
    !context.egressProviderRefs.every(nonempty)
  )
    return false;
  if (
    !record(policy) ||
    typeof policy.status !== "string" ||
    !["active", "stale", "archived", "revoked", "deleted", "denied"].includes(policy.status) ||
    typeof policy.trust !== "string" ||
    !["untrusted", "advisory", "confirmed", "high-trust"].includes(policy.trust) ||
    typeof policy.sensitivity !== "string" ||
    !["public", "workspace", "sensitive", "secret-adjacent", "secret"].includes(
      policy.sensitivity,
    ) ||
    !record(policy.acl) ||
    !Array.isArray(policy.acl.read) ||
    !policy.acl.read.every(nonempty) ||
    !record(policy.retention) ||
    !["source-coupled", "promoted", "ephemeral", "legal-hold"].includes(
      String(policy.retention.policy),
    )
  )
    return false;
  if (policy.retention.expiresAt !== undefined && !nonempty(policy.retention.expiresAt))
    return false;
  const scope = policy.scope;
  return (
    scope === undefined ||
    (record(scope) &&
      ["workspaceId", "agentId", "sessionKey", "taskId"].every(
        (key) => scope[key] === undefined || nonempty(scope[key]),
      ))
  );
}

/** Called with session/workspace facts resolved by the Host or runtime owner. */
export function deriveReadAdmissionContext(
  identity: Omit<ReadAdmissionContextV1, "schema" | "contextId" | "purpose">,
): ReadAdmissionContextV1 {
  return {
    ...identity,
    schema: "ReadAdmissionContext/v1",
    contextId: randomUUID(),
    purpose: "knowledge-read",
    ownerNamespaces: [...new Set(identity.ownerNamespaces)].sort(),
    egressProviderRefs: [...new Set(identity.egressProviderRefs)].sort(),
  };
}

export function evaluateOwnerReadPolicy(
  policy: OwnerReadPolicy,
  context: ReadAdmissionContextV1,
  namespaceId: string,
  options: {
    stage?: OwnerReadStage;
    providerRef?: string;
    nowMs?: number;
    signal?: AbortSignal;
  } = {},
): OwnerReadRejectionCode | undefined {
  if (options.signal?.aborted) return "cancelled";
  const nowMs = options.nowMs ?? Date.now();
  if (
    context.schema !== "ReadAdmissionContext/v1" ||
    context.purpose !== "knowledge-read" ||
    ![
      context.contextId,
      context.principalId,
      context.sessionId,
      context.workspaceId,
      context.policyDigest,
    ].every(nonempty)
  )
    return "invalid_context";
  if (!Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= nowMs)
    return "expired";
  if (!context.ownerNamespaces.includes(namespaceId)) return "namespace_mismatch";
  if (policy.status !== "active") return policy.status;
  if (policy.sensitivity !== "public" && policy.sensitivity !== "workspace") return "sensitive";
  if (!policy.acl.read.includes(context.principalId)) return "acl_denied";
  const scope = policy.scope;
  if (
    (scope?.workspaceId && scope.workspaceId !== context.workspaceId) ||
    (scope?.agentId && scope.agentId !== context.agentId) ||
    (scope?.sessionKey && scope.sessionKey !== context.sessionKey) ||
    scope?.taskId
  )
    return "scope_mismatch";
  if (
    policy.retention.expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(policy.retention.expiresAt)) ||
      Date.parse(policy.retention.expiresAt) <= nowMs)
  )
    return "expired";
  if (options.providerRef && !context.egressProviderRefs.includes(options.providerRef))
    return "egress_denied";
  return undefined;
}

export function evaluateOwnerReadSnapshot(
  snapshot: OwnerReadSnapshotV1,
  context: ReadAdmissionContextV1,
  options: {
    stage?: OwnerReadStage;
    providerRef?: string;
    nowMs?: number;
    signal?: AbortSignal;
  } = {},
): OwnerReadRejectionCode | undefined {
  if (!isOwnerReadSnapshotV1(snapshot)) return "denied";
  const denied = evaluateOwnerReadPolicy(
    snapshot.policy,
    context,
    snapshot.source.namespaceId,
    options,
  );
  if (denied) return denied;
  if (
    snapshot.context.principalId !== context.principalId ||
    snapshot.context.sessionId !== context.sessionId ||
    snapshot.context.workspaceId !== context.workspaceId ||
    snapshot.context.agentId !== context.agentId ||
    snapshot.context.sessionKey !== context.sessionKey ||
    snapshot.context.policyDigest !== context.policyDigest ||
    snapshot.context.workspaceRootDigest !== context.workspaceRootDigest
  )
    return "invalid_context";
  if (!isSourceRefV2(snapshot.source) || !snapshot.source.locator) return "invalid_range";
  if (snapshot.contentDigest !== digestOwnerReadContent(snapshot.content)) return "digest_mismatch";
  if (
    snapshot.source.locator.endByteExclusive - snapshot.source.locator.startByte !==
    Buffer.byteLength(snapshot.content, "utf8")
  )
    return "invalid_range";
  if (snapshot.source.policyEpoch !== digestOwnerReadContent(JSON.stringify(snapshot.policy)))
    return "policy_changed";
  return undefined;
}

export function matchOwnerReadPin(
  snapshot: OwnerReadSnapshotV1,
  pin: SourceRefV2,
): OwnerReadRejectionCode | undefined {
  if (
    pin.authorityId !== snapshot.source.authorityId ||
    pin.domain !== snapshot.source.domain ||
    pin.namespaceId !== snapshot.source.namespaceId ||
    pin.subjectId !== snapshot.source.subjectId
  )
    return "namespace_mismatch";
  if (pin.revision !== snapshot.source.revision) return "revision_mismatch";
  if (pin.sourceDigest !== snapshot.source.sourceDigest) return "digest_mismatch";
  if (pin.policyEpoch !== snapshot.source.policyEpoch) return "policy_changed";
  if (
    pin.locator &&
    ["coordinateSpace", "startByte", "endByteExclusive", "startLine", "endLine"].some(
      (key) =>
        pin.locator![key as keyof RawSourceLocator] !==
        snapshot.source.locator?.[key as keyof RawSourceLocator],
    )
  )
    return "invalid_range";
  return undefined;
}

/** Raw bytes, body excerpts and packed prompt bytes have different digests. */
export function createOwnerReadSnapshot(input: {
  raw: string;
  startChar: number;
  endChar: number;
  source: Omit<SourceRefV2, "schema" | "sourceDigest" | "policyEpoch" | "locator">;
  context: ReadAdmissionContextV1;
  policy: OwnerReadPolicy;
  title: string;
}): OwnerReadSnapshotV1 {
  const { raw, startChar, endChar } = input;
  const splitsCodePoint = (offset: number) =>
    offset > 0 &&
    offset < raw.length &&
    /[\uD800-\uDBFF]/.test(raw[offset - 1]!) &&
    /[\uDC00-\uDFFF]/.test(raw[offset]!);
  if (
    !Number.isSafeInteger(startChar) ||
    !Number.isSafeInteger(endChar) ||
    startChar < 0 ||
    endChar < startChar ||
    endChar > raw.length ||
    splitsCodePoint(startChar) ||
    splitsCodePoint(endChar)
  )
    throw new Error("invalid owner range");
  const content = raw.slice(startChar, endChar);
  const startLine = 1 + (raw.slice(0, startChar).match(/\n/g)?.length ?? 0);
  const endLine = 1 + (raw.slice(0, Math.max(startChar, endChar - 1)).match(/\n/g)?.length ?? 0);
  return {
    schema: "OwnerReadSnapshot/v1",
    source: {
      ...input.source,
      schema: "SourceRef/v2",
      sourceDigest: digestOwnerReadContent(raw),
      policyEpoch: digestOwnerReadContent(JSON.stringify(input.policy)),
      locator: {
        coordinateSpace: "raw-source-utf8-v1",
        startByte: Buffer.byteLength(raw.slice(0, startChar), "utf8"),
        endByteExclusive: Buffer.byteLength(raw.slice(0, endChar), "utf8"),
        startLine,
        endLine,
      },
    },
    context: input.context,
    policy: input.policy,
    title: input.title,
    content,
    contentDigest: digestOwnerReadContent(content),
    readAt: new Date().toISOString(),
    totalLines: 1 + (raw.match(/\n/g)?.length ?? 0),
    truncated: startChar > 0 || endChar < raw.length,
  };
}

/** Bound a derived excerpt without losing its parent's identity or raw locator. */
export function boundOwnerReadSnapshot(
  snapshot: OwnerReadSnapshotV1,
  maxChars: number,
): OwnerReadSnapshotV1 {
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) throw new Error("invalid owner read budget");
  let end = Math.min(snapshot.content.length, maxChars);
  if (end > 0 && /[\uD800-\uDBFF]/.test(snapshot.content[end - 1]!)) end -= 1;
  if (end === snapshot.content.length) return snapshot;
  const content = snapshot.content.slice(0, end);
  const locator = snapshot.source.locator!;
  return {
    ...snapshot,
    content,
    contentDigest: digestOwnerReadContent(content),
    truncated: true,
    source: {
      ...snapshot.source,
      locator: {
        ...locator,
        endByteExclusive: locator.startByte + Buffer.byteLength(content, "utf8"),
        endLine: locator.startLine + (content.slice(0, -1).match(/\n/g)?.length ?? 0),
      },
    },
  };
}
