/**
 * Bounded ContextHandle expansion (context-folding-rlm CF-02 / TF-0692).
 *
 * One read surface behind the `context_expand` tool: scope check, freshness
 * check, owner resolution, checksum verification, then a bounded excerpt,
 * search or aggregate. Every refusal is a named diagnostic; nothing falls back
 * to another session, workspace or owner. Owners wired in this phase are
 * `workspace-file`, `block-store` and `context-archive`; the remaining owners
 * answer `owner_unavailable` instead of pretending.
 *
 * A handle is a read reference only. Resolving one never writes, never grants
 * tools and never touches Task Ledger, Memory or Knowledge (R3/R5).
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { BlockStoreApi, ContextBlock } from "../block.js";
import { verifyContextArchiveHandle } from "../registry/context-item-registry.js";
import { normalizeArchiveHandle } from "../../../../shared/types/context-item.js";
import {
  CONTEXT_FOLDING_LIMITS,
  checkContextHandleScope,
  contextChecksum,
  createContextExpandFailure,
  createContextHandle,
  evidenceRefForHandle,
  isContextFreshnessExpired,
  normalizeContextExpandRequest,
  normalizeContextExpandResult,
  selectorToText,
  type ContextDiagnostic,
  type ContextExpandAggregate,
  type ContextExpandMode,
  type ContextExpandRequest,
  type ContextExpandResult,
  type ContextFreshness,
  type ContextHandle,
  type ContextHandleOwner,
  type ContextHashFn,
  type ContextRequesterIdentity,
  type ContextSelector,
} from "../../../../shared/types/context-folding.js";

export const contextFoldingHash: ContextHashFn = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Largest owner resource the resolver will read before refusing with limit_exceeded. */
export const CONTEXT_EXPAND_MAX_RESOURCE_CHARS = 4 * 1024 * 1024;
export const BLOCK_RESOURCE_PREFIX = "block:";

export type ContextResourceRef = {
  owner: ContextHandleOwner;
  resourceId: string;
  selector?: ContextSelector;
  label?: string;
};

export type ContextExpandDeps = {
  requester: ContextRequesterIdentity;
  blockStore?: Pick<BlockStoreApi, "query">;
  workspaceRoot?: string;
  verifyArchive?: typeof verifyContextArchiveHandle;
  now?: () => string;
  hash?: ContextHashFn;
};

export type ContextExpandEvent = {
  type: "context_expand";
  handleId: string;
  owner: ContextHandleOwner;
  resourceId: string;
  mode: ContextExpandMode;
  ok: boolean;
  charCount: number;
  byteCount: number;
  truncated: boolean;
  diagnosticCodes: string[];
  at: string;
};

type ResolvedResource =
  | { ok: true; content: string; revision: string; sourceSessionId?: string }
  | { ok: false; diagnostic: ContextDiagnostic };

type SlicedRegion =
  | { ok: true; region: string }
  | { ok: false; diagnostic: ContextDiagnostic };

type MintOutcome =
  | { ok: true; handle: ContextHandle }
  | { ok: false; diagnostic: ContextDiagnostic };

const GLOB_CHARS = /[*?[\]{}]/;

function diagnostic(code: ContextDiagnostic["code"], message: string, detail?: Record<string, unknown>): ContextDiagnostic {
  return { code, message, ...(detail ? { detail } : {}) };
}

