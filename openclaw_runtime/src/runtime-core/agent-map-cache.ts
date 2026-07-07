import type { AgentMapLanguage, AgentMapSourceFile, AgentMapTag } from "./agent-map.js";

export type AgentMapCacheOptions = {
  maxEntries?: number;
};

export type AgentMapCacheStats = {
  readonly: true;
  discardable: true;
  entryCount: number;
  hitCount: number;
  missCount: number;
  maxEntries: number;
  keyKind: "path+language+content-hash";
  contentHashAlgorithm: "fnv1a-32";
};

export type AgentMapCache = {
  readonly readonly: true;
  readonly discardable: true;
  getTags(source: AgentMapSourceFile): AgentMapTag[] | undefined;
  setTags(source: AgentMapSourceFile, tags: readonly AgentMapTag[]): void;
  stats(): AgentMapCacheStats;
  clear(): void;
};

const DEFAULT_AGENT_MAP_CACHE_MAX_ENTRIES = 128;

export function createAgentMapCache(
  options: AgentMapCacheOptions = {},
): AgentMapCache {
  const maxEntries = normalizeAgentMapCacheMaxEntries(options.maxEntries);
  const entries = new Map<string, AgentMapTag[]>();
  let hitCount = 0;
  let missCount = 0;

  return {
    readonly: true,
    discardable: true,
    getTags(source) {
      const key = agentMapCacheKeyForSource(source);
      if (!entries.has(key)) {
        missCount += 1;
        return undefined;
      }
      const tags = entries.get(key) ?? [];
      entries.delete(key);
      entries.set(key, tags);
      hitCount += 1;
      return cloneAgentMapTags(tags);
    },
    setTags(source, tags) {
      const key = agentMapCacheKeyForSource(source);
      entries.set(key, cloneAgentMapTags(tags));
      evictOldestAgentMapCacheEntries(entries, maxEntries);
    },
    stats() {
      return {
        readonly: true,
        discardable: true,
        entryCount: entries.size,
        hitCount,
        missCount,
        maxEntries,
        keyKind: "path+language+content-hash",
        contentHashAlgorithm: "fnv1a-32",
      };
    },
    clear() {
      entries.clear();
      hitCount = 0;
      missCount = 0;
    },
  };
}

function normalizeAgentMapCacheMaxEntries(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AGENT_MAP_CACHE_MAX_ENTRIES;
  }
  return Math.max(1, Math.floor(Number(value)));
}

function agentMapCacheKeyForSource(source: AgentMapSourceFile): string {
  const normalized = normalizeAgentMapCacheSource(source);
  return [
    normalized.file,
    normalized.language,
    normalized.content.length,
    agentMapContentHash(normalized.content),
  ].join("\0");
}

function normalizeAgentMapCacheSource(source: AgentMapSourceFile): Required<
  Pick<AgentMapSourceFile, "file" | "content" | "language">
> {
  const file = normalizeAgentMapCachePath(source.file);
  return {
    file,
    language: source.language ?? inferAgentMapCacheLanguage(file),
    content: source.content.replace(/\r\n/g, "\n"),
  };
}

function normalizeAgentMapCachePath(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//u, "");
}

function inferAgentMapCacheLanguage(file: string): AgentMapLanguage {
  const lower = normalizeAgentMapCachePath(file).toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js")) return "javascript";
  return "unknown";
}

function agentMapContentHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function evictOldestAgentMapCacheEntries(
  entries: Map<string, AgentMapTag[]>,
  maxEntries: number,
): void {
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next();
    if (oldest.done) {
      return;
    }
    entries.delete(oldest.value);
  }
}

function cloneAgentMapTags(tags: readonly AgentMapTag[]): AgentMapTag[] {
  return [...tags];
}
