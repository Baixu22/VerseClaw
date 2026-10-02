import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { commitStructuredArtifactBytes, commitStructuredArtifactCandidate, readStructuredArtifactSource } from "openclaw/plugin-sdk/core";
import { applyRecordOperations, sourceDigest, type RecordOperation } from "./domain.js";
import { businessError, RESEARCH_SCHEMA_IDENTITY, RESEARCH_SCHEMA_TEXT, VerseConfComputeEngine } from "./engine.js";
import { contentSha256, renderArtifact, RENDERER_VERSION } from "./render.js";
import { VerseConfArtifactStore } from "./store.js";
import type { ArtifactContext, ArtifactKind, ArtifactMutationResult, ArtifactOperation, ArtifactRecord, ArtifactRevision, SchemaIdentity } from "./types.js";
import { ARTIFACT_KINDS } from "./types.js";

type Params = Record<string, unknown>;

function contextOf(ctx: OpenClawPluginToolContext, requestId: string): ArtifactContext {
  const workspaceDir = typeof ctx.workspaceDir === "string" ? ctx.workspaceDir : "";
  const sessionKey = typeof ctx.sessionKey === "string" ? ctx.sessionKey : "";
  // Stateless gateway tool invocation can have a trusted session key without
  // a persisted session row yet. Keep the runtime-owned session key as the
  // durable journal/session identity instead of accepting a model argument.
  const sessionId = typeof ctx.sessionId === "string" && ctx.sessionId ? ctx.sessionId : sessionKey;
  const agentId = typeof ctx.agentId === "string" ? ctx.agentId : "";
  if (!workspaceDir || !sessionKey || !sessionId || !agentId) {
    throw new Error("structured artifact tools require the trusted workspace, session, and agent context");
  }
  return { workspaceDir, sessionKey, sessionId, agentId, requestId };
}

function kindParam(params: Params): ArtifactKind {
  const kind = readStringParam(params, "kind", { required: true });
  if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) throw new Error(`unsupported artifact kind: ${kind}`);
  return kind as ArtifactKind;
}

function artifactIdParam(params: Params): string {
  return readStringParam(params, "artifactId", { required: true });
}

function schemaFor(kind: ArtifactKind): { text: string; identity: SchemaIdentity } {
  if (kind === "research-table") return { text: RESEARCH_SCHEMA_TEXT, identity: RESEARCH_SCHEMA_IDENTITY };
  return { text: RESEARCH_SCHEMA_TEXT, identity: { ...RESEARCH_SCHEMA_IDENTITY, schemaId: "urn:clawx:slide-outline:v1", version: "slide-outline/v1" } };
}

function pickArtifact(store: VerseConfArtifactStore, artifactId: string, ctx: ArtifactContext): ArtifactRecord {
  const artifact = store.getArtifact(artifactId);
  if (!artifact) throw new Error(`artifact not found: ${artifactId}`);
  if (artifact.workspaceDir !== ctx.workspaceDir) throw new Error("artifact belongs to another workspace");
  if (artifact.disabledAt) throw new Error("artifact is disabled");
  return artifact;
}