function nowIso(deps: ContextExpandDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

function hashOf(deps: ContextExpandDeps): ContextHashFn {
  return deps.hash ?? contextFoldingHash;
}

function resolveWorkspaceFile(resourceId: string, deps: ContextExpandDeps): ResolvedResource {
  const root = deps.workspaceRoot?.trim();
  if (!root) {
    return { ok: false, diagnostic: diagnostic("owner_unavailable", "No workspace root is bound to this session; workspace-file handles cannot be resolved.") };
  }
  if (GLOB_CHARS.test(resourceId)) {
    return { ok: false, diagnostic: diagnostic("ambiguous_selector", "A workspace-file resource must name exactly one file; glob characters are not a selector.", { resourceId }) };
  }
  const normalized = resourceId.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((segment) => segment === "..")) {
    return { ok: false, diagnostic: diagnostic("scope_violation", "A workspace-file resource must be a workspace-relative path without parent traversal.", { resourceId }) };
  }
  const rootResolved = path.resolve(root);
  const fileResolved = path.resolve(rootResolved, normalized);
  const relative = path.relative(rootResolved, fileResolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, diagnostic: diagnostic("scope_violation", "Resolved path escapes the workspace root.", { resourceId }) };
  }
  let stats;
  try {
    stats = statSync(fileResolved);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ok: false, diagnostic: diagnostic("missing_resource", "Workspace file does not exist.", { resourceId }) };
    }
    return { ok: false, diagnostic: diagnostic("owner_unavailable", `Workspace file could not be read: ${error instanceof Error ? error.message : String(error)}`, { resourceId }) };
  }
  if (stats.isDirectory()) {
    return { ok: false, diagnostic: diagnostic("ambiguous_selector", "A directory does not resolve to one resource.", { resourceId }) };
  }
  if (stats.size > CONTEXT_EXPAND_MAX_RESOURCE_CHARS) {
    return { ok: false, diagnostic: diagnostic("limit_exceeded", `Workspace file is ${stats.size} bytes; the resolver reads at most ${CONTEXT_EXPAND_MAX_RESOURCE_CHARS}.`, { resourceId, bytes: stats.size }) };
  }
  let content: string;
  try {
    content = readFileSync(fileResolved, "utf8");
  } catch (error) {
    return { ok: false, diagnostic: diagnostic("owner_unavailable", `Workspace file could not be read: ${error instanceof Error ? error.message : String(error)}`, { resourceId }) };
  }
  return { ok: true, content, revision: `mtime:${Math.floor(stats.mtimeMs)};size:${stats.size}` };
}

async function resolveBlock(
  resourceId: string,
  scopeSessionId: string,
  deps: ContextExpandDeps,
): Promise<ResolvedResource> {
  if (!deps.blockStore) {
    return { ok: false, diagnostic: diagnostic("owner_unavailable", "No block store is bound to this session; block-store handles cannot be resolved.") };
  }
  if (!resourceId.startsWith(BLOCK_RESOURCE_PREFIX) || resourceId.length <= BLOCK_RESOURCE_PREFIX.length) {
    return { ok: false, diagnostic: diagnostic("missing_resource", `A block-store resource id must look like ${BLOCK_RESOURCE_PREFIX}<block_id>.`, { resourceId }) };
  }
  const blockId = resourceId.slice(BLOCK_RESOURCE_PREFIX.length);
  let blocks: ContextBlock[];
  try {
    // Authorization stays inside BlockStore.query (requester + direct-parent rules);
    // the requester is the handle's own session, never a looked-up alias.
    blocks = await deps.blockStore.query({
      requester_session_id: deps.requester.sessionId,
      session_id: scopeSessionId,
      include_global: true,
      limit: 500,
    });
  } catch (error) {
    return { ok: false, diagnostic: diagnostic("owner_unavailable", `Block store query failed: ${error instanceof Error ? error.message : String(error)}`) };
  }
  const matches = blocks.filter((block) => block.block_id === blockId);
  if (matches.length === 0) {
    return { ok: false, diagnostic: diagnostic("missing_resource", "Block is not visible to this session (missing, invalidated or owned elsewhere).", { resourceId }) };
  }
  if (matches.length > 1) {
    return { ok: false, diagnostic: diagnostic("ambiguous_selector", "Block id resolves to more than one visible block.", { resourceId, candidates: matches.length }) };
  }
  const block = matches[0]!;
  return { ok: true, content: block.full_content ?? block.summary ?? "", revision: blockRevision(block) };
}

function blockRevision(block: ContextBlock): string {
  const validAt = block.valid_at instanceof Date ? block.valid_at.toISOString() : String(block.valid_at);
  return `valid_at:${validAt}`;
}

