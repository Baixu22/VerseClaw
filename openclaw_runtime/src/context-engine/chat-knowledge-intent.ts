import { createHash } from "node:crypto";
import {
  evaluateOwnerReadSnapshot,
  normalizeSourceRefV2,
  type OwnerReadRejectionCode,
  type OwnerReadSnapshotV1,
  type SourceRefV2,
} from "../runtime-core/knowledge-owner-read.js";

export type ChatKnowledgeScope = "none" | "memory" | "wiki" | "all";
export type ChatKnowledgeMode = "manual" | "suggest" | "auto-read";

/**
 * Typed reference sent by the renderer. This is an untrusted retrieval intent:
 * it never carries page content and Main never materializes it into the prompt.
 */
export type ChatKnowledgeReferenceIntent = {
  id: string;
  title: string;
  lookup: string;
  corpus?: "wiki" | "memory" | "all";
  pageId?: string;
  pagePath?: string;
  sourcePath?: string;
  attachKind?: "manual" | "suggested" | "auto";
  routingReason?: string;
  confidence?: number;
  freshnessLevel?: string;
  matchedClaimStatus?: string;
  sourceRef?: SourceRefV2;
  revision?: string;
  contentDigest?: string;
  /** Packing constraint only; grouping never grants a source read. */
  conflictGroupId?: string;
  invalidPin?: boolean;
};

export type ChatKnowledgeOwner = "memory-wiki" | "memory-slot" | "sekb";

export type ChatKnowledgeDenialReason =
  | "invalid_ref"
  | "unsupported_owner"
  | OwnerReadRejectionCode;

export type ChatKnowledgeDenial = {
  id: string;
  title: string;
  lookup: string;
  reason: ChatKnowledgeDenialReason;
  visibleReason: string;
};

export type ResolvedChatKnowledgeRef = {
  refId: string;
  intentId?: string;
  owner: ChatKnowledgeOwner;
  subjectKind: "wiki-page" | "memory-card" | "experience-principle";
  subjectId: string;
  revision: string;
  contentDigest: string;
  trust: "untrusted" | "advisory" | "confirmed" | "high-trust";
  sensitivity: "public" | "workspace" | "sensitive" | "secret-adjacent" | "secret";
  title: string;
  lookup: string;
  content: string;
  materializedAt: string;
  sourceRefs: string[];
  evidenceRefs: string[];
  ownerSnapshot?: OwnerReadSnapshotV1;
  conflictGroupId?: string;
};

export type ChatKnowledgeSourceAdapterResult =
  | { status: "resolved"; resolved: ResolvedChatKnowledgeRef }
  | {
      status: "denied";
      reason: Exclude<ChatKnowledgeDenialReason, "invalid_ref" | "unsupported_owner">;
      visibleReason: string;
    }
  | { status: "not_found" };

export interface ChatKnowledgeSourceAdapter {
  readonly owner: ChatKnowledgeOwner;
  resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult>;
}

export type ChatKnowledgeResolution = {
  scope: ChatKnowledgeScope;
  mode: ChatKnowledgeMode;
  references: ChatKnowledgeReferenceIntent[];
  admitted: ResolvedChatKnowledgeRef[];
  denied: ChatKnowledgeDenial[];
};

export function normalizeChatKnowledgeScope(value: unknown): ChatKnowledgeScope {
  return value === "memory" || value === "wiki" || value === "all" ? value : "none";
}

export function normalizeChatKnowledgeMode(value: unknown): ChatKnowledgeMode {
  return value === "manual" || value === "auto-read" ? value : "suggest";
}

function cleanString(value: unknown, maxLength = 400): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined;
}

/**
 * Renderer refs are untrusted. Only typed fields survive; snippets/content
 * fields are deliberately dropped so the renderer cannot smuggle trusted body
 * text into the prompt.
 */
