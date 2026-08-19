import { createHash } from "node:crypto";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { getMemoryCard, isMemoryStoreConfigured, isRoleMemoryEnabled } from "../memory/memory-store.js";
import { KnowledgeStore } from "../knowledge/sekb/knowledge-store.js";
import { getMemoryWikiPage } from "../../extensions/memory-wiki/src/query.js";
import {
  resolveMemoryWikiConfig,
  type MemoryWikiPluginConfig,
} from "../../extensions/memory-wiki/src/config.js";
import {
  createResolvedChatKnowledgeRef,
  type ChatKnowledgeReferenceIntent,
  type ChatKnowledgeSourceAdapter,
  type ChatKnowledgeSourceAdapterResult,
  type ResolvedChatKnowledgeRef,
} from "./chat-knowledge-intent.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readMemoryWikiPluginConfig(config: OpenClawConfig | undefined): MemoryWikiPluginConfig | undefined {
  if (!config) return undefined;
  const entries = config.plugins?.entries;
  if (!isRecord(entries)) return undefined;
  const pluginEntry = entries["memory-wiki"];
  if (!isRecord(pluginEntry) || !isRecord(pluginEntry.config)) return undefined;
  return pluginEntry.config as MemoryWikiPluginConfig;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

type WikiGetResult = NonNullable<Awaited<ReturnType<typeof getMemoryWikiPage>>>;

function wikiResultToResolved(
  ref: ChatKnowledgeReferenceIntent,
  result: WikiGetResult,
  now: string,
): ResolvedChatKnowledgeRef {
  const content = result.content ?? "";
  const revision = `sha256:${sha256(content)}`;
  return createResolvedChatKnowledgeRef({
    owner: "memory-wiki",
    subjectKind: "wiki-page",
    subjectId: result.path ?? ref.lookup,
    revision,
    title: result.title ?? ref.title,
    lookup: result.path ?? ref.lookup,
    content,
    trust: "advisory",
    sensitivity: "workspace",
    sourceRefs: [`memory-wiki:${result.path ?? ref.lookup}`],
    evidenceRefs: [],
    materializedAt: now,
  });
}

export class MemoryWikiChatKnowledgeSourceAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "memory-wiki" as const;
  readonly #cfg: OpenClawConfig | undefined;

  constructor(cfg: OpenClawConfig | undefined) {
    this.#cfg = cfg;
  }

  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    const lookup = ref.lookup || ref.pagePath || ref.sourcePath;
    if (!lookup) return { status: "not_found" };
    try {
      const pluginConfig = readMemoryWikiPluginConfig(this.#cfg);
      const resolvedConfig = resolveMemoryWikiConfig(pluginConfig);
      const result = await getMemoryWikiPage({
        config: resolvedConfig,
        appConfig: this.#cfg,
        lookup,
        lineCount: 80,
      });
      if (!result || !result.content) return { status: "not_found" };
      return {
        status: "resolved",
        resolved: wikiResultToResolved(ref, result, new Date().toISOString()),
      };
    } catch {
      return { status: "not_found" };
    }
  }
}

function memoryCardToResolved(
  ref: ChatKnowledgeReferenceIntent,
  card: {
    id: string;
    content: string;
    version: number;
    status: string;
    supersededBy?: string | null;
    sensitivity?: string | null;
  },
  now: string,
): ResolvedChatKnowledgeRef {
  return createResolvedChatKnowledgeRef({
    owner: "memory-slot",
    subjectKind: "memory-card",
    subjectId: card.id,
    revision: String(card.version),
    title: ref.title || card.id,
    lookup: ref.lookup || card.id,
    content: card.content,
    trust: "confirmed",
    sensitivity:
      card.sensitivity === "secret"
        ? "secret"
        : card.sensitivity === "secret_adjacent"
          ? "secret-adjacent"
          : "workspace",
    sourceRefs: [`memory-slot:${card.id}`],
    evidenceRefs: [],
    materializedAt: now,
  });
}

export class RoleMemoryChatKnowledgeSourceAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "memory-slot" as const;

  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    if (!isRoleMemoryEnabled() || !isMemoryStoreConfigured()) {
      return {
        status: "denied",
        reason: "not_found",
        visibleReason: `Role memory is not enabled or configured, so "${ref.title}" cannot be included.`,
      };
    }
    const byId = getMemoryCard(ref.id);
    const card =
      byId ??
      (ref.pageId ? getMemoryCard(ref.pageId) : undefined) ??
      (ref.sourcePath ? getMemoryCard(ref.sourcePath) : undefined) ??
      getMemoryCard(ref.lookup);
    if (!card) {
      return {
        status: "denied",
        reason: "not_found",
        visibleReason: `Role memory reference "${ref.title}" could not be found.`,
      };
    }
    if (card.status !== "active") {
      return {
        status: "denied",
        reason: card.status === "tombstone" || card.status === "archived" ? "revoked" : "stale",
        visibleReason: `Role memory reference "${ref.title}" is ${card.status} and cannot be included.`,
      };
    }
    if (card.sensitivity === "secret" || card.sensitivity === "secret_adjacent") {
      return {
        status: "denied",
        reason: "sensitive",
        visibleReason: `Role memory reference "${ref.title}" is ${card.sensitivity} and cannot be injected into chat context.`,
      };
    }
    return {
      status: "resolved",
      resolved: memoryCardToResolved(
        ref,
        {
          id: card.id,
          content: card.content,
          version: card.version,
          status: card.status,
          supersededBy: card.supersededBy,
          sensitivity: card.sensitivity,
        },
        new Date().toISOString(),
      ),
    };
  }
}

function sekbPrincipleToResolved(
  ref: ChatKnowledgeReferenceIntent,
  principle: {
    principle_id: string;
    updated_at: string;
    title: string;
    full_content: string;
    status: string;
  },
  now: string,
): ResolvedChatKnowledgeRef {
  const revision = principle.updated_at || now;
  return createResolvedChatKnowledgeRef({
    owner: "sekb",
    subjectKind: "experience-principle",
    subjectId: principle.principle_id,
    revision,
    title: principle.title || ref.title,
    lookup: ref.lookup || principle.principle_id,
    content: principle.full_content,
    trust: "confirmed",
    sensitivity: "workspace",
    sourceRefs: [`sekb:${principle.principle_id}`],
    evidenceRefs: [],
    materializedAt: now,
  });
}

export class SekbChatKnowledgeSourceAdapter implements ChatKnowledgeSourceAdapter {
  readonly owner = "sekb" as const;
  readonly #store: KnowledgeStore;

  constructor(store?: KnowledgeStore) {
    this.#store = store ?? new KnowledgeStore();
  }

  async resolve(ref: ChatKnowledgeReferenceIntent): Promise<ChatKnowledgeSourceAdapterResult> {
    try {
      const candidates = [ref.id, ref.pageId, ref.sourcePath, ref.lookup].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      for (const candidate of candidates) {
        const principle = this.#store.query_principles({ status: "active" }).find(
          (entry) =>
            entry.principle_id === candidate ||
            entry.title === candidate ||
            entry.full_content.includes(candidate),
        );
        if (principle) {
          return {
            status: "resolved",
            resolved: sekbPrincipleToResolved(ref, principle, new Date().toISOString()),
          };
        }
        // Also check non-active so we can report revoked instead of not_found.
        const existing = this.#store.query_principles({ status: null }).find(
          (entry) =>
            entry.principle_id === candidate ||
            entry.title === candidate,
        );
        if (existing && existing.status !== "active") {
          return {
            status: "denied",
            reason: existing.status === "archived" ? "revoked" : "stale",
            visibleReason: `SEKB experience reference "${ref.title}" is ${existing.status} and cannot be included.`,
          };
        }
      }
      return { status: "not_found" };
    } catch {
      return { status: "not_found" };
    }
  }
}

/** Production owner source adapters for the Chat/DCS single consumption path. */
export function createProductionChatKnowledgeSourceAdapters(
  cfg: OpenClawConfig | undefined,
): ChatKnowledgeSourceAdapter[] {
  return [
    new MemoryWikiChatKnowledgeSourceAdapter(cfg),
    new RoleMemoryChatKnowledgeSourceAdapter(),
    new SekbChatKnowledgeSourceAdapter(),
  ];
}