async function resolveArchive(resourceId: string, checksum: string, deps: ContextExpandDeps): Promise<ResolvedResource> {
  const verify = deps.verifyArchive ?? verifyContextArchiveHandle;
  let handle;
  try {
    handle = normalizeArchiveHandle({ uri: resourceId, checksum, byteLength: 0 });
  } catch (error) {
    return { ok: false, diagnostic: diagnostic("missing_resource", `Invalid archive handle: ${error instanceof Error ? error.message : String(error)}`, { resourceId }) };
  }
  // The owner verifier may throw on a corrupt artifact (not just return a
  // refusal), so a throw is reported as owner_unavailable instead of escaping
  // the expand path as an unhandled rejection.
  let verified: Awaited<ReturnType<typeof verify>>;
  try {
    verified = await verify(handle);
  } catch (error) {
    return { ok: false, diagnostic: diagnostic("owner_unavailable", `Archive verification failed: ${error instanceof Error ? error.message : String(error)}`, { resourceId }) };
  }
  if (!verified.ok) {
    if (verified.reason === "checksum_mismatch") {
      return { ok: false, diagnostic: diagnostic("stale_checksum", "Archive payload no longer matches the handle checksum.", { resourceId }) };
    }
    if (verified.reason === "missing" || verified.reason === "invalid_uri") {
      return { ok: false, diagnostic: diagnostic("missing_resource", `Archive is not available: ${verified.reason}.`, { resourceId }) };
    }
    return { ok: false, diagnostic: diagnostic("owner_unavailable", `Archive could not be read: ${verified.error ?? verified.reason}.`, { resourceId }) };
  }
  const sourceSessionId = verified.handle.source?.sessionId;
  const payload = verified.payload;
  const content = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return {
    ok: true,
    content,
    revision: `archive:${verified.handle.createdAt ?? verified.handle.checksum}`,
    ...(sourceSessionId ? { sourceSessionId } : {}),
  };
}

async function resolveResource(
  owner: ContextHandleOwner,
  resourceId: string,
  scopeSessionId: string,
  checksum: string | undefined,
  deps: ContextExpandDeps,
): Promise<ResolvedResource> {
  switch (owner) {
    case "workspace-file":
      return resolveWorkspaceFile(resourceId, deps);
    case "block-store":
      return resolveBlock(resourceId, scopeSessionId, deps);
    case "context-archive":
      if (!checksum) {
        return { ok: false, diagnostic: diagnostic("invalid_handle", "A context-archive resource needs the archive checksum to be minted.", { resourceId }) };
      }
      return resolveArchive(resourceId, checksum, deps);
    default:
      return { ok: false, diagnostic: diagnostic("owner_unavailable", `Owner "${owner}" has no resolver in this phase; the original stays with its owner and is not readable through context_expand yet.`, { owner, resourceId }) };
  }
}

function sliceBySelector(content: string, selector: ContextSelector): SlicedRegion {
  if (selector.kind === "full") return { ok: true, region: content };
  if (selector.kind === "lines") {
    const lines = content.split("\n");
    if (selector.startLine > lines.length) {
      return { ok: false, diagnostic: diagnostic("missing_resource", "Selector starts beyond the end of the resource.", { selector: selectorToText(selector), lines: lines.length }) };
    }
    return { ok: true, region: lines.slice(selector.startLine - 1, selector.endLine).join("\n") };
  }
  if (selector.offset >= content.length) {
    return { ok: false, diagnostic: diagnostic("missing_resource", "Selector offset is beyond the end of the resource.", { selector: selectorToText(selector), chars: content.length }) };
  }
  return { ok: true, region: content.slice(selector.offset, selector.offset + selector.length) };
}

/** A range is absolute (same coordinates as the handle selector) and must stay inside it. */
function rangeWithin(outer: ContextSelector, inner: ContextSelector): boolean {
  if (outer.kind === "full") return true;
  if (outer.kind === "lines") {
    return inner.kind === "lines" && inner.startLine >= outer.startLine && inner.endLine <= outer.endLine;
  }
  return inner.kind === "chars" && inner.offset >= outer.offset && inner.offset + inner.length <= outer.offset + outer.length;
}