export function normalizeChatKnowledgeReferences(value: unknown): ChatKnowledgeReferenceIntent[] {
  if (!Array.isArray(value)) return [];
  const out: ChatKnowledgeReferenceIntent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const lookup = cleanString(record.lookup);
    if (!lookup) continue;
    const id = cleanString(record.id) ?? lookup;
    const title = cleanString(record.title) ?? lookup;
    const corpus =
      record.corpus === "memory" || record.corpus === "all" || record.corpus === "wiki"
        ? record.corpus
        : undefined;
    const pageId = cleanString(record.pageId);
    const pagePath = cleanString(record.pagePath);
    const sourcePath = cleanString(record.sourcePath);
    const attachKind =
      record.attachKind === "suggested" || record.attachKind === "auto"
        ? record.attachKind
        : record.attachKind === "manual"
          ? "manual"
          : undefined;
    const routingReason = cleanString(record.routingReason);
    const confidence =
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : undefined;
    const freshnessLevel = cleanString(record.freshnessLevel);
    const matchedClaimStatus = cleanString(record.matchedClaimStatus);
    const sourceRef = normalizeSourceRefV2(record.sourceRef);
    const revision = cleanString(record.revision);
    const contentDigest = cleanString(record.contentDigest);
    const conflictGroupId = cleanString(record.conflictGroupId);
    const invalidPin =
      (record.sourceRef !== undefined && !sourceRef) ||
      (record.revision !== undefined && !revision) ||
      (record.contentDigest !== undefined &&
        (!contentDigest || !/^sha256:[a-f0-9]{64}$/.test(contentDigest)));
    out.push({
      id,
      title,
      lookup,
      ...(corpus ? { corpus } : {}),
      ...(pageId ? { pageId } : {}),
      ...(pagePath ? { pagePath } : {}),
      ...(sourcePath ? { sourcePath } : {}),
      ...(attachKind ? { attachKind } : {}),
      ...(routingReason ? { routingReason } : {}),
      ...(typeof confidence === "number" ? { confidence } : {}),
      ...(freshnessLevel ? { freshnessLevel } : {}),
      ...(matchedClaimStatus ? { matchedClaimStatus } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      ...(revision ? { revision } : {}),
      ...(contentDigest ? { contentDigest } : {}),
      ...(conflictGroupId ? { conflictGroupId } : {}),
      ...(invalidPin ? { invalidPin: true } : {}),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function ownerCandidates(ref: ChatKnowledgeReferenceIntent): ChatKnowledgeOwner[] {
  if (ref.sourceRef) {
    const owner = ref.sourceRef.authorityId;
    if (owner !== "memory-wiki" && owner !== "memory-slot" && owner !== "sekb") return [];
    if (
      (ref.corpus === "wiki" && owner !== "memory-wiki") ||
      (ref.corpus === "memory" && owner !== "memory-slot")
    )
      return [];
    return [owner];
  }
  if (ref.corpus === "memory") return ["memory-slot"];
  if (ref.corpus === "wiki") return ["memory-wiki"];
  // Explicit pinned refs from the Knowledge Hub may not carry a corpus yet.
  if (ref.corpus === "all") return ["memory-wiki", "memory-slot", "sekb"];
  return ["memory-wiki", "memory-slot", "sekb"];
}

function denial(
  ref: ChatKnowledgeReferenceIntent,
  reason: ChatKnowledgeDenialReason,
  visibleReason: string,
): ChatKnowledgeDenial {
  return { id: ref.id, title: ref.title, lookup: ref.lookup, reason, visibleReason };
}

export async function resolveChatKnowledgeIntent(params: {
  scope?: unknown;
  mode?: unknown;
  references?: unknown;
  adapters: readonly ChatKnowledgeSourceAdapter[];
  signal?: AbortSignal;
}): Promise<ChatKnowledgeResolution> {
  const scope = normalizeChatKnowledgeScope(params.scope);
  const mode = normalizeChatKnowledgeMode(params.mode);
  const references = normalizeChatKnowledgeReferences(params.references);
  const admitted: ResolvedChatKnowledgeRef[] = [];
  const denied: ChatKnowledgeDenial[] = [];
  const adaptersByOwner = new Map(params.adapters.map((adapter) => [adapter.owner, adapter]));

  for (const ref of references) {
    if (params.signal?.aborted || ref.invalidPin) {
      denied.push(
        denial(
          ref,
          params.signal?.aborted ? "cancelled" : "invalid_ref",
          "Knowledge read was cancelled or its pin is invalid.",
        ),
      );
      continue;
    }
    if (!ref.lookup && !ref.pageId && !ref.sourcePath) {
      denied.push(
        denial(ref, "invalid_ref", `Knowledge reference "${ref.id}" has no lookup or page id.`),
      );
      continue;
    }
    const owners = ownerCandidates(ref);
    if (!owners.length) {
      denied.push(
        denial(
          ref,
          "unsupported_owner",
          "Knowledge reference owner does not match the selected corpus.",
        ),
      );
      continue;
    }
    let resolvedForRef = false;
    for (const owner of owners) {
      const adapter = adaptersByOwner.get(owner);
      if (!adapter) continue;
      let result: ChatKnowledgeSourceAdapterResult;
      try {
        if (!params.signal) result = await adapter.resolve(ref);
        else
          result = await new Promise<ChatKnowledgeSourceAdapterResult>((resolve) => {
            const signal = params.signal!;
            const cancelled = () =>
              resolve({
                status: "denied",
                reason: "cancelled",
                visibleReason: "Knowledge read was cancelled.",
              });
            signal.addEventListener("abort", cancelled, { once: true });
            if (signal.aborted) {
              cancelled();
              return;
            }
            Promise.resolve()
              .then(() =>
                signal.aborted
                  ? ({
                      status: "denied",
                      reason: "cancelled",
                      visibleReason: "Knowledge read was cancelled.",
                    } as ChatKnowledgeSourceAdapterResult)
                  : adapter.resolve(ref),
              )
              .then(
                (value) => {
                  signal.removeEventListener("abort", cancelled);
                  resolve(
                    signal.aborted
                      ? {
                          status: "denied",
                          reason: "cancelled",
                          visibleReason: "Knowledge read was cancelled.",
                        }
                      : value,
                  );
                },
                () => {
                  signal.removeEventListener("abort", cancelled);
                  resolve({
                    status: "denied",
                    reason: "denied",
                    visibleReason: "Knowledge owner read failed.",
                  });
                },
              );
          });
      } catch {
        result = ref.sourceRef
          ? {
              status: "denied",
              reason: "denied",
              visibleReason: "Pinned knowledge owner read failed.",
            }
          : { status: "not_found" };
      }
      if (result.status === "resolved") {
        if (
          ref.attachKind === "auto" &&
          (!result.resolved.ownerSnapshot ||
            !["confirmed", "high-trust"].includes(result.resolved.ownerSnapshot.policy.trust) ||
            !Number.isFinite(Date.parse(result.resolved.ownerSnapshot.policy.verifiedAt ?? "")))
        ) {
          denied.push(
            denial(
              ref,
              "stale",
              "Automatic knowledge read requires current owner confirmation and known freshness.",
            ),
          );
          resolvedForRef = true;
          break;
        }
        admitted.push(result.resolved);
        resolvedForRef = true;
        break;
      }
      if (result.status === "denied") {
        denied.push(
          denial(
            ref,
            result.reason,
            result.visibleReason ||
              `Knowledge reference "${ref.title}" was denied (${result.reason}).`,
          ),
        );
        resolvedForRef = true;
        break;
      }
      // not_found: continue to the next candidate owner for corpus "all" / unset.
      if (owners.length === 1) {
        denied.push(
          denial(
            ref,
            "not_found",
            `Knowledge reference "${ref.title}" could not be resolved by ${owner}.`,
          ),
        );
        resolvedForRef = true;
        break;
      }
    }
    if (!resolvedForRef) {
      denied.push(
        denial(
          ref,
          "not_found",
          `Knowledge reference "${ref.title}" could not be resolved by any registered owner adapter.`,
        ),
      );
    }
  }

  const deniedIds = new Set(denied.map((ref) => ref.id));
  const deniedGroups = new Set(
    references
      .filter((ref) => ref.conflictGroupId && deniedIds.has(ref.id))
      .map((ref) => ref.conflictGroupId),
  );
  const complete = admitted.filter((ref) => {
    if (!ref.conflictGroupId || !deniedGroups.has(ref.conflictGroupId)) return true;
    const original = references.find((candidate) => candidate.id === ref.intentId);
    if (original)
      denied.push(denial(original, "denied", "A conflict group could not be read as a whole."));
    return false;
  });
  return { scope, mode, references, admitted: complete, denied };
}

export function digestChatKnowledgeContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function createResolvedChatKnowledgeRef(params: {
  owner: ChatKnowledgeOwner;
  subjectKind: ResolvedChatKnowledgeRef["subjectKind"];
  subjectId: string;
  revision: string;
  title: string;
  lookup: string;
  content: string;
  trust?: ResolvedChatKnowledgeRef["trust"];
  sensitivity?: ResolvedChatKnowledgeRef["sensitivity"];
  sourceRefs?: string[];
  evidenceRefs?: string[];
  materializedAt?: string;
  ownerSnapshot?: OwnerReadSnapshotV1;
  intentId?: string;
  conflictGroupId?: string;
}): ResolvedChatKnowledgeRef {
  const snapshot = params.ownerSnapshot;
  const content = snapshot?.content ?? params.content;
  const contentDigest = digestChatKnowledgeContent(content);
  if (snapshot && snapshot.source.authorityId !== params.owner)
    throw new Error("Knowledge snapshot owner mismatch");
  return {
    ...(params.intentId ? { intentId: params.intentId } : {}),
    ...(params.conflictGroupId ? { conflictGroupId: params.conflictGroupId } : {}),
    refId: snapshot
      ? `${params.owner}:${digestChatKnowledgeContent(JSON.stringify([snapshot.source.namespaceId, snapshot.source.subjectId, snapshot.source.locator])).slice(7, 39)}`
      : `${params.owner}:${params.subjectId}`,
    owner: params.owner,
    subjectKind: params.subjectKind,
    subjectId: snapshot?.source.subjectId ?? params.subjectId,
    revision: snapshot?.source.revision ?? params.revision,
    contentDigest,
    trust: snapshot?.policy.trust ?? params.trust ?? "advisory",
    sensitivity: snapshot?.policy.sensitivity ?? params.sensitivity ?? "workspace",
    title: snapshot?.title ?? params.title,
    lookup: params.lookup,
    content,
    materializedAt: params.materializedAt ?? new Date().toISOString(),
    sourceRefs: params.sourceRefs ?? [],
    evidenceRefs: params.evidenceRefs ?? [],
    ...(snapshot ? { ownerSnapshot: snapshot } : {}),
  };
}

/**
 * DCS packer for an admitted ref. The packed block is injected through the
 * dcs-knowledge ContextCandidate channel, never as a raw Main-side prompt edit.
 */
export function packResolvedChatKnowledgeRef(ref: ResolvedChatKnowledgeRef): string {
  if (
    ref.ownerSnapshot &&
    (evaluateOwnerReadSnapshot(ref.ownerSnapshot, ref.ownerSnapshot.context) ||
      ref.content !== ref.ownerSnapshot.content ||
      ref.contentDigest !== ref.ownerSnapshot.contentDigest)
  )
    throw new Error("Knowledge snapshot is no longer admitted");
  return [
    `[Knowledge reference: ${ref.title} (${ref.lookup})]`,
    "refId: " + (ref.intentId ?? ref.refId),
    `owner: ${ref.owner}; subjectId: ${ref.subjectId}; revision: ${ref.revision}; digest: ${ref.contentDigest}`,
    ...(ref.ownerSnapshot ? [`source: ${JSON.stringify(ref.ownerSnapshot.source)}`] : []),
    "---",
    ref.content,
  ].join("\n");
}

export function emptyChatKnowledgeResolution(
  scope: ChatKnowledgeScope,
  mode: ChatKnowledgeMode,
): ChatKnowledgeResolution {
  return { scope, mode, references: [], admitted: [], denied: [] };
}
