import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  getMemoryCard,
  isMemoryStoreConfigured,
  isRoleMemoryEnabled,
  resolveRoleMemoryStorePath,
} from "../memory/memory-store.js";
import { isMemoryCardInContextScope } from "../memory/memory-card.js";
import { readNativeMemorySource } from "../memory/native-memory-source.js";
import { applyMemoryUseGateOverlay, isPoisonRevokedCard } from "../memory/memory-dual-gate.js";
import { KnowledgeStore } from "../knowledge/sekb/knowledge-store.js";
import { isSekbEnabled } from "../knowledge/sekb/feature-flags.js";
import {
  createMemoryWikiReadContext,
  getMemoryWikiPage,
  resolveMemoryWikiConfig,
  type MemoryWikiPluginConfig,
  type MemoryWikiReadIdentity,
} from "../../extensions/memory-wiki/runtime-api.js";
import {
  createOwnerReadSnapshot,
  digestOwnerReadContent,
  evaluateOwnerReadPolicy,
  evaluateOwnerReadSnapshot,
  isOwnerReadSnapshotV1,
  matchOwnerReadPin,
  type OwnerReadPolicy,
  type OwnerReadRejectionCode,
  type OwnerReadSnapshotV1,
} from "../runtime-core/knowledge-owner-read.js";
import {
  createResolvedChatKnowledgeRef,
  type ChatKnowledgeReferenceIntent,
  type ChatKnowledgeSourceAdapter,
  type ChatKnowledgeSourceAdapterResult,
  type ResolvedChatKnowledgeRef,
} from "./chat-knowledge-intent.js";

