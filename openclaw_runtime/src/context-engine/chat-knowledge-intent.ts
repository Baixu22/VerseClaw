import { createHash } from "node:crypto";

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
};

export type ChatKnowledgeOwner = "memory-wiki" | "memory-slot" | "sekb";

export type ChatKnowledgeDenialReason =
  | "invalid_ref"
  | "unsupported_owner"
  | "not_found"
  | "acl_denied"
  | "sensitive"
  | "stale"
  | "revoked";

export type ChatKnowledgeDenial = {
  id: string;
  title: string;
  lookup: string;
  reason: ChatKnowledgeDenialReason;
  visibleReason: string;
};

export type ResolvedChatKnowledgeRef = {
  refId: string;
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
  resolve(
    ref: ChatKnowledgeReferenceIntent,
  ): Promise<ChatKnowledgeSourceAdapterResult>;
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
    });
    if (out.length >= 8) break;
  }
  return out;
}

function ownerCandidates(ref: ChatKnowledgeReferenceIntent): ChatKnowledgeOwner[] {
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
}): Promise<ChatKnowledgeResolution> {
  const scope = normalizeChatKnowledgeScope(params.scope);
  const mode = normalizeChatKnowledgeMode(params.mode);
  const references = normalizeChatKnowledgeReferences(params.references);
  const admitted: ResolvedChatKnowledgeRef[] = [];
  const denied: ChatKnowledgeDenial[] = [];
  const adaptersByOwner = new Map(params.adapters.map((adapter) => [adapter.owner, adapter]));

  for (const ref of references) {
    if (!ref.lookup && !ref.pageId && !ref.sourcePath) {
      denied.push(denial(ref, "invalid_ref", `Knowledge reference "${ref.id}" has no lookup or page id.`));
      continue;
    }
    const owners = ownerCandidates(ref);
    let resolvedForRef = false;
    for (const owner of owners) {
      const adapter = adaptersByOwner.get(owner);
      if (!adapter) continue;
      let result: ChatKnowledgeSourceAdapterResult;
      try {
        result = await adapter.resolve(ref);
      } catch {
        result = { status: "not_found" };
      }
      if (result.status === "resolved") {
        admitted.push(result.resolved);
        resolvedForRef = true;
        break;
      }
      if (result.status === "denied") {
        denied.push(
          denial(
            ref,
            result.reason,
            result.visibleReason || `Knowledge reference "${ref.title}" was denied (${result.reason}).`,
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

  return { scope, mode, references, admitted, denied };
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
}): ResolvedChatKnowledgeRef {
  const contentDigest = digestChatKnowledgeContent(params.content);
  return {
    refId: `${params.owner}:${params.subjectId}`,
    owner: params.owner,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
    revision: params.revision,
    contentDigest,
    trust: params.trust ?? "advisory",
    sensitivity: params.sensitivity ?? "workspace",
    title: params.title,
    lookup: params.lookup,
    content: params.content,
    materializedAt: params.materializedAt ?? new Date().toISOString(),
    sourceRefs: params.sourceRefs ?? [],
    evidenceRefs: params.evidenceRefs ?? [],
  };
}

/**
 * DCS packer for an admitted ref. The packed block is injected through the
 * dcs-knowledge ContextCandidate channel, never as a raw Main-side prompt edit.
 */
export function packResolvedChatKnowledgeRef(ref: ResolvedChatKnowledgeRef): string {
  const content = ref.content.length > 1200
    ? `${ref.content.slice(0, 1200)}\n...[knowledge ref truncated]`
    : ref.content;
  return [
    `[Knowledge reference: ${ref.title} (${ref.lookup})]`,
    `owner: ${ref.owner}; subjectId: ${ref.subjectId}; revision: ${ref.revision}; digest: ${ref.contentDigest}`,
    "---",
    content,
  ].join("\n");
}

export function emptyChatKnowledgeResolution(
  scope: ChatKnowledgeScope,
  mode: ChatKnowledgeMode,
): ChatKnowledgeResolution {
  return { scope, mode, references: [], admitted: [], denied: [] };
}