function boundText(text: string, maxChars: number, maxBytes: number): { content: string; truncated: boolean } {
  let content = text.length > maxChars ? text.slice(0, maxChars) : text;
  let truncated = content.length < text.length;
  let bytes = Buffer.byteLength(content, "utf8");
  while (bytes > maxBytes && content.length > 0) {
    const next = Math.max(0, Math.floor((content.length * maxBytes) / bytes) - 1);
    content = content.slice(0, next);
    truncated = true;
    bytes = Buffer.byteLength(content, "utf8");
  }
  return { content, truncated };
}

function renderSearch(region: string, query: string, baseLine: number): { rendered: string; matches: number } {
  const lines = region.split("\n");
  const needle = query.toLowerCase();
  const hits: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.toLowerCase().includes(needle)) hits.push(index);
  }
  const shown = hits.slice(0, CONTEXT_FOLDING_LIMITS.searchMaxMatches);
  const context = CONTEXT_FOLDING_LIMITS.searchContextLines;
  const blocks = shown.map((hit) => {
    const from = Math.max(0, hit - context);
    const to = Math.min(lines.length - 1, hit + context);
    return lines.slice(from, to + 1).map((line, offset) => `L${baseLine + from + offset}: ${line}`).join("\n");
  });
  return { rendered: blocks.join("\n---\n"), matches: hits.length };
}

function baseLineOf(selector: ContextSelector): number {
  return selector.kind === "lines" ? selector.startLine : 1;
}

/**
 * Mint a scoped handle for an owner resource the requester can already read.
 * The checksum covers the selected region, so a later expand detects drift.
 */
export async function mintContextHandle(ref: ContextResourceRef, deps: ContextExpandDeps, options: { checksum?: string } = {}): Promise<MintOutcome> {
  const resolved = await resolveResource(ref.owner, ref.resourceId, deps.requester.sessionId, options.checksum, deps);
  if (!resolved.ok) return resolved;
  if (resolved.sourceSessionId && resolved.sourceSessionId !== deps.requester.sessionId) {
    return { ok: false, diagnostic: diagnostic("session_mismatch", "Resource belongs to another session.", { resourceId: ref.resourceId }) };
  }
  const selector = ref.selector ?? { kind: "full" };
  const sliced = sliceBySelector(resolved.content, selector);
  if (!sliced.ok) return sliced;
  try {
    const handle = createContextHandle({
      owner: ref.owner,
      scope: {
        workspaceId: deps.requester.workspaceId,
        sessionId: deps.requester.sessionId,
        ...(deps.requester.sessionKey ? { sessionKey: deps.requester.sessionKey } : {}),
      },
      resourceId: ref.resourceId,
      selector,
      // Archive handles keep the owner's payload checksum as their identity.
      ...(ref.owner === "context-archive" && options.checksum ? { checksum: options.checksum, estimatedChars: sliced.region.length } : { content: sliced.region }),
      revision: resolved.revision,
      ...(ref.label !== undefined ? { label: ref.label } : {}),
    }, { hash: hashOf(deps), now: nowIso(deps) });
    return { ok: true, handle };
  } catch (error) {
    return { ok: false, diagnostic: diagnostic("invalid_handle", error instanceof Error ? error.message : String(error), { resourceId: ref.resourceId }) };
  }
}

/** Handle for a block the store already returned to this requester (used by context_search). */
export function handleForContextBlock(block: ContextBlock, requester: ContextRequesterIdentity, deps: { hash?: ContextHashFn; now?: () => string } = {}): ContextHandle | null {
  const content = block.full_content ?? "";
  if (!content) return null;
  try {
    return createContextHandle({
      owner: "block-store",
      scope: {
        workspaceId: requester.workspaceId,
        sessionId: requester.sessionId,
        ...(requester.sessionKey ? { sessionKey: requester.sessionKey } : {}),
      },
      resourceId: `${BLOCK_RESOURCE_PREFIX}${block.block_id}`,
      selector: { kind: "full" },
      content,
      revision: blockRevision(block),
      label: `${block.block_type}:${block.block_id}`,
    }, { hash: deps.hash ?? contextFoldingHash, now: deps.now ? deps.now() : new Date().toISOString() });
  } catch {
    return null;
  }
}