type OwnerReadOptions = {
  cfg?: OpenClawConfig;
  identity?: MemoryWikiReadIdentity;
  signal?: AbortSignal;
  internalRunId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function wikiConfig(cfg: OpenClawConfig | undefined) {
  const entry = cfg?.plugins?.entries?.["memory-wiki"];
  const config = isRecord(entry?.config) ? (entry.config as MemoryWikiPluginConfig) : undefined;
  return resolveMemoryWikiConfig(config);
}
function denied(reason: OwnerReadRejectionCode): ChatKnowledgeSourceAdapterResult {
  return {
    status: "denied",
    reason,
    visibleReason: `Knowledge source cannot be read (${reason}).`,
  };
}
function legacyPinReason(
  ref: ChatKnowledgeReferenceIntent,
  snapshot: OwnerReadSnapshotV1,
): OwnerReadRejectionCode | undefined {
  if (ref.revision !== undefined && ref.revision !== snapshot.source.revision)
    return "revision_mismatch";
  if (ref.contentDigest !== undefined && ref.contentDigest !== snapshot.contentDigest)
    return "digest_mismatch";
  return ref.sourceRef ? matchOwnerReadPin(snapshot, ref.sourceRef) : undefined;
}
function resolved(
  ref: ChatKnowledgeReferenceIntent,
  snapshot: OwnerReadSnapshotV1,
  evidenceRefs: string[] = [],
): ChatKnowledgeSourceAdapterResult {
  const reason = legacyPinReason(ref, snapshot);
  if (reason) return denied(reason);
  const owner = snapshot.source.authorityId as ResolvedChatKnowledgeRef["owner"];
  return {
    status: "resolved",
    resolved: createResolvedChatKnowledgeRef({
      intentId: ref.id,
      conflictGroupId: ref.conflictGroupId,
      owner,
      subjectKind:
        owner === "memory-wiki"
          ? "wiki-page"
          : owner === "native-memory"
            ? "memory-file"
            : owner === "memory-slot"
              ? "memory-card"
              : "experience-principle",
      subjectId: snapshot.source.subjectId,
      revision: snapshot.source.revision,
      title: snapshot.title,
      lookup: snapshot.source.subjectId,
      content: snapshot.content,
      sourceRefs: [`${owner}:${snapshot.source.subjectId}`],
      evidenceRefs,
      ownerSnapshot: snapshot,
      materializedAt: snapshot.readAt,
    }),
  };
}

/** Materialize the owner's original body and policy; selection can only narrow its range. */
function readOwnedBody(
  ref: ChatKnowledgeReferenceIntent,
  input: {
    owner: ResolvedChatKnowledgeRef["owner"];
    domain: OwnerReadSnapshotV1["source"]["domain"];
    namespaceId: string;
    subjectId: string;
    revision: string;
    raw: string;
    title: string;
    policy: OwnerReadPolicy;
    options: OwnerReadOptions;
    evidenceRefs?: string[];
  },
): ChatKnowledgeSourceAdapterResult {
  const context = createMemoryWikiReadContext({
    config: wikiConfig(input.options.cfg),
    appConfig: input.options.cfg,
    identity: input.options.identity,
  });
  context.ownerNamespaces = [input.namespaceId];
  const reason = evaluateOwnerReadPolicy(input.policy, context, input.namespaceId, {
    signal: input.options.signal,
  });
  if (reason) return denied(reason);
  let startChar = 0,
    endChar = input.raw.length;
  if (ref.sourceRef?.locator) {
    const range = ref.sourceRef.locator,
      bytes = Buffer.from(input.raw, "utf8");
    if (range.endByteExclusive > bytes.length) return denied("invalid_range");
    try {
      const decoder = new TextDecoder("utf8", { fatal: true, ignoreBOM: true });
      const prefix = decoder.decode(bytes.subarray(0, range.startByte));
      const body = decoder.decode(bytes.subarray(range.startByte, range.endByteExclusive));
      startChar = prefix.length;
      endChar = startChar + body.length;
    } catch {
      return denied("invalid_range");
    }
  }
  const snapshot = createOwnerReadSnapshot({
    raw: input.raw,
    startChar,
    endChar,
    policy: input.policy,
    context,
    title: input.title,
    source: {
      domain: input.domain,
      authorityId: input.owner,
      namespaceId: input.namespaceId,
      subjectId: input.subjectId,
      revision: input.revision,
    },
  });
  return resolved(ref, snapshot, input.evidenceRefs);
}

export class MemoryWikiChatKnowledgeSourceAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "memory-wiki" as const;
  constructor(
    private readonly cfg: OpenClawConfig | undefined,
    private readonly options: Omit<OwnerReadOptions, "cfg"> = {},
  ) {}

  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    if (
      this.cfg?.plugins?.enabled === false ||
      this.cfg?.plugins?.entries?.["memory-wiki"]?.enabled === false
    )
      return denied("not_found");
    const lookup = ref.lookup || ref.pagePath || ref.sourcePath;
    if (!lookup) return { status: "not_found" };
    try {
      const result = await getMemoryWikiPage({
        config: wikiConfig(this.cfg),
        appConfig: this.cfg,
        lookup,
        lineCount: 80,
        searchCorpus: "wiki",
        sourceRef: ref.sourceRef,
        readIdentity: this.options.identity,
        signal: this.options.signal,
      });
      if (result?.status === "denied") return denied(result.reason as OwnerReadRejectionCode);
      if (!result || result.corpus !== "wiki" || !result.content) {
        return ref.sourceRef || ref.corpus === "wiki"
          ? denied("not_found")
          : { status: "not_found" };
      }
      if (!isOwnerReadSnapshotV1(result.ownerSnapshot)) return denied("denied");
      return resolved(
        {
          ...ref,
          conflictGroupId:
            ref.conflictGroupId ?? (result.hasConflicts ? "known-conflicts" : undefined),
        },
        result.ownerSnapshot,
      );
    } catch {
      return denied("denied");
    }
  }
}

export class NativeMemoryChatKnowledgeSourceAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "native-memory" as const;
  constructor(private readonly options: OwnerReadOptions = {}) {}
  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    if (!ref.sourceRef && !ref.lookup.startsWith("native-memory:") && !/\.md$/i.test(ref.lookup))
      return { status: "not_found" };
    try {
      const read = await readNativeMemorySource({
        ...this.options,
        lookup: ref.lookup,
        sourceRef: ref.sourceRef,
      });
      return read.status === "admitted"
        ? resolved(ref, read.snapshot)
        : denied(read.reason as OwnerReadRejectionCode);
    } catch {
      return denied("denied");
    }
  }
}

export class RoleMemoryChatKnowledgeSourceAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "memory-slot" as const;
  constructor(private readonly options: OwnerReadOptions = {}) {}

  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    if (!isRoleMemoryEnabled() || !isMemoryStoreConfigured()) return denied("not_found");
    const namespaceId = `memory-slot:${digestOwnerReadContent(resolveRoleMemoryStorePath()).slice(7)}`;
    if (
      ref.sourceRef &&
      (ref.sourceRef.domain !== "role-memory" ||
        ref.sourceRef.authorityId !== "memory-slot" ||
        ref.sourceRef.namespaceId !== namespaceId)
    )
      return denied("namespace_mismatch");
    const ids = ref.sourceRef
      ? [ref.sourceRef.subjectId]
      : ref.lookup.startsWith("memory-slot:")
        ? [ref.lookup]
        : [ref.id, ref.pageId, ref.sourcePath, ref.lookup];
    const card = ids
      .flatMap((id) => (id ? [getMemoryCard(id.replace(/^memory-slot:/, ""))] : []))
      .find(Boolean);
    if (!card)
      return ref.sourceRef || ref.corpus === "memory"
        ? denied("not_found")
        : { status: "not_found" };
    if (isPoisonRevokedCard(card) || applyMemoryUseGateOverlay([card]).length === 0)
      return denied("denied");
    const context = createMemoryWikiReadContext({
      config: wikiConfig(this.options.cfg),
      appConfig: this.options.cfg,
      identity: this.options.identity,
    });
    if (this.options.identity?.sessionId && context.sessionId !== this.options.identity.sessionId)
      return denied("invalid_context");
    if (["agent", "workspace", "project", "session", "task"].includes(card.scope) && !card.scopeKey)
      return denied("scope_mismatch");
    if (
      !isMemoryCardInContextScope(card, {
        workspace: context.workspaceId,
        sessionKey: context.sessionKey,
      })
    )
      return denied("scope_mismatch");
    const scope: OwnerReadPolicy["scope"] =
      card.scope === "agent"
        ? { agentId: card.scopeKey! }
        : card.scope === "workspace" || card.scope === "project"
          ? { workspaceId: card.scopeKey! }
          : card.scope === "session"
            ? { sessionKey: card.scopeKey! }
            : card.scope === "task"
              ? { taskId: card.scopeKey! }
              : undefined;
    return readOwnedBody(ref, {
      owner: this.owner,
      domain: "role-memory",
      namespaceId,
      subjectId: card.id,
      revision: String(card.version),
      raw: card.content,
      title: card.id,
      policy: {
        status: card.supersededBy
          ? "stale"
          : card.status === "active"
            ? "active"
            : card.status === "tombstone"
              ? "deleted"
              : card.status === "archived"
                ? "archived"
                : "stale",
        trust: "confirmed",
        sensitivity:
          card.sensitivity === undefined || card.sensitivity === "normal"
            ? "workspace"
            : card.sensitivity === "secret"
              ? "secret"
              : card.sensitivity === "secret_adjacent"
                ? "secret-adjacent"
                : card.sensitivity === "sensitive"
                  ? "sensitive"
                  : "secret",
        acl: { read: ["operator"] },
        ...(scope ? { scope } : {}),
        retention: {
          policy: "source-coupled",
          ...(card.expiresAt ? { expiresAt: card.expiresAt } : {}),
        },
        updatedAt: card.updatedAt ?? card.createdAt,
      },
      options: this.options,
      evidenceRefs: card.evidence,
    });
  }
}

export class SekbChatKnowledgeSourceAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "sekb" as const;
  constructor(
    private readonly store: KnowledgeStore = new KnowledgeStore(),
    private readonly options: OwnerReadOptions = {},
  ) {}

  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    if (!isSekbEnabled(this.options.cfg)) return denied("not_found");
    try {
      const ids = (
        ref.sourceRef ? [ref.sourceRef.subjectId] : [ref.id, ref.pageId, ref.sourcePath, ref.lookup]
      )
        .filter((id): id is string => Boolean(id))
        .map((id) => id.replace(/^sekb:/, ""));
      const principle = this.store
        .query_principles({ status: null })
        .find(
          (entry) =>
            ids.includes(entry.principle_id) || (!ref.sourceRef && ids.includes(entry.title)),
        );
      if (!principle) return ref.sourceRef ? denied("not_found") : { status: "not_found" };
      return readOwnedBody(ref, {
        owner: this.owner,
        domain: "experience",
        namespaceId: this.store.get_source_namespace_id(),
        subjectId: principle.principle_id,
        revision: principle.updated_at,
        raw: principle.full_content,
        title: principle.title,
        policy: {
          status:
            principle.status === "active"
              ? "active"
              : principle.status === "archived"
                ? "archived"
                : "stale",
          trust: "confirmed",
          sensitivity: "workspace",
          acl: { read: ["operator"] },
          retention: { policy: "source-coupled" },
          updatedAt: principle.updated_at,
        },
        options: this.options,
      });
    } catch {
      return denied("denied");
    }
  }
}

export function createProductionChatKnowledgeSourceAdapters(
  cfg: OpenClawConfig | undefined,
  options: Omit<OwnerReadOptions, "cfg"> = {},
): ChatKnowledgeSourceAdapter[] {
  return [
    new MemoryWikiChatKnowledgeSourceAdapter(cfg, options),
    new NativeMemoryChatKnowledgeSourceAdapter({ ...options, cfg }),
    new RoleMemoryChatKnowledgeSourceAdapter({ ...options, cfg }),
    new SekbChatKnowledgeSourceAdapter(undefined, { ...options, cfg }),
  ];
}

/** Re-read the exact source at model preparation; stale cached bytes never authorize a new use. */
export async function revalidateChatKnowledgeRefs(input: {
  refs: readonly ResolvedChatKnowledgeRef[];
  cfg?: OpenClawConfig;
  identity: MemoryWikiReadIdentity;
  signal?: AbortSignal;
  internalRunId?: string;
}): Promise<ResolvedChatKnowledgeRef[]> {
  const adapters = new Map(
    createProductionChatKnowledgeSourceAdapters(input.cfg, input).map((adapter) => [
      adapter.owner,
      adapter,
    ]),
  );
  const admitted: ResolvedChatKnowledgeRef[] = [];
  for (const previous of input.refs) {
    const snapshot = previous.ownerSnapshot;
    if (!snapshot || input.signal?.aborted) continue;
    const adapter = adapters.get(previous.owner);
    if (!adapter) continue;
    let read: ChatKnowledgeSourceAdapterResult;
    try {
      read = await adapter.resolve({
        id: previous.intentId ?? previous.refId,
        title: previous.title,
        lookup: previous.lookup,
        sourceRef: snapshot.source,
        conflictGroupId: previous.conflictGroupId,
      });
    } catch {
      continue;
    }
    if (read.status !== "resolved" || !read.resolved.ownerSnapshot) continue;
    const fresh = read.resolved.ownerSnapshot;
    if (
      fresh.context.sessionId !== snapshot.context.sessionId ||
      fresh.context.sessionKey !== snapshot.context.sessionKey ||
      fresh.context.workspaceId !== snapshot.context.workspaceId ||
      fresh.context.workspaceRootDigest !== snapshot.context.workspaceRootDigest ||
      fresh.context.agentId !== snapshot.context.agentId ||
      fresh.context.policyDigest !== snapshot.context.policyDigest ||
      evaluateOwnerReadSnapshot(fresh, fresh.context, {
        stage: "prompt",
        providerRef: input.identity.egressProviderRefs?.[0],
        signal: input.signal,
      })
    )
      continue;
    admitted.push(read.resolved);
  }
  const ids = new Set(admitted.map((ref) => ref.intentId ?? ref.refId));
  const deniedGroups = new Set(
    input.refs
      .filter((ref) => ref.conflictGroupId && !ids.has(ref.intentId ?? ref.refId))
      .map((ref) => ref.conflictGroupId),
  );
  return admitted.filter((ref) => !ref.conflictGroupId || !deniedGroups.has(ref.conflictGroupId));
}
