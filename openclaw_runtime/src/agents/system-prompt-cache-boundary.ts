/**
 * System prompt cache-boundary helpers.
 *
 * Keeps stable prompt prefixes separate from dynamic runtime additions for provider prompt caching.
 */
import { normalizeStructuredPromptSection } from "./prompt-cache-stability.js";

export const SYSTEM_PROMPT_CACHE_BOUNDARY = "\n<!-- OPENCLAW_CACHE_BOUNDARY -->\n";

export function stripSystemPromptCacheBoundary(text: string): string {
  return text.replaceAll(SYSTEM_PROMPT_CACHE_BOUNDARY, "\n");
}

// Append the cache boundary when a prompt has none (e.g. a hook systemPrompt override),
// so dynamic additions route into an uncached suffix instead of the cached prefix (#85203).
export function ensureSystemPromptCacheBoundary(systemPrompt: string): string {
  if (systemPrompt.trim().length === 0) {
    return systemPrompt;
  }
  return systemPrompt.includes(SYSTEM_PROMPT_CACHE_BOUNDARY)
    ? systemPrompt
    : `${systemPrompt}${SYSTEM_PROMPT_CACHE_BOUNDARY}`;
}

export function splitSystemPromptCacheBoundary(
  text: string,
): { stablePrefix: string; dynamicSuffix: string } | undefined {
  const boundaryIndex = text.indexOf(SYSTEM_PROMPT_CACHE_BOUNDARY);
  if (boundaryIndex === -1) {
    return undefined;
  }
  return {
    stablePrefix: text.slice(0, boundaryIndex).trimEnd(),
    dynamicSuffix: text.slice(boundaryIndex + SYSTEM_PROMPT_CACHE_BOUNDARY.length).trimStart(),
  };
}

/**
 * Structural projection of a boundary-bearing prompt for a protocol that has no
 * breakpoint concept to spend the marker on (OpenAI implicit prefix caching, Google,
 * Bedrock). The marker is dropped instead of shipped, and the stable prefix stays
 * byte-identical across turns so it can keep hitting the provider cache.
 */
export function joinSystemPromptWithoutCacheBoundary(systemPrompt: string): string {
  const split = splitSystemPromptCacheBoundary(systemPrompt);
  if (!split) {
    return systemPrompt;
  }
  return split.dynamicSuffix ? `${split.stablePrefix}\n\n${split.dynamicSuffix}` : split.stablePrefix;
}

/**
 * Thrown when a built outbound payload still carries the internal cache-boundary
 * marker. Fail-closed on purpose: shipping the marker perturbs the provider cache
 * prefix (and leaks an internal convention), so the request must fail instead.
 */
export class OutboundCacheBoundaryLeakError extends Error {
  readonly source: string;
  readonly paths: readonly string[];

  constructor(source: string, paths: readonly string[]) {
    super(
      `Outbound payload for ${source} still contains the prompt cache boundary marker at: ${paths.join(", ")}`,
    );
    this.name = "OutboundCacheBoundaryLeakError";
    this.source = source;
    this.paths = paths;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Collects the JSON paths of every string carrying the marker. */
function collectBoundaryLeakPaths(value: unknown, path: string, found: string[]): void {
  if (typeof value === "string") {
    if (value.includes(SYSTEM_PROMPT_CACHE_BOUNDARY)) {
      found.push(path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectBoundaryLeakPaths(entry, `${path}[${index}]`, found));
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const entryPath = path ? `${path}.${key}` : key;
      // Keys are serialized too, and rewriting a key would change payload semantics, so
      // a key-borne marker is detected rather than scrubbed (see the scrubber).
      if (key.includes(SYSTEM_PROMPT_CACHE_BOUNDARY)) {
        found.push(`${entryPath} (object key)`);
      }
      collectBoundaryLeakPaths(entry, entryPath, found);
    }
  }
}

/** Reports whether a payload graph still carries the marker, with diagnostic paths. */
export function findSystemPromptCacheBoundaryLeaks(payload: unknown): string[] {
  const found: string[] = [];
  collectBoundaryLeakPaths(payload, "", found);
  return found;
}

function scrubBoundaryFromStrings(value: unknown, counter: { removed: number }): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const entry = value[index];
      if (typeof entry === "string") {
        if (entry.includes(SYSTEM_PROMPT_CACHE_BOUNDARY)) {
          counter.removed += entry.split(SYSTEM_PROMPT_CACHE_BOUNDARY).length - 1;
          value[index] = stripSystemPromptCacheBoundary(entry);
        }
        continue;
      }
      scrubBoundaryFromStrings(entry, counter);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      if (entry.includes(SYSTEM_PROMPT_CACHE_BOUNDARY)) {
        counter.removed += entry.split(SYSTEM_PROMPT_CACHE_BOUNDARY).length - 1;
        value[key] = stripSystemPromptCacheBoundary(entry);
      }
      continue;
    }
    scrubBoundaryFromStrings(entry, counter);
  }
}

/**
 * Safety net for every outbound payload builder: scrub the marker from all text
 * fields, then verify. A marker that survives scrubbing is a builder bug the layer
 * cannot repair, so the call throws instead of shipping the leak.
 */
export function enforceNoOutboundCacheBoundary(payload: unknown, source: string): number {
  const counter = { removed: 0 };
  scrubBoundaryFromStrings(payload, counter);
  const leaks = findSystemPromptCacheBoundaryLeaks(payload);
  if (leaks.length > 0) {
    throw new OutboundCacheBoundaryLeakError(source, leaks);
  }
  return counter.removed;
}

export function prependSystemPromptAdditionAfterCacheBoundary(params: {
  systemPrompt: string;
  systemPromptAddition?: string;
}): string {
  const systemPromptAddition =
    typeof params.systemPromptAddition === "string"
      ? normalizeStructuredPromptSection(params.systemPromptAddition)
      : "";
  if (!systemPromptAddition) {
    return params.systemPrompt;
  }
  if (params.systemPrompt.trim().length === 0) {
    return systemPromptAddition;
  }

  const split = splitSystemPromptCacheBoundary(params.systemPrompt);
  if (!split) {
    return `${systemPromptAddition}\n\n${params.systemPrompt}`;
  }

  const dynamicSuffix = split.dynamicSuffix
    ? normalizeStructuredPromptSection(split.dynamicSuffix)
    : "";
  if (!dynamicSuffix) {
    return `${split.stablePrefix}${SYSTEM_PROMPT_CACHE_BOUNDARY}${systemPromptAddition}`;
  }

  return `${split.stablePrefix}${SYSTEM_PROMPT_CACHE_BOUNDARY}${systemPromptAddition}\n\n${dynamicSuffix}`;
}