function failure(handle: ContextHandle, mode: ContextExpandMode, diagnostics: ContextDiagnostic[], freshness?: ContextFreshness): ContextExpandResult {
  return createContextExpandFailure({ handle, mode, diagnostics, ...(freshness ? { freshness } : {}) });
}

/**
 * Expand a handle within its declared limits. Order: request shape, scope,
 * mode allowance, freshness, owner resolution, checksum, then the bounded read.
 */
export async function expandContextHandle(request: unknown, deps: ContextExpandDeps): Promise<ContextExpandResult> {
  const hash = hashOf(deps);
  let normalized: ContextExpandRequest;
  try {
    normalized = normalizeContextExpandRequest(request, { hash });
  } catch (error) {
    const issues = (error as { issues?: Array<{ code: ContextDiagnostic["code"]; message: string; path?: string }> }).issues;
    const diagnostics: ContextDiagnostic[] = issues?.length
      ? issues.map((issue) => diagnostic(issue.code, issue.message, issue.path ? { path: issue.path } : undefined))
      : [diagnostic("invalid_request", error instanceof Error ? error.message : String(error))];
    const raw = (request as { handle?: unknown } | null)?.handle;
    const fallbackHandle = fallbackHandleFor(raw, deps);
    return failure(fallbackHandle, "excerpt", diagnostics);
  }
  const { handle, mode } = normalized;
  const now = normalized.now ?? nowIso(deps);
  const scopeIssue = checkContextHandleScope(handle, normalized.requester);
  if (scopeIssue) return failure(handle, mode, [scopeIssue]);
  if (normalized.requester.sessionId !== deps.requester.sessionId || normalized.requester.workspaceId !== deps.requester.workspaceId) {
    return failure(handle, mode, [diagnostic("session_mismatch", "The request names a requester other than the session executing it.")]);
  }
  if (!handle.allowedExpansion.modes.includes(mode)) {
    return failure(handle, mode, [diagnostic("expansion_not_allowed", `Handle does not allow "${mode}" expansion.`, { allowed: handle.allowedExpansion.modes })]);
  }
  if (normalized.range && !rangeWithin(handle.selector, normalized.range)) {
    return failure(handle, mode, [diagnostic("expansion_not_allowed", "Requested range lies outside the handle selector.", { selector: selectorToText(handle.selector), range: selectorToText(normalized.range) })]);
  }
  if (isContextFreshnessExpired(handle.freshness, now)) {
    return failure(handle, mode, [diagnostic("expired", "Handle freshness ttl elapsed; mint a new handle from the owner.", { verifiedAt: handle.freshness.verifiedAt, ttlMs: handle.freshness.ttlMs })], { ...handle.freshness, status: "stale" });
  }
  const resolved = await resolveResource(handle.owner, handle.resourceId, handle.scope.sessionId, handle.checksum, deps);
  if (!resolved.ok) return failure(handle, mode, [resolved.diagnostic]);
  if (resolved.sourceSessionId && resolved.sourceSessionId !== handle.scope.sessionId) {
    return failure(handle, mode, [diagnostic("session_mismatch", "Resource belongs to another session.", { resourceId: handle.resourceId })]);
  }
  const sliced = sliceBySelector(resolved.content, handle.selector);
  if (!sliced.ok) return failure(handle, mode, [sliced.diagnostic]);
  const currentChecksum = handle.owner === "context-archive" ? handle.checksum : contextChecksum(hash, sliced.region);
  const freshness: ContextFreshness = {
    status: currentChecksum === handle.checksum ? "fresh" : "stale",
    verifiedAt: now,
    revision: resolved.revision,
    ...(handle.freshness.ttlMs !== undefined ? { ttlMs: handle.freshness.ttlMs } : {}),
  };
  if (currentChecksum !== handle.checksum) {
    return failure(handle, mode, [diagnostic("stale_checksum", "Owner content changed since the handle was minted; mint a new handle.", { expected: handle.checksum, actual: currentChecksum, revision: resolved.revision })], freshness);
  }
  const maxChars = Math.min(normalized.maxChars, handle.allowedExpansion.maxChars);
  const maxBytes = Math.min(normalized.maxBytes, handle.allowedExpansion.maxBytes);
  const region = sliced.region;
  const regionBytes = Buffer.byteLength(region, "utf8");
  const regionLines = region.length === 0 ? 0 : region.split("\n").length;
  const aggregateBase = { chars: region.length, bytes: regionBytes, lines: regionLines, checksum: currentChecksum };

  let content: string | undefined;
  let truncated = false;
  let aggregate: ContextExpandAggregate = aggregateBase;
  let resolvedSelector: ContextSelector = handle.selector;
  if (mode === "aggregate") {
    content = undefined;
  } else if (mode === "search") {
    const { rendered, matches } = renderSearch(region, normalized.query ?? "", baseLineOf(handle.selector));
    const bounded = boundText(rendered, maxChars, maxBytes);
    content = bounded.content;
    truncated = bounded.truncated || matches > CONTEXT_FOLDING_LIMITS.searchMaxMatches;
    aggregate = { ...aggregateBase, matches };
  } else {
    let excerptSource = region;
    if (normalized.range) {
      const absolute = normalized.range;
      const relative: ContextSelector = handle.selector.kind === "lines" && absolute.kind === "lines"
        ? { kind: "lines", startLine: absolute.startLine - handle.selector.startLine + 1, endLine: absolute.endLine - handle.selector.startLine + 1 }
        : handle.selector.kind === "chars" && absolute.kind === "chars"
          ? { kind: "chars", offset: absolute.offset - handle.selector.offset, length: absolute.length }
          : absolute;
      const sub = sliceBySelector(region, relative);
      if (!sub.ok) return failure(handle, mode, [sub.diagnostic], freshness);
      excerptSource = sub.region;
      resolvedSelector = absolute;
    }
    const bounded = boundText(excerptSource, maxChars, maxBytes);
    content = bounded.content;
    truncated = bounded.truncated;
  }

  const result: ContextExpandResult = {
    schemaVersion: "ContextExpandResult/v1",
    ok: true,
    handleId: handle.handleId,
    mode,
    ...(content !== undefined ? { content } : {}),
    aggregate,
    truncated,
    charCount: content?.length ?? 0,
    byteCount: content === undefined ? 0 : Buffer.byteLength(content, "utf8"),
    resolvedSelector,
    resolvedSelectorText: selectorToText(resolvedSelector),
    evidenceRefs: [evidenceRefForHandle(handle, mode, resolvedSelector)],
    freshness,
    diagnostics: [],
  };
  return normalizeContextExpandResult(result);
}

