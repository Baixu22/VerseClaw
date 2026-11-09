import path from "node:path";
import {
  createOwnerReadSnapshot,
  deriveReadAdmissionContext,
  digestOwnerReadContent,
  evaluateOwnerReadPolicy,
  evaluateOwnerReadSnapshot,
  matchOwnerReadPin,
  resolveDefaultAgentId,
  resolveSessionAgentId,
  type OwnerReadPolicy,
  type OwnerReadRejectionCode,
  type OwnerReadSnapshotV1,
  type ReadAdmissionContextV1,
  type SourceRefV2,
} from "openclaw/plugin-sdk/memory-host-core";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import type { OpenClawConfig } from "../api.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { parseWikiMarkdown, type WikiPageSummary } from "./markdown.js";

export type MemoryWikiReadIdentity = {
  sessionId?: string;
  agentSessionKey?: string;
  workspaceId?: string;
  workspaceDir?: string;
  egressProviderRefs?: string[];
};

function canonicalPath(value: string): string {
  const absolute = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
export function memoryWikiNamespaceId(config: ResolvedMemoryWikiConfig): string {
  return `memory-wiki:${digestOwnerReadContent(canonicalPath(config.vault.path)).slice(7)}`;
}

/** Identity comes from the backend session/workspace owner, never page metadata. */
export function createMemoryWikiReadContext(input: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  identity?: MemoryWikiReadIdentity;
}): ReadAdmissionContextV1 {
  const identity = input.identity ?? {};
  const agentId = input.appConfig
    ? identity.agentSessionKey
      ? resolveSessionAgentId({ config: input.appConfig, sessionKey: identity.agentSessionKey })
      : resolveDefaultAgentId(input.appConfig)
    : undefined;
  const workspaceDir =
    identity.workspaceDir ??
    (input.appConfig && agentId
      ? resolveAgentWorkspaceDir(input.appConfig, agentId)
      : input.config.vault.path);
  const rootDigest = digestOwnerReadContent(canonicalPath(workspaceDir));
  return deriveReadAdmissionContext({
    principalId: "operator",
    sessionId:
      identity.sessionId ?? identity.agentSessionKey ?? `knowledge-ui:${agentId ?? "local"}`,
    ...(identity.agentSessionKey ? { sessionKey: identity.agentSessionKey } : {}),
    ...(agentId ? { agentId } : {}),
    workspaceId: identity.workspaceId ?? canonicalPath(workspaceDir),
    workspaceRootDigest: rootDigest,
    ownerNamespaces: [memoryWikiNamespaceId(input.config)],
    policyDigest: digestOwnerReadContent(
      JSON.stringify(["knowledge-owner-read-v1", agentId, rootDigest, input.config.vaultMode]),
    ),
    egressProviderRefs:
      identity.egressProviderRefs ?? Object.keys(input.appConfig?.models?.providers ?? {}),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readMemoryWikiOwnerPolicy(raw: string): OwnerReadPolicy {
  const metadata = parseWikiMarkdown(raw).frontmatter;
  let invalid = false;
  const status = metadata.status === undefined ? "active" : metadata.status;
  if (
    typeof status !== "string" ||
    !["active", "stale", "archived", "revoked", "deleted", "denied"].includes(status)
  )
    invalid = true;
  const trust = metadata.trust === undefined ? "advisory" : metadata.trust;
  if (
    typeof trust !== "string" ||
    !["untrusted", "advisory", "confirmed", "high-trust"].includes(trust)
  )
    invalid = true;
  if (
    metadata.revision !== undefined &&
    !(Number.isSafeInteger(metadata.revision) && Number(metadata.revision) > 0)
  )
    invalid = true;
  const tiers: Record<string, OwnerReadPolicy["sensitivity"]> = {
    public: "public",
    internal: "workspace",
    workspace: "workspace",
    personal: "sensitive",
    private: "sensitive",
    sensitive: "sensitive",
    secret_adjacent: "secret-adjacent",
    "secret-adjacent": "secret-adjacent",
    secret: "secret",
  };
  const tier =
    metadata.sensitivity !== undefined
      ? metadata.sensitivity
      : metadata.privacyTier !== undefined
        ? metadata.privacyTier
        : "workspace";
  const sensitivity =
    typeof tier === "string" && Object.hasOwn(tiers, tier) ? tiers[tier]! : "secret";
  let acl: OwnerReadPolicy["acl"] = { read: ["operator"] };
  if (metadata.acl !== undefined) {
    const ownerAcl = metadata.acl;
    if (
      !record(ownerAcl) ||
      !Array.isArray(ownerAcl.read) ||
      !ownerAcl.read.every((entry) => typeof entry === "string" && Boolean(entry.trim()))
    )
      invalid = true;
    else acl = { read: ownerAcl.read.map((entry: string) => entry.trim()) };
  }
  let scope: OwnerReadPolicy["scope"];
  if (metadata.scope !== undefined && !record(metadata.scope)) invalid = true;
  const ownerScope = record(metadata.scope) ? metadata.scope : {};
  const scopeFields = ["workspaceId", "agentId", "sessionKey", "taskId"] as const;
  for (const key of scopeFields) {
    const value = ownerScope[key] !== undefined ? ownerScope[key] : metadata[key];
    if (value === undefined) continue;
    if (!text(value)) invalid = true;
    else scope = { ...scope, [key]: text(value) };
  }
  if (metadata.retention !== undefined && !record(metadata.retention)) invalid = true;
  const ownerRetention = record(metadata.retention) ? metadata.retention : {};
  const retentionPolicy =
    ownerRetention.policy === undefined ? "source-coupled" : ownerRetention.policy;
  if (
    typeof retentionPolicy !== "string" ||
    !["source-coupled", "promoted", "ephemeral", "legal-hold"].includes(retentionPolicy)
  )
    invalid = true;
  const expiresAt =
    ownerRetention.expiresAt !== undefined ? ownerRetention.expiresAt : metadata.expiresAt;
  if (expiresAt !== undefined && !text(expiresAt)) invalid = true;
  return {
    status: invalid ? "denied" : (status as OwnerReadPolicy["status"]),
    trust: invalid ? "untrusted" : (trust as OwnerReadPolicy["trust"]),
    sensitivity,
    acl,
    ...(scope ? { scope } : {}),
    retention: {
      policy: invalid
        ? "source-coupled"
        : (retentionPolicy as OwnerReadPolicy["retention"]["policy"]),
      ...(text(expiresAt) ? { expiresAt: text(expiresAt) } : {}),
    },
    ...(text(metadata.verifiedAt) ? { verifiedAt: text(metadata.verifiedAt) } : {}),
    ...(text(metadata.updatedAt) ? { updatedAt: text(metadata.updatedAt) } : {}),
  };
}

export function readMemoryWikiOwnerSnapshot(input: {
  page: Pick<WikiPageSummary, "relativePath" | "title" | "revision"> & { raw: string };
  config: ResolvedMemoryWikiConfig;
  context: ReadAdmissionContextV1;
  fromLine?: number;
  lineCount?: number;
  pin?: SourceRefV2;
  signal?: AbortSignal;
}):
  | { status: "admitted"; snapshot: OwnerReadSnapshotV1 }
  | { status: "denied"; reason: OwnerReadRejectionCode } {
  const { page } = input;
  const policy = readMemoryWikiOwnerPolicy(page.raw);
  const admission = evaluateOwnerReadPolicy(
    policy,
    input.context,
    memoryWikiNamespaceId(input.config),
    { signal: input.signal },
  );
  if (admission) return { status: "denied", reason: admission };
  const body = parseWikiMarkdown(page.raw).body;
  const bodyStart = page.raw.length - body.length;
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const from = Math.max(0, (input.fromLine ?? 1) - 1);
  const start = bodyStart + lines.slice(0, from).join("").length;
  const end = start + lines.slice(from, from + (input.lineCount ?? 200)).join("").length;
  let startChar = start,
    endChar = end;
  if (input.pin?.locator) {
    const bytes = Buffer.from(page.raw, "utf8");
    const locator = input.pin.locator;
    if (
      locator.startByte < Buffer.byteLength(page.raw.slice(0, bodyStart), "utf8") ||
      locator.endByteExclusive > bytes.length
    )
      return { status: "denied", reason: "invalid_range" };
    let prefix: string, retained: string;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      prefix = decoder.decode(bytes.subarray(0, locator.startByte));
      retained = decoder.decode(bytes.subarray(locator.startByte, locator.endByteExclusive));
    } catch {
      return { status: "denied", reason: "invalid_range" };
    }
    startChar = prefix.length;
    endChar = startChar + retained.length;
  }
  const snapshot = createOwnerReadSnapshot({
    raw: page.raw,
    startChar,
    endChar,
    context: input.context,
    policy,
    title: page.title,
    source: {
      domain: "wiki",
      authorityId: "memory-wiki",
      namespaceId: memoryWikiNamespaceId(input.config),
      subjectId: page.relativePath,
      revision:
        page.revision === undefined ? digestOwnerReadContent(page.raw) : String(page.revision),
    },
  });
  snapshot.truncated = startChar > bodyStart || endChar < page.raw.length;
  const reason =
    evaluateOwnerReadSnapshot(snapshot, input.context, { signal: input.signal }) ??
    (input.pin ? matchOwnerReadPin(snapshot, input.pin) : undefined);
  return reason ? { status: "denied", reason } : { status: "admitted", snapshot };
}
