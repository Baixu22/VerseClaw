// Memory Wiki plugin module implements apply behavior.
import path from "node:path";
import { lstat } from "node:fs/promises";
import {
  replaceManagedMarkdownBlock,
  withTrailingNewline,
} from "openclaw/plugin-sdk/memory-host-markdown";
import { readFiniteNumberParam } from "openclaw/plugin-sdk/param-readers";
import { root as fsRoot } from "openclaw/plugin-sdk/security-runtime";
import { normalizeStringEntries, uniqueStrings } from "openclaw/plugin-sdk/string-coerce-runtime";
import { compileMemoryWikiVault, type CompileMemoryWikiResult } from "./compile.js";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import {
  parseWikiMarkdown,
  renderWikiMarkdown,
  slugifyWikiSegment,
  normalizeSourceIds,
  normalizeWikiClaims,
  type WikiClaim,
} from "./markdown.js";
import {
  readQueryableWikiPages,
  resolveQueryableWikiPageByLookup,
  type QueryableWikiPage,
} from "./query.js";
import { initializeMemoryWikiVault } from "./vault.js";
import { withWikiMutationLock } from "./mutation-lock.js";

const GENERATED_START = "<!-- openclaw:wiki:generated:start -->";
const GENERATED_END = "<!-- openclaw:wiki:generated:end -->";
const HUMAN_START = "<!-- openclaw:human:start -->";
const HUMAN_END = "<!-- openclaw:human:end -->";

type CreateSynthesisMemoryWikiMutation = {
  op: "create_synthesis";
  title: string;
  body: string;
  sourceIds: string[];
  claims?: WikiClaim[];
  contradictions?: string[];
  questions?: string[];
  confidence?: number;
  status?: string;
};

type UpdateMetadataMemoryWikiMutation = {
  op: "update_metadata";
  lookup: string;
  sourceIds?: string[];
  claims?: WikiClaim[];
  contradictions?: string[];
  questions?: string[];
  confidence?: number | null;
  status?: string;
};

type LifecycleMutationBase = {
  lookup: string;
  expectedRevision?: number;
  idempotencyKey?: string;
  reason?: string;
};

export type UpdateWikiPageMemoryWikiMutation = LifecycleMutationBase & {
  op: "update_page";
  title?: string;
  body?: string;
  sourceIds?: string[];
  claims?: WikiClaim[];
  contradictions?: string[];
  questions?: string[];
  confidence?: number | null;
  status?: string;
};

export type MergeWikiPageMemoryWikiMutation = LifecycleMutationBase & {
  op: "merge_page";
  sourceLookup?: string;
  body?: string;
  sourceIds?: string[];
  claims?: WikiClaim[];
};

export type ArchiveWikiPageMemoryWikiMutation = LifecycleMutationBase & {
  op: "archive_page";
};

export type RevokeWikiPageMemoryWikiMutation = LifecycleMutationBase & {
  op: "revoke_page";
};

export type DeleteWikiPageMemoryWikiMutation = LifecycleMutationBase & {
  op: "delete_page";
};

export type RestoreWikiPageMemoryWikiMutation = LifecycleMutationBase & {
  op: "restore_page";
};

export type ApplyMemoryWikiMutation =
  | CreateSynthesisMemoryWikiMutation
  | UpdateMetadataMemoryWikiMutation
  | UpdateWikiPageMemoryWikiMutation
  | MergeWikiPageMemoryWikiMutation
  | ArchiveWikiPageMemoryWikiMutation
  | RevokeWikiPageMemoryWikiMutation
  | DeleteWikiPageMemoryWikiMutation
  | RestoreWikiPageMemoryWikiMutation;

type MemoryWikiMutationInputOp =
  | ApplyMemoryWikiMutation["op"]
  | "synthesis"
  | "metadata"
  | "update"
  | "merge"
  | "archive"
  | "revoke"
  | "delete"
  | "restore";

type ApplyMemoryWikiMutationResult = {
  changed: boolean;
  operation: ApplyMemoryWikiMutation["op"];
  pagePath: string;
  pageId?: string;
  status?: string;
  revision?: number;
  compile: CompileMemoryWikiResult;
};

