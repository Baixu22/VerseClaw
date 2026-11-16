import path from "node:path";
import {
  createOwnerReadSnapshot,
  readOwnerReadPolicyMetadata,
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
import { getSessionEntry, resolveStorePath } from "openclaw/plugin-sdk/session-store-runtime";
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
  const session =
    input.appConfig && agentId && identity.agentSessionKey
      ? getSessionEntry({
          agentId,
          sessionKey: identity.agentSessionKey,
          storePath: resolveStorePath(input.appConfig.session?.store, { agentId }),
        })
      : undefined;
  return deriveReadAdmissionContext({
    principalId: "operator",
    sessionId:
      session?.sessionId ??
      identity.sessionId ??
      identity.agentSessionKey ??
      `knowledge-ui:${agentId ?? "local"}`,
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

export function readMemoryWikiOwnerPolicy(raw: string): OwnerReadPolicy {
  return readOwnerReadPolicyMetadata(parseWikiMarkdown(raw).frontmatter);
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