function operation(params: {
  operationId: string;
  artifactId: string;
  kind: ArtifactOperation["kind"];
  state: ArtifactOperation["state"];
  request: Params;
  context: ArtifactContext;
  beforeSha256?: string | null;
  candidateSha256?: string | null;
  afterSha256?: string | null;
  journalRef?: string | null;
  recoveryRef?: string | null;
}): ArtifactOperation {
  const now = Date.now();
  return {
    operationId: params.operationId,
    artifactId: params.artifactId,
    kind: params.kind,
    state: params.state,
    request: params.request,
    beforeSha256: params.beforeSha256 ?? null,
    candidateSha256: params.candidateSha256 ?? null,
    afterSha256: params.afterSha256 ?? null,
    journalRef: params.journalRef ?? null,
    recoveryRef: params.recoveryRef ?? null,
    context: {
      workspaceDir: params.context.workspaceDir,
      sessionKey: params.context.sessionKey,
      sessionId: params.context.sessionId,
      agentId: params.context.agentId,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function mutationResult(params: Omit<ArtifactMutationResult, "apiVersion" | "ok"> & { ok?: boolean }): ArtifactMutationResult {
  return { apiVersion: 1, ok: params.ok ?? (params.state === "committed" || params.state === "unchanged"), ...params };
}

function idempotencyKey(params: Params, fallback: string): string {
  const key = typeof params.idempotencyKey === "string" ? params.idempotencyKey.trim() : fallback;
  if (!key || key.length > 160) throw new Error("idempotencyKey must be 1..160 characters");
  return key;
}

function requestFingerprint(value: unknown): string {
  return JSON.stringify(value, Object.keys((value && typeof value === "object") ? value as object : {}).sort());
}

function checkExistingIdempotency(store: VerseConfArtifactStore, artifact: ArtifactRecord, key: string, request: Params, current: { revision: ArtifactRevision; sha256: string }): ArtifactMutationResult | null {
  const existing = store.getOperationByIdempotency(artifact.artifactId, key);
  if (!existing) return null;
  if (requestFingerprint(existing.request) !== requestFingerprint(request)) {
    return mutationResult({ artifactId: artifact.artifactId, operationId: existing.operationId, state: "rejected", diagnostics: [{ code: "idempotency_conflict", message: "idempotencyKey was already used with a different request" }] });
  }
  if (existing.state === "committed" || existing.state === "unchanged") {
    const revision = store.getRevision(artifact.currentRevisionId) ?? current.revision;
    return mutationResult({ artifactId: artifact.artifactId, operationId: existing.operationId, state: existing.state, revision, journalRef: existing.journalRef });
  }
  return mutationResult({ artifactId: artifact.artifactId, operationId: existing.operationId, state: existing.state, journalRef: existing.journalRef, recoveryRef: existing.recoveryRef, diagnostics: [{ code: "idempotency_replay_blocked", message: "previous operation is not safely replayable" }] });
}

async function sourceFor(store: VerseConfArtifactStore, artifact: ArtifactRecord): Promise<{ revision: ArtifactRevision; source: string; sha256: string }> {
  const revision = store.getRevision(artifact.currentRevisionId);
  if (!revision) throw new Error(`current revision missing: ${artifact.currentRevisionId}`);
  const source = await readStructuredArtifactSource(artifact.workspaceDir, artifact.sourcePath);
  if (source.sha256 !== revision.sourceSha256) {
    throw new Error(`artifact source drifted outside the managed revision: expected ${revision.sourceSha256}, found ${source.sha256}`);
  }
  return { revision, source: source.bytes.toString("utf8"), sha256: source.sha256 };
}

async function validateCandidate(engine: VerseConfComputeEngine, baseline: string, candidate: string, artifact: ArtifactRecord, signal?: AbortSignal) {
  const outcome = await engine.validateTrustedCandidate(baseline, candidate, artifact.schemaText, artifact.schemaIdentity, signal);
  const error = businessError(outcome);
  if (error) throw new Error(`${error.stage ?? "candidate"}/${error.code}: ${error.message}`);
  return outcome;
}

async function commitRevision(params: {
  store: VerseConfArtifactStore;
  engine: VerseConfComputeEngine;
  artifact: ArtifactRecord;
  current: { revision: ArtifactRevision; source: string; sha256: string };
  candidate: string;
  context: ArtifactContext;
  operationId: string;
  idempotencyKey: string;
  kind: ArtifactOperation["kind"];
  request: Params;
  signal?: AbortSignal;
}): Promise<ArtifactMutationResult> {
  await validateCandidate(params.engine, params.current.source, params.candidate, params.artifact, params.signal);
  params.store.assertRevisionCapacity(params.artifact.artifactId);
  const preparedOperation = operation({
    operationId: params.operationId,
    artifactId: params.artifact.artifactId,
    kind: params.kind,
    state: "prepared",
    request: params.request,
    context: params.context,
    beforeSha256: params.current.sha256,
    candidateSha256: sourceDigest(params.candidate),
  });
  params.store.insertOperation(preparedOperation, params.idempotencyKey);
  const write = await commitStructuredArtifactCandidate({
    context: {
      workspaceRoot: params.context.workspaceDir,
      sessionId: params.context.sessionId,
      requestId: params.context.requestId,
      signal: params.signal,
      flags: { structuredArtifact: true, verseconfApiVersion: "1" },
    },
    sourcePath: params.artifact.sourcePath,
    candidate: params.candidate,
    expectedBeforeSha256: params.current.sha256,
    operationId: params.operationId,
  });
  if (!write.ok) {
    const state = write.code === "recovery_required" ? "recovery_required" : "rejected";
    params.store.updateOperation(params.operationId, { state, journalRef: write.journalRef, recoveryRef: write.journalRef, afterSha256: write.afterSha256 ?? null });
    return mutationResult({ artifactId: params.artifact.artifactId, operationId: params.operationId, state, journalRef: write.journalRef, recoveryRef: write.journalRef, diagnostics: [{ code: write.code, message: write.message }] });
  }
  if (!write.changed) {
    params.store.updateOperation(params.operationId, { state: "unchanged", afterSha256: params.current.sha256 });
    return mutationResult({ artifactId: params.artifact.artifactId, operationId: params.operationId, state: "unchanged", journalRef: null });
  }
  const revision: ArtifactRevision = {
    revisionId: `rev-${randomUUID()}`,
    artifactId: params.artifact.artifactId,
    sequence: params.current.revision.sequence + 1,
    parentRevisionId: params.current.revision.revisionId,
    sourceText: params.candidate,
    sourceSha256: write.afterSha256,
    schemaIdentity: params.artifact.schemaIdentity,
    operationId: params.operationId,
    journalRef: write.journalRef,
    status: "committed",
    context: { sessionKey: params.context.sessionKey, sessionId: params.context.sessionId, agentId: params.context.agentId },
    createdAt: Date.now(),
  };
  const committedOperation = operation({ operationId: params.operationId, artifactId: params.artifact.artifactId, kind: params.kind, state: "committed", request: params.request, context: params.context, beforeSha256: params.current.sha256, candidateSha256: sourceDigest(params.candidate), afterSha256: write.afterSha256, journalRef: write.journalRef });
  try {
    params.store.commitRevision({ artifactId: params.artifact.artifactId, revision, operation: committedOperation, idempotencyKey: params.idempotencyKey });
  } catch (error) {
    try {
      params.store.updateOperation(params.operationId, { state: "recovery_required", journalRef: write.journalRef, recoveryRef: write.journalRef, afterSha256: write.afterSha256 });
    } catch {
      // Keep the file/journal evidence as the recovery authority if SQLite is unavailable.
    }
    return mutationResult({ artifactId: params.artifact.artifactId, operationId: params.operationId, state: "recovery_required", journalRef: write.journalRef, recoveryRef: write.journalRef, diagnostics: [{ code: "metadata_persist_failed", message: String(error) }] });
  }
  return mutationResult({ artifactId: params.artifact.artifactId, operationId: params.operationId, state: "committed", revision, journalRef: write.journalRef });
}

export function createVerseConfTools(params: { store: VerseConfArtifactStore; engine: VerseConfComputeEngine; api: OpenClawPluginApi; context: OpenClawPluginToolContext }): AnyAgentTool[] {
  const { store, engine, context } = params;
  const readonlyRisk = { risk: "readonly" as const, writeRiskProfile: { kind: "no_writes" as const } };
  const writeRisk = { risk: "write" as const, writeRiskProfile: { kind: "dynamic_writes" as const, requiresApproval: true as const } };

  const create: AnyAgentTool = {
    name: "structured_artifact_create",
    label: "Structured Artifact Create",
    description: "Create a bounded research-table or slide-outline artifact bound to the active workspace and runtime context.",
    parameters: Type.Object({ artifactId: Type.String(), kind: Type.String(), sourcePath: Type.String(), source: Type.Optional(Type.String()) }, { additionalProperties: false }),
    ...writeRisk,
    execute: async (toolCallId, raw, signal) => {
      const p = raw as Params;
      const ctx = contextOf(context, toolCallId);
      const artifactId = artifactIdParam(p);
      const kind = kindParam(p);
      const sourcePath = readStringParam(p, "sourcePath", { required: true });
      const schema = schemaFor(kind);
      let source = typeof p.source === "string" ? p.source : undefined;
      let existingSha: string | null = null;
      try {
        const existing = await readStructuredArtifactSource(ctx.workspaceDir, sourcePath);
        existingSha = existing.sha256;
        if (source === undefined) source = existing.bytes.toString("utf8");
        if (source !== existing.bytes.toString("utf8")) throw new Error("source does not match the existing file");
      } catch (error) {
        if (source === undefined) throw error;
      }
      if (source === undefined) throw new Error("source is required when sourcePath does not exist");
      const check = await engine.validateTrustedCandidate(source, source, schema.text, schema.identity, signal);
      const checkError = businessError(check);
      if (checkError) throw new Error(`${checkError.stage ?? "candidate"}/${checkError.code}: ${checkError.message}`);
      const write = await commitStructuredArtifactCandidate({ context: { workspaceRoot: ctx.workspaceDir, sessionId: ctx.sessionId, requestId: toolCallId, signal, flags: { structuredArtifact: true } }, sourcePath, candidate: source, expectedBeforeSha256: existingSha, operationId: toolCallId });
      if (!write.ok) return jsonResult(mutationResult({ artifactId, operationId: toolCallId, state: "rejected", journalRef: write.journalRef, recoveryRef: write.journalRef, diagnostics: [{ code: write.code, message: write.message }] }));
      const revision: ArtifactRevision = { revisionId: `rev-${randomUUID()}`, artifactId, sequence: 1, parentRevisionId: null, sourceText: source, sourceSha256: write.afterSha256, schemaIdentity: schema.identity, operationId: toolCallId, journalRef: write.journalRef, status: write.changed ? "committed" : "unchanged", context: { sessionKey: ctx.sessionKey, sessionId: ctx.sessionId, agentId: ctx.agentId }, createdAt: Date.now() };
      const createOperation = operation({
        operationId: toolCallId,
        artifactId,
        kind: "create",
        state: write.changed ? "committed" : "unchanged",
        request: p,
        context: ctx,
        beforeSha256: existingSha,
        candidateSha256: sourceDigest(source),
        afterSha256: write.afterSha256,
        journalRef: write.journalRef,
      });
      store.createArtifact({ artifactId, kind, context: ctx, sourcePath, schemaText: schema.text, schemaIdentity: schema.identity, revision, operation: createOperation, idempotencyKey: idempotencyKey(p, toolCallId) });
      return jsonResult(mutationResult({ artifactId, operationId: toolCallId, state: write.changed ? "committed" : "unchanged", revision, journalRef: write.journalRef }));
    },
  };

  const inspect: AnyAgentTool = {
    name: "structured_artifact_inspect",
    label: "Structured Artifact Inspect",
    description: "Inspect the current artifact revision and stable record identities without exposing arbitrary files.",
    parameters: Type.Object({ artifactId: Type.String(), recordId: Type.Optional(Type.String()), fieldPath: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
    ...readonlyRisk,
    execute: async (_toolCallId, raw, signal) => {
      const artifact = pickArtifact(store, artifactIdParam(raw as Params), contextOf(context, _toolCallId));
      const current = await sourceFor(store, artifact);
      const selectors = typeof (raw as Params).recordId === "string" ? [{ recordId: (raw as Params).recordId as string, fieldPath: Array.isArray((raw as Params).fieldPath) ? (raw as Params).fieldPath as string[] : [] }] : [];
      const outcome = await engine.inspectRecord(current.source, selectors, signal);
      return jsonResult({ apiVersion: 1, artifact, revision: current.revision, sourceSha256: current.sha256, inspection: outcome });
    },
  };

  const revise: AnyAgentTool = {
    name: "structured_artifact_revise",
    label: "Structured Artifact Revise",
    description: "Compute a strict JSON candidate in the VerseConf worker and submit it through the active runtime write owner.",
    parameters: Type.Object({ artifactId: Type.String(), baseRevisionId: Type.Optional(Type.String()), changes: Type.Array(Type.Object({ recordId: Type.String(), fieldPath: Type.Array(Type.String()), op: Type.String(), expect: Type.Optional(Type.Any()), value: Type.Optional(Type.Any()) }, { additionalProperties: false })) }, { additionalProperties: false }),
    ...writeRisk,
    execute: async (toolCallId, raw, signal) => {
      const p = raw as Params;
      const ctx = contextOf(context, toolCallId);
      const artifact = pickArtifact(store, artifactIdParam(p), ctx);
      const current = await sourceFor(store, artifact);
      const key = idempotencyKey(p, toolCallId);
      const replay = checkExistingIdempotency(store, artifact, key, p, current);
      if (replay) return jsonResult(replay);
      if (typeof p.baseRevisionId === "string" && p.baseRevisionId !== current.revision.revisionId) return jsonResult(mutationResult({ artifactId: artifact.artifactId, operationId: toolCallId, state: "rejected", diagnostics: [{ code: "revision_conflict", message: "baseRevisionId is stale" }] }));
      const outcome = await engine.applyBatch(current.source, p.changes as never[], signal);
      const error = businessError(outcome);
      if (error) return jsonResult(mutationResult({ artifactId: artifact.artifactId, operationId: toolCallId, state: "rejected", diagnostics: [{ code: error.code, message: error.message }] }));
      const candidate = (outcome.result as { candidate: string }).candidate;
      return jsonResult(await commitRevision({ store, engine, artifact, current, candidate, context: ctx, operationId: toolCallId, idempotencyKey: key, kind: "revise", request: p, signal }));
    },
  };

  const recordOps: AnyAgentTool = {
    name: "structured_artifact_record_ops",
    label: "Structured Artifact Record Operations",
    description: "Insert, delete, or move stable records with explicit beforeId/afterId and the same final-candidate validation.",
    parameters: Type.Object({ artifactId: Type.String(), baseRevisionId: Type.Optional(Type.String()), operations: Type.Array(Type.Object({ op: Type.String(), recordId: Type.Optional(Type.String()), record: Type.Optional(Type.Any()), beforeId: Type.Optional(Type.String()), afterId: Type.Optional(Type.String()) }, { additionalProperties: false })) }, { additionalProperties: false }),
    ...writeRisk,
    execute: async (toolCallId, raw, signal) => {
      const p = raw as Params;
      const ctx = contextOf(context, toolCallId);
      const artifact = pickArtifact(store, artifactIdParam(p), ctx);
      const current = await sourceFor(store, artifact);
      const key = idempotencyKey(p, toolCallId);
      const replay = checkExistingIdempotency(store, artifact, key, p, current);
      if (replay) return jsonResult(replay);
      if (typeof p.baseRevisionId === "string" && p.baseRevisionId !== current.revision.revisionId) return jsonResult(mutationResult({ artifactId: artifact.artifactId, operationId: toolCallId, state: "rejected", diagnostics: [{ code: "revision_conflict", message: "baseRevisionId is stale" }] }));
      const applied = applyRecordOperations(current.source, p.operations as RecordOperation[], artifact.kind);
      return jsonResult(await commitRevision({ store, engine, artifact, current, candidate: applied.candidate, context: ctx, operationId: toolCallId, idempotencyKey: key, kind: "record-op", request: p, signal }));
    },
  };

  const restore: AnyAgentTool = {
    name: "structured_artifact_restore",
    label: "Structured Artifact Restore",
    description: "Restore a historical source as a new revision; never rewrites or replays an old revision in place.",
    parameters: Type.Object({ artifactId: Type.String(), revisionId: Type.String() }, { additionalProperties: false }),
    ...writeRisk,
    execute: async (toolCallId, raw, signal) => {
      const p = raw as Params;
      const ctx = contextOf(context, toolCallId);
      const artifact = pickArtifact(store, artifactIdParam(p), ctx);
      const current = await sourceFor(store, artifact);
      const key = idempotencyKey(p, toolCallId);
      const replay = checkExistingIdempotency(store, artifact, key, p, current);
      if (replay) return jsonResult(replay);
      const historical = store.getRevision(readStringParam(p, "revisionId", { required: true }));
      if (!historical || historical.artifactId !== artifact.artifactId) throw new Error("historical revision not found");
      return jsonResult(await commitRevision({ store, engine, artifact, current, candidate: historical.sourceText, context: ctx, operationId: toolCallId, idempotencyKey: key, kind: "restore", request: p, signal }));
    },
  };

  const history: AnyAgentTool = {
    name: "structured_artifact_history",
    label: "Structured Artifact History",
    description: "List immutable revisions and derived outputs for an artifact.",
    parameters: Type.Object({ artifactId: Type.String() }, { additionalProperties: false }),
    ...readonlyRisk,
    execute: async (toolCallId, raw) => {
      const artifact = pickArtifact(store, artifactIdParam(raw as Params), contextOf(context, toolCallId));
      return jsonResult({ apiVersion: 1, artifact, revisions: store.listRevisions(artifact.artifactId), outputs: store.listOutputs(artifact.artifactId) });
    },
  };

  const exportTool: AnyAgentTool = {
    name: "structured_artifact_export",
    label: "Structured Artifact Export",
    description: "Export a fixed source revision to deterministic Markdown, CSV, XLSX, or PPTX output with lineage.",
    parameters: Type.Object({ artifactId: Type.String(), revisionId: Type.Optional(Type.String()), format: Type.String() }, { additionalProperties: false }),
    ...writeRisk,
    execute: async (toolCallId, raw, signal) => {
      const p = raw as Params;
      const ctx = contextOf(context, toolCallId);
      const artifact = pickArtifact(store, artifactIdParam(p), ctx);
      const current = await sourceFor(store, artifact);
      const revision = typeof p.revisionId === "string" ? store.getRevision(p.revisionId) : current.revision;
      if (!revision || revision.artifactId !== artifact.artifactId) throw new Error("revision not found");
      const format = readStringParam(p, "format", { required: true }) as "markdown" | "csv" | "xlsx" | "pptx";
      if (!["markdown", "csv", "xlsx", "pptx"].includes(format)) throw new Error(`unsupported export format: ${format}`);
      const rendered = await renderArtifact(revision.sourceText, artifact.kind, format);
      const outputPath = `.openclaw/structured-artifacts/${artifact.artifactId}/${revision.revisionId}-${format}.${rendered.extension}`;
      store.assertOutputCapacity(artifact.artifactId, revision.revisionId);
      const outputWrite = await commitStructuredArtifactBytes({
        context: { workspaceRoot: ctx.workspaceDir, sessionId: ctx.sessionId, requestId: toolCallId, signal, flags: { structuredArtifactOutput: true, rendererVersion: RENDERER_VERSION } },
        sourcePath: outputPath,
        candidate: rendered.content,
        operationId: toolCallId,
      });
      if (!outputWrite.ok) return jsonResult({ apiVersion: 1, ok: false, outputPath, error: outputWrite });
      const output = { outputId: `out-${randomUUID()}`, artifactId: artifact.artifactId, revisionId: revision.revisionId, format, rendererVersion: RENDERER_VERSION, path: outputPath, contentSha256: contentSha256(rendered.content), bytes: rendered.content.byteLength, journalRef: outputWrite.journalRef, validationStatus: rendered.validationStatus, createdAt: Date.now() } as const;
      store.addOutput(output);
      return jsonResult({ apiVersion: 1, output, sourceRevision: revision.revisionId, agentDriven: true });
    },
  };

  const disable: AnyAgentTool = {
    name: "structured_artifact_disable",
    label: "Structured Artifact Disable",
    description: "Disable an artifact without deleting its source or history.",
    parameters: Type.Object({ artifactId: Type.String() }, { additionalProperties: false }),
    ...writeRisk,
    execute: async (toolCallId, raw) => {
      const ctx = contextOf(context, toolCallId);
      const artifact = pickArtifact(store, artifactIdParam(raw as Params), ctx);
      store.disableArtifact(artifact.artifactId, ctx);
      return jsonResult({ apiVersion: 1, artifactId: artifact.artifactId, disabled: true, historyPreserved: true });
    },
  };

  return [create, inspect, revise, recordOps, restore, history, exportTool, disable];
}