function fallbackHandleFor(raw: unknown, deps: ContextExpandDeps): ContextHandle {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const handleId = typeof record.handleId === "string" && /^cfh_[0-9a-f]{32}$/.test(record.handleId)
    ? record.handleId
    : "cfh_00000000000000000000000000000000";
  const now = nowIso(deps);
  return {
    schemaVersion: "ContextHandle/v1",
    handleId,
    owner: "tool-output",
    scope: { workspaceId: deps.requester.workspaceId, sessionId: deps.requester.sessionId },
    resourceId: typeof record.resourceId === "string" && record.resourceId ? record.resourceId : "invalid",
    selector: { kind: "full" },
    checksum: `sha256:${"0".repeat(64)}`,
    freshness: { status: "unknown", verifiedAt: now, revision: "invalid" },
    estimatedChars: 0,
    allowedExpansion: { modes: ["excerpt", "search", "aggregate"], maxChars: CONTEXT_FOLDING_LIMITS.expandDefaultChars, maxBytes: CONTEXT_FOLDING_LIMITS.expandMaxBytes },
    revision: "invalid",
  };
}

export function contextExpandEvent(result: ContextExpandResult, handle: Pick<ContextHandle, "owner" | "resourceId">, at: string): ContextExpandEvent {
  return {
    type: "context_expand",
    handleId: result.handleId,
    owner: handle.owner,
    resourceId: handle.resourceId,
    mode: result.mode,
    ok: result.ok,
    charCount: result.charCount,
    byteCount: result.byteCount,
    truncated: result.truncated,
    diagnosticCodes: result.diagnostics.map((item) => item.code),
    at,
  };
}