function normalizeMutationConfidence(
  params: Record<string, unknown>,
  options: { allowNull: false },
): number | undefined;
function normalizeMutationConfidence(
  params: Record<string, unknown>,
  options: { allowNull: true },
): number | null | undefined;
function normalizeMutationConfidence(
  params: Record<string, unknown>,
  options: { allowNull: boolean },
): number | null | undefined {
  if (options.allowNull && params.confidence === null) {
    return null;
  }
  return readFiniteNumberParam(params, "confidence", {
    min: 0,
    max: 1,
  });
}

function normalizeMemoryWikiMutationOp(
  op: MemoryWikiMutationInputOp,
): ApplyMemoryWikiMutation["op"] {
  if (op === "synthesis") return "create_synthesis";
  if (op === "metadata") return "update_metadata";
  if (op === "update") return "update_page";
  if (op === "merge") return "merge_page";
  if (op === "archive") return "archive_page";
  if (op === "revoke") return "revoke_page";
  if (op === "delete") return "delete_page";
  if (op === "restore") return "restore_page";
  return op;
}

export function normalizeMemoryWikiMutationInput(rawParams: unknown): ApplyMemoryWikiMutation {
  const params = rawParams as {
    op: MemoryWikiMutationInputOp;
    title?: string;
    body?: string;
    lookup?: string;
    sourceLookup?: string;
    sourceIds?: string[];
    claims?: WikiClaim[];
    contradictions?: string[];
    questions?: string[];
    confidence?: number | null;
    status?: string;
    expectedRevision?: number;
    idempotencyKey?: string;
    reason?: string;
  };
  const op = normalizeMemoryWikiMutationOp(params.op);
  if (op === "create_synthesis") {
    if (!params.title?.trim()) {
      throw new Error("wiki mutation requires title for create_synthesis.");
    }
    if (!params.body?.trim()) {
      throw new Error("wiki mutation requires body for create_synthesis.");
    }
    if (!params.sourceIds || params.sourceIds.length === 0) {
      throw new Error("wiki mutation requires at least one sourceId for create_synthesis.");
    }
    const confidence = normalizeMutationConfidence(params as Record<string, unknown>, {
      allowNull: false,
    });
    return {
      op: "create_synthesis",
      title: params.title,
      body: params.body,
      sourceIds: params.sourceIds,
      ...(Array.isArray(params.claims) ? { claims: normalizeWikiClaims(params.claims) } : {}),
      ...(params.contradictions ? { contradictions: params.contradictions } : {}),
      ...(params.questions ? { questions: params.questions } : {}),
      ...(typeof confidence === "number" ? { confidence } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
  }
  if (!params.lookup?.trim()) {
    throw new Error("wiki mutation requires lookup.");
  }
  const confidence = normalizeMutationConfidence(params as Record<string, unknown>, {
    allowNull: true,
  });
  const lifecycleBase = {
    lookup: params.lookup,
    ...(typeof params.expectedRevision === "number" ? { expectedRevision: params.expectedRevision } : {}),
    ...(typeof params.idempotencyKey === "string" && params.idempotencyKey.trim() ? { idempotencyKey: params.idempotencyKey.trim() } : {}),
    ...(typeof params.reason === "string" && params.reason.trim() ? { reason: params.reason.trim() } : {}),
  };
  if (op === "update_metadata") {
    return {
      op: "update_metadata",
      ...lifecycleBase,
      ...(params.sourceIds ? { sourceIds: params.sourceIds } : {}),
      ...(Array.isArray(params.claims) ? { claims: normalizeWikiClaims(params.claims) } : {}),
      ...(params.contradictions ? { contradictions: params.contradictions } : {}),
      ...(params.questions ? { questions: params.questions } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
  }
  if (op === "update_page") {
    return {
      op: "update_page",
      ...lifecycleBase,
      ...(typeof params.title === "string" && params.title.trim() ? { title: params.title.trim() } : {}),
      ...(typeof params.body === "string" ? { body: params.body } : {}),
      ...(params.sourceIds ? { sourceIds: params.sourceIds } : {}),
      ...(Array.isArray(params.claims) ? { claims: normalizeWikiClaims(params.claims) } : {}),
      ...(params.contradictions ? { contradictions: params.contradictions } : {}),
      ...(params.questions ? { questions: params.questions } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
  }
  if (op === "merge_page") {
    return {
      op: "merge_page",
      ...lifecycleBase,
      ...(typeof params.sourceLookup === "string" && params.sourceLookup.trim() ? { sourceLookup: params.sourceLookup.trim() } : {}),
      ...(typeof params.body === "string" ? { body: params.body } : {}),
      ...(params.sourceIds ? { sourceIds: params.sourceIds } : {}),
      ...(Array.isArray(params.claims) ? { claims: normalizeWikiClaims(params.claims) } : {}),
    };
  }
  return {
    op,
    ...lifecycleBase,
  } as ApplyMemoryWikiMutation;
}

function normalizeUniqueStrings(values: string[] | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }
  return uniqueStrings(normalizeStringEntries(values));
}

function ensureHumanNotesBlock(body: string): string {
  if (body.includes(HUMAN_START) && body.includes(HUMAN_END)) {
    return body;
  }
  const trimmed = body.trimEnd();
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return `${prefix}## Notes\n${HUMAN_START}\n${HUMAN_END}\n`;
}

function buildSynthesisBody(params: {
  title: string;
  originalBody?: string;
  generatedBody: string;
}): string {
  const base = params.originalBody?.trim().length
    ? params.originalBody
    : `# ${params.title}\n\n## Notes\n${HUMAN_START}\n${HUMAN_END}\n`;
  const withGenerated = replaceManagedMarkdownBlock({
    original: base,
    heading: "## Summary",
    startMarker: GENERATED_START,
    endMarker: GENERATED_END,
    body: params.generatedBody,
  });
  return ensureHumanNotesBlock(withGenerated);
}

async function writeWikiPage(params: {
  rootDir: string;
  relativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
}): Promise<boolean> {
  const root = await fsRoot(params.rootDir);
  const rendered = withTrailingNewline(
    renderWikiMarkdown({
      frontmatter: params.frontmatter,
      body: params.body,
    }),
  );
  const existing = await root.readText(params.relativePath).catch(() => "");
  if (existing === rendered) {
    return false;
  }
  await root.write(params.relativePath, rendered);
  return true;
}

async function resolveWritablePage(params: {
  config: ResolvedMemoryWikiConfig;
  lookup: string;
}): Promise<QueryableWikiPage | null> {
  const pages = await readQueryableWikiPages(params.config.vault.path);
  return resolveQueryableWikiPageByLookup(pages, params.lookup);
}

async function applyCreateSynthesisMutation(params: {
  config: ResolvedMemoryWikiConfig;
  mutation: CreateSynthesisMemoryWikiMutation;
}): Promise<{ changed: boolean; pagePath: string; pageId: string }> {
  const slug = slugifyWikiSegment(params.mutation.title);
  const pagePath = path.join("syntheses", `${slug}.md`).replace(/\\/g, "/");
  const existing = await lstat(path.join(params.config.vault.path, pagePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) throw new Error(`create_conflict: wiki page already exists: ${pagePath}`);
  const parsed = parseWikiMarkdown("");
  const pageId =
    (typeof parsed.frontmatter.id === "string" && parsed.frontmatter.id.trim()) ||
    `synthesis.${slug}`;
  const changed = await writeWikiPage({
    rootDir: params.config.vault.path,
    relativePath: pagePath,
    frontmatter: {
      ...parsed.frontmatter,
      pageType: "synthesis",
      id: pageId,
      title: params.mutation.title,
      sourceIds: normalizeSourceIds(params.mutation.sourceIds),
      ...(params.mutation.claims ? { claims: normalizeWikiClaims(params.mutation.claims) } : {}),
      ...(normalizeUniqueStrings(params.mutation.contradictions)
        ? { contradictions: normalizeUniqueStrings(params.mutation.contradictions) }
        : {}),
      ...(normalizeUniqueStrings(params.mutation.questions)
        ? { questions: normalizeUniqueStrings(params.mutation.questions) }
        : {}),
      ...(typeof params.mutation.confidence === "number"
        ? { confidence: params.mutation.confidence }
        : {}),
      status: params.mutation.status?.trim() || "active",
      updatedAt: new Date().toISOString(),
    },
    body: buildSynthesisBody({
      title: params.mutation.title,
      originalBody: parsed.body,
      generatedBody: params.mutation.body.trim(),
    }),
  });
  return { changed, pagePath, pageId };
}

function buildUpdatedFrontmatter(params: {
  original: Record<string, unknown>;
  mutation: UpdateMetadataMemoryWikiMutation;
}): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {
    ...params.original,
    revision: wikiPageRevision(params.original) + 1,
    updatedAt: new Date().toISOString(),
  };
  if (params.mutation.sourceIds) {
    frontmatter.sourceIds = normalizeSourceIds(params.mutation.sourceIds);
  }
  if (params.mutation.claims) {
    const claims = normalizeWikiClaims(params.mutation.claims);
    if (claims.length > 0) {
      frontmatter.claims = claims;
    } else {
      delete frontmatter.claims;
    }
  }
  if (params.mutation.contradictions) {
    const contradictions = normalizeUniqueStrings(params.mutation.contradictions) ?? [];
    if (contradictions.length > 0) {
      frontmatter.contradictions = contradictions;
    } else {
      delete frontmatter.contradictions;
    }
  }
  if (params.mutation.questions) {
    const questions = normalizeUniqueStrings(params.mutation.questions) ?? [];
    if (questions.length > 0) {
      frontmatter.questions = questions;
    } else {
      delete frontmatter.questions;
    }
  }
  if (params.mutation.confidence === null) {
    delete frontmatter.confidence;
  } else if (typeof params.mutation.confidence === "number") {
    frontmatter.confidence = params.mutation.confidence;
  }
  if (params.mutation.status?.trim()) {
    frontmatter.status = params.mutation.status.trim();
  }
  return frontmatter;
}

async function applyUpdateMetadataMutation(params: {
  config: ResolvedMemoryWikiConfig;
  mutation: UpdateMetadataMemoryWikiMutation;
}): Promise<{ changed: boolean; pagePath: string; pageId?: string }> {
  const page = await resolveWritablePage({
    config: params.config,
    lookup: params.mutation.lookup,
  });
  if (!page) {
    throw new Error(`Wiki page not found: ${params.mutation.lookup}`);
  }
  const parsed = parseWikiMarkdown(page.raw);
  const changed = await writeWikiPage({
    rootDir: params.config.vault.path,
    relativePath: page.relativePath,
    frontmatter: buildUpdatedFrontmatter({
      original: parsed.frontmatter,
      mutation: params.mutation,
    }),
    body: parsed.body,
  });
  return {
    changed,
    pagePath: page.relativePath,
    ...(page.id ? { pageId: page.id } : {}),
  };
}

type LifecycleMutationResult = {
  changed: boolean;
  pagePath: string;
  pageId?: string;
  status?: string;
  revision?: number;
};

function wikiPageRevision(frontmatter: Record<string, unknown>): number {
  const value = frontmatter.revision;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function assertExpectedWikiRevision(
  page: QueryableWikiPage,
  parsed: { frontmatter: Record<string, unknown>; body: string },
  expectedRevision: number | undefined,
): number {
  const current = wikiPageRevision(parsed.frontmatter);
  if (expectedRevision !== undefined && current !== expectedRevision) {
    throw new Error(
      `stale_revision for ${page.relativePath}: expected ${expectedRevision}, actual ${current}`,
    );
  }
  return current;
}

async function resolveRequiredWritablePage(params: {
  config: ResolvedMemoryWikiConfig;
  lookup: string;
}): Promise<QueryableWikiPage> {
  const page = await resolveWritablePage({
    config: params.config,
    lookup: params.lookup,
  });
  if (!page) {
    throw new Error(`Wiki page not found: ${params.lookup}`);
  }
  return page;
}

function withLifecycleRevision(
  frontmatter: Record<string, unknown>,
  revision: number,
  status: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...frontmatter,
    status,
    revision: revision + 1,
    updatedAt: new Date().toISOString(),
  };
  if (status === "active") {
    delete next.archivedAt;
    delete next.revokedAt;
  } else {
    next[status === "revoked" ? "revokedAt" : "archivedAt"] = new Date().toISOString();
  }
  return next;
}

async function applyUpdateWikiPageMutation(params: {
  config: ResolvedMemoryWikiConfig;
  mutation: UpdateWikiPageMemoryWikiMutation;
}): Promise<LifecycleMutationResult> {
  const page = await resolveRequiredWritablePage({
    config: params.config,
    lookup: params.mutation.lookup,
  });
  const parsed = parseWikiMarkdown(page.raw);
  const currentRevision = assertExpectedWikiRevision(page, parsed, params.mutation.expectedRevision);
  const status = params.mutation.status?.trim() || "active";
  const nextFrontmatter: Record<string, unknown> = {
    ...parsed.frontmatter,
    ...(params.mutation.title?.trim() ? { title: params.mutation.title.trim() } : {}),
    ...(params.mutation.sourceIds
      ? { sourceIds: normalizeSourceIds(params.mutation.sourceIds) }
      : {}),
    ...(Array.isArray(params.mutation.claims)
      ? (() => {
          const claims = normalizeWikiClaims(params.mutation.claims);
          return claims.length > 0 ? { claims } : {};
        })()
      : {}),
    ...(params.mutation.contradictions
      ? { contradictions: normalizeUniqueStrings(params.mutation.contradictions) ?? [] }
      : {}),
    ...(params.mutation.questions
      ? { questions: normalizeUniqueStrings(params.mutation.questions) ?? [] }
      : {}),
    ...(params.mutation.confidence === null
      ? {}
      : typeof params.mutation.confidence === "number"
        ? { confidence: params.mutation.confidence }
        : {}),
    status,
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
  };
  if (params.mutation.confidence === null) delete nextFrontmatter.confidence;
  const changed = await writeWikiPage({
    rootDir: params.config.vault.path,
    relativePath: page.relativePath,
    frontmatter: nextFrontmatter,
    body: typeof params.mutation.body === "string" ? params.mutation.body : parsed.body,
  });
  return {
    changed,
    pagePath: page.relativePath,
    ...(page.id ? { pageId: page.id } : {}),
    status,
    revision: currentRevision + 1,
  };
}

async function applyMergeWikiPageMutation(params: {
  config: ResolvedMemoryWikiConfig;
  mutation: MergeWikiPageMemoryWikiMutation;
}): Promise<LifecycleMutationResult> {
  const page = await resolveRequiredWritablePage({
    config: params.config,
    lookup: params.mutation.lookup,
  });
  const parsed = parseWikiMarkdown(page.raw);
  const currentRevision = assertExpectedWikiRevision(page, parsed, params.mutation.expectedRevision);
  const source = params.mutation.sourceLookup
    ? await resolveRequiredWritablePage({
        config: params.config,
        lookup: params.mutation.sourceLookup,
      })
    : null;
  if (source && source.relativePath === page.relativePath) {
    throw new Error("merge source must differ from the target page");
  }
  const sourceParsed = source ? parseWikiMarkdown(source.raw) : null;
  const sourceIds = [
    ...normalizeSourceIds(parsed.frontmatter.sourceIds),
    ...(source ? normalizeSourceIds(sourceParsed!.frontmatter.sourceIds) : []),
    ...normalizeSourceIds(params.mutation.sourceIds),
  ];
  const claims = [
    ...normalizeWikiClaims(parsed.frontmatter.claims),
    ...(source ? normalizeWikiClaims(sourceParsed!.frontmatter.claims) : []),
    ...normalizeWikiClaims(params.mutation.claims),
  ];
  const bodyParts = [parsed.body.trimEnd()];
  if (params.mutation.body?.trim()) {
    bodyParts.push(`## Merged content\n${params.mutation.body.trim()}`);
  }
  if (source) {
    bodyParts.push(`## Merged from ${source.title}\n${sourceParsed!.body.trimEnd()}`);
  }
  const nextFrontmatter: Record<string, unknown> = {
    ...parsed.frontmatter,
    sourceIds,
    ...(claims.length > 0 ? { claims } : {}),
    status: "active",
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
  };
  const changed = await writeWikiPage({
    rootDir: params.config.vault.path,
    relativePath: page.relativePath,
    frontmatter: nextFrontmatter,
    body: bodyParts.join("\n\n"),
  });
  return {
    changed,
    pagePath: page.relativePath,
    ...(page.id ? { pageId: page.id } : {}),
    status: "active",
    revision: currentRevision + 1,
  };
}

async function applyWikiPageStatusMutation(params: {
  config: ResolvedMemoryWikiConfig;
  lookup: string;
  expectedRevision?: number;
  status: "archived" | "revoked" | "active";
}): Promise<LifecycleMutationResult> {
  const page = await resolveRequiredWritablePage({
    config: params.config,
    lookup: params.lookup,
  });
  const parsed = parseWikiMarkdown(page.raw);
  const currentRevision = assertExpectedWikiRevision(page, parsed, params.expectedRevision);
  const changed = await writeWikiPage({
    rootDir: params.config.vault.path,
    relativePath: page.relativePath,
    frontmatter: withLifecycleRevision(parsed.frontmatter, currentRevision, params.status),
    body: parsed.body,
  });
  return {
    changed,
    pagePath: page.relativePath,
    ...(page.id ? { pageId: page.id } : {}),
    status: params.status,
    revision: currentRevision + 1,
  };
}

async function applyDeleteWikiPageMutation(params: {
  config: ResolvedMemoryWikiConfig;
  mutation: DeleteWikiPageMemoryWikiMutation;
}): Promise<LifecycleMutationResult> {
  const page = await resolveRequiredWritablePage({
    config: params.config,
    lookup: params.mutation.lookup,
  });
  const parsed = parseWikiMarkdown(page.raw);
  const currentRevision = assertExpectedWikiRevision(page, parsed, params.mutation.expectedRevision);
  const root = await fsRoot(params.config.vault.path);
  await root.remove(page.relativePath);
  return {
    changed: true,
    pagePath: page.relativePath,
    ...(page.id ? { pageId: page.id } : {}),
    status: "deleted",
    revision: currentRevision + 1,
  };
}

async function applyLifecycleMutation(params: {
  config: ResolvedMemoryWikiConfig;
  mutation: Exclude<ApplyMemoryWikiMutation, { op: "create_synthesis" | "update_metadata" }>;
}): Promise<LifecycleMutationResult> {
  if (params.mutation.op === "update_page") {
    return applyUpdateWikiPageMutation({
      config: params.config,
      mutation: params.mutation,
    });
  }
  if (params.mutation.op === "merge_page") {
    return applyMergeWikiPageMutation({
      config: params.config,
      mutation: params.mutation,
    });
  }
  if (params.mutation.op === "archive_page") {
    return applyWikiPageStatusMutation({
      config: params.config,
      lookup: params.mutation.lookup,
      expectedRevision: params.mutation.expectedRevision,
      status: "archived",
    });
  }
  if (params.mutation.op === "revoke_page") {
    return applyWikiPageStatusMutation({
      config: params.config,
      lookup: params.mutation.lookup,
      expectedRevision: params.mutation.expectedRevision,
      status: "revoked",
    });
  }
  if (params.mutation.op === "delete_page") {
    return applyDeleteWikiPageMutation({
      config: params.config,
      mutation: params.mutation,
    });
  }
  return applyWikiPageStatusMutation({
    config: params.config,
    lookup: params.mutation.lookup,
    expectedRevision: params.mutation.expectedRevision,
    status: "active",
  });
}


export async function applyMemoryWikiMutation(params: {
  config: ResolvedMemoryWikiConfig;
  mutation: ApplyMemoryWikiMutation;
}): Promise<ApplyMemoryWikiMutationResult> {
  return withWikiMutationLock(params.config.vault.path, async () => {
    await initializeMemoryWikiVault(params.config);
    const result: LifecycleMutationResult =
      params.mutation.op === "create_synthesis"
        ? await applyCreateSynthesisMutation({
            config: params.config,
            mutation: params.mutation,
          })
        : params.mutation.op === "update_metadata"
          ? await applyUpdateMetadataMutation({
              config: params.config,
              mutation: params.mutation,
            })
          : await applyLifecycleMutation({
              config: params.config,
              mutation: params.mutation,
            });
    const compile = await compileMemoryWikiVault(params.config);
    return {
      changed: result.changed,
      operation: params.mutation.op,
      pagePath: result.pagePath,
      ...(result.pageId ? { pageId: result.pageId } : {}),
      ...(result.status ? { status: result.status } : {}),
      ...(typeof result.revision === "number" ? { revision: result.revision } : {}),
      compile,
    };
  });
}

/** Lifecycle metadata is exposed only by the operator.write Gateway route. */
export async function readMemoryWikiLifecycleMetadata(config: ResolvedMemoryWikiConfig, lookup: string) {
  const page = await resolveRequiredWritablePage({ config, lookup });
  const parsed = parseWikiMarkdown(page.raw);
  return { lookup: page.relativePath, pageId: page.id, revision: assertExpectedWikiRevision(page, parsed, undefined),
    status: typeof parsed.frontmatter.status === "string" ? parsed.frontmatter.status : "active" };
}
