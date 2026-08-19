// Stage 2 golden-path runner. Explicit-invoke only. It reuses the accepted
// Stage 1 real DeepSeek -> write -> grant/Tool Guard/EffectReceipt chain, adds
// the three Stage 2 ContextRef producers, compiles pre-tool and post-tool
// snapshot/plan pairs through DCS, and persists digest-only evidence.
// Default flag off; no product default or provider byte changes here.
import { createHash } from "node:crypto";
import path from "node:path";

import type {
  CompilationSnapshot,
  ContextRef,
  ContextRefKind,
  PromptPlan,
} from "../../../shared/types/context-control-plane/artifacts.js";
import type { CapabilityDescriptor } from "../capabilities/v3/capability-descriptor.js";
import { buildCapabilityShadowCatalog } from "../capabilities/v3/shadow-catalog.js";
import {
  createContextArchiveHandleForPayloadSync,
  createContextItemId,
} from "../context-engine/registry/context-item-registry.js";
import {
  buildStage2UserIntentContextRef,
  buildStage2TaskLedgerContextRef,
  buildStage2ToolResultContextRef,
} from "../context-engine/stage2-context-refs.js";
import { buildStage2TransformGraph } from "../context-engine/stage2-transform-graph.js";
import { rc03PostSealTransformIds } from "../context-engine/rc03-producers.js";
import {
  buildStage2CatalogEpoch,
  buildStage2PolicyEpoch,
} from "../context-engine/stage2-catalog-epoch.js";
import {
  compileStage2Dcs,
  resolveStage2DcsState,
  STAGE2_DCS_POLICY_DIGEST,
} from "../context-engine/stage2-dcs.js";
import {
  persistStage2DcsEvidence,
  persistStage2EnvelopeEvidence,
  queryStage2DcsEvidence,
} from "../context-engine/stage2-dcs-evidence.js";
import {
  ensureLongTaskLedgerRoot,
  readLongTaskLedgerRevision,
} from "./long-task-control/task-ledger.js";
import {
  getShadowCensusDiagnostics,
  type Stage2PromptPlanCarrier,
  type Stage2SnapshotCarrier,
} from "./shadow-census.js";
import {
  runStage1GoldenCodingTurn,
  STAGE1_GOLDEN_MODEL_REF,
  type Stage1GoldenRunResult,
} from "./stage1-golden-run.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";

export const STAGE2_GOLDEN_MODEL_REF = STAGE1_GOLDEN_MODEL_REF;

export type Stage2GoldenRunFailureReason =
  | "stage2-flag-off"
  | "api-key-missing"
  | "invalid-workspace-path"
  | "task-ledger-unavailable"
  | "context-ref-build-failed"
  | "dcs-compile-failed"
  | "stage1-golden-run-failed"
  | "tool-result-archive-failed"
  | "evidence-persist-failed"
  | "error";

export type Stage2GoldenRunTimings = {
  preCompileLatencyMs: number;
  postCompileLatencyMs: number;
  totalCompileLatencyMs: number;
};

export type Stage2GoldenRunResult =
  | {
      ok: true;
      model: string;
      toolCallId: string;
      approvalId: string;
      effectReceiptId: string;
      journalRef?: string;
      envelopeDigest?: string;
      envelopeRef?: string;
      wireReceiptId?: string;
      wireDigest?: string;
      preSnapshotId: string;
      preSnapshotDigest: string;
      prePlanId: string;
      prePlanDigest: string;
      postSnapshotId: string;
      postSnapshotDigest: string;
      postPlanId: string;
      postPlanDigest: string;
      postContextRefKinds: ContextRefKind[];
      postSelectedRefIds: string[];
      preEvidenceRecovered: boolean;
      postEvidenceRecovered: boolean;
      timings?: Stage2GoldenRunTimings;
      census: ReturnType<typeof getShadowCensusDiagnostics>;
    }
  | {
      ok: false;
      reason: Stage2GoldenRunFailureReason;
      message?: string;
    };

export type Stage2GoldenRunOptions = {
  apiKey?: string;
  database?: OpenClawStateDatabaseOptions;
  baseUrl?: string;
  modelId?: string;
  sessionKey: string;
  runId: string;
  attemptIndex?: number;
  modelCallIndex?: number;
  workspaceRoot: string;
  sentinelPath: string;
  sentinelContent: string;
  prompt?: string;
  signal?: AbortSignal;
  taskLedgerWorkspaceId?: string | null;
  /** Resolved as OPENCLAW_STATE_DIR without mutating process.env. */
  taskLedgerStateDir?: string;
  taskLedgerTitle?: string;
  toolResultArchiveRoot?: string;
  /** Explicit Stage 2 flag; defaults to resolveStage2DcsState (default off). */
  stage2Dcs?: boolean;
  /** Optional soak metrics only; never changes request bytes or decisions. */
  collectTimings?: boolean;
};

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function taskLedgerEnv(stateDir?: string): NodeJS.ProcessEnv {
  return stateDir?.trim()
    ? { ...process.env, OPENCLAW_STATE_DIR: stateDir.trim() }
    : process.env;
}

function boundedEntryId(options: Stage2GoldenRunOptions): string {
  const seed = [
    options.sessionKey,
    options.runId,
    String(options.attemptIndex ?? 0),
    String(options.modelCallIndex ?? 0),
  ].join(String.fromCharCode(0));
  return `entry_${sha256Text(seed).slice(0, 16)}`;
}

function stage2PromptPlanCarrier(plan: PromptPlan): Stage2PromptPlanCarrier {
  return {
    schema: plan.schema,
    planId: plan.planId,
    snapshotId: plan.snapshotId,
    planDigest: plan.planDigest,
    sealed: plan.sealed,
    identity: plan.identity,
  };
}

function stage2SnapshotCarrier(snapshot: CompilationSnapshot): Stage2SnapshotCarrier {
  return {
    schema: snapshot.schema,
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.snapshotDigest,
    policyDigest: snapshot.policyDigest,
    modelProfile: snapshot.modelProfile,
    transformGraph: snapshot.transformGraph,
  };
}
function writeToolSchemaHash(): string {
  return `sha256:${sha256Text(JSON.stringify({
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  }))}`;
}

function goldenCatalogEpoch(): string {
  const manifestHash = `sha256:${sha256Text('stage2-golden-write-tool:v1')}`;
  const descriptor: CapabilityDescriptor = {
    capabilityId: 'tool:coding:write',
    kind: 'tool',
    category: 'coding',
    workflowNamespace: 'coding',
    title: 'Write file',
    description: 'Write a workspace file. Used by the Stage 2 golden coding turn.',
    triggerKeywords: ['write', 'file'],
    revision: '1',
    manifestHash,
    schemaHash: writeToolSchemaHash(),
    source: {
      owner: 'openclaw-runtime-coding-tools',
      type: 'native',
      provenance: 'stage2-golden-run',
    },
    stickiness: 'step',
    executionTopologies: ['native'],
  };
  const catalog = buildCapabilityShadowCatalog([descriptor]);
  return buildStage2CatalogEpoch(catalog.snapshotHash);
}

type Stage2CompileInput = {
  refs: ContextRef[];
  sessionKey: string;
  runId: string;
  attemptIndex: number;
  modelCallIndex: number;
  modelId: string;
  taskLedgerRevision: string;
  observedAt: string;
  unitEstimates: Record<string, number>;
};

function compileGoldenRefs(
  input: Stage2CompileInput,
): Extract<Awaited<ReturnType<typeof compileStage2Dcs>>, { ok: true }> | { ok: false; message: string } {
  const result = compileStage2Dcs({
    refs: input.refs,
    identity: {
      sessionKey: input.sessionKey,
      runId: input.runId,
      attemptIndex: input.attemptIndex,
      modelCallIndex: input.modelCallIndex,
    },
    taskLedgerRevision: input.taskLedgerRevision,
    catalogEpoch: goldenCatalogEpoch(),
    policyEpoch: buildStage2PolicyEpoch(STAGE2_DCS_POLICY_DIGEST),
    policyDigest: STAGE2_DCS_POLICY_DIGEST,
    modelProfile: {
      providerId: 'deepseek',
      modelId: input.modelId,
      adapterId: 'openai-completions',
    },
    transformGraph: buildStage2TransformGraph({
      transformIds: rc03PostSealTransformIds(),
    }),
    budget: { unit: 'chars', limit: 100_000, outputReserve: 0 },
    unitEstimates: input.unitEstimates,
    observedAt: input.observedAt,
  });
  if (!result.ok) return { ok: false, message: `${result.reason}: ${result.message}` };
  return result;
}

function persistEvidence(
  snapshot: CompilationSnapshot,
  plan: PromptPlan,
  database: OpenClawStateDatabaseOptions | undefined,
): boolean {
  const persisted = persistStage2DcsEvidence({ snapshot, plan, database });
  if (persisted.failed) return false;
  const rows = queryStage2DcsEvidence(database, snapshot.snapshotDigest);
  return rows.some((row) => row.logical_digest === snapshot.snapshotDigest.slice('sha256:'.length))
    && rows.some((row) => row.logical_digest === plan.planDigest.slice('sha256:'.length));
}

function stage1Success(
  result: Stage1GoldenRunResult,
): Extract<Stage1GoldenRunResult, { ok: true }> | undefined {
  return result.ok ? result : undefined;
}

function resolveGoldenWorkspaceResource(workspaceRoot: string, relativePath: string): string | null {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

export async function runStage2GoldenCodingTurn(
  options: Stage2GoldenRunOptions,
): Promise<Stage2GoldenRunResult> {
  const enabled = options.stage2Dcs ?? resolveStage2DcsState().enabled;
  if (!enabled) {
    return { ok: false, reason: 'stage2-flag-off' };
  }
  const apiKey = (options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    return { ok: false, reason: 'api-key-missing' };
  }
  if (!resolveGoldenWorkspaceResource(options.workspaceRoot, options.sentinelPath)) {
    return { ok: false, reason: 'invalid-workspace-path' };
  }

  const attemptIndex = options.attemptIndex ?? 0;
  const modelCallIndex = options.modelCallIndex ?? 0;
  const modelId = options.modelId ?? 'deepseek-v4-flash';
  const observedAt = new Date().toISOString();
  const ledgerEnv = taskLedgerEnv(options.taskLedgerStateDir);

  let taskLedgerRootId: string;
  try {
    taskLedgerRootId = ensureLongTaskLedgerRoot({
      workspaceId: options.taskLedgerWorkspaceId,
      sessionKey: options.sessionKey,
      agentId: 'stage2-golden-runner',
      runId: options.runId,
      title: options.taskLedgerTitle ?? 'Stage 2 golden coding turn',
      source: 'task_loop',
      env: ledgerEnv,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'task-ledger-unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const ledgerRevision = readLongTaskLedgerRevision({
    workspaceId: options.taskLedgerWorkspaceId,
    taskLedgerRootId,
    env: ledgerEnv,
  });
  if (!ledgerRevision) {
    return { ok: false, reason: 'task-ledger-unavailable' };
  }

  const prompt =
    options.prompt ??
    `Call the write tool exactly once. ` +
      `path must be ${JSON.stringify(options.sentinelPath)} and content must be ` +
      `${JSON.stringify(options.sentinelContent)}. Do not call any other tool.`;
  const userRef = buildStage2UserIntentContextRef({
    sessionKey: options.sessionKey,
    runId: options.runId,
    entryId: boundedEntryId(options),
    payload: prompt,
    observedAt,
  });
  if (!userRef.ok) {
    return { ok: false, reason: 'context-ref-build-failed', message: userRef.reason };
  }
  const taskLedgerRef = buildStage2TaskLedgerContextRef({
    sessionKey: options.sessionKey,
    runId: options.runId,
    taskLedgerRootId,
    revision: ledgerRevision.revision,
    contentDigest: ledgerRevision.contentDigest,
    observedAt,
  });
  if (!taskLedgerRef.ok) {
    return { ok: false, reason: 'context-ref-build-failed', message: taskLedgerRef.reason };
  }

  const preCompileStartedAt = options.collectTimings ? Date.now() : 0;
  const preCompile = compileGoldenRefs({
    refs: [userRef.ref, taskLedgerRef.ref],
    sessionKey: options.sessionKey,
    runId: options.runId,
    attemptIndex,
    modelCallIndex,
    modelId,
    taskLedgerRevision: ledgerRevision.revision,
    observedAt,
    unitEstimates: {
      [userRef.ref.refId]: prompt.length,
      [taskLedgerRef.ref.refId]: 1,
    },
  });
  if (!('snapshot' in preCompile)) {
    return { ok: false, reason: 'dcs-compile-failed', message: preCompile.message };
  }
  if (!persistEvidence(preCompile.snapshot, preCompile.plan, options.database)) {
    return { ok: false, reason: 'evidence-persist-failed' };
  }
  const preCompileLatencyMs = options.collectTimings ? Date.now() - preCompileStartedAt : 0;

  const stage1 = await runStage1GoldenCodingTurn({
    apiKey,
    database: options.database,
    baseUrl: options.baseUrl,
    modelId,
    sessionKey: options.sessionKey,
    runId: options.runId,
    attemptIndex,
    modelCallIndex,
    workspaceRoot: options.workspaceRoot,
    sentinelPath: options.sentinelPath,
    sentinelContent: options.sentinelContent,
    prompt,
    signal: options.signal,
    stage2PromptPlan: stage2PromptPlanCarrier(preCompile.plan),
    stage2Snapshot: stage2SnapshotCarrier(preCompile.snapshot),
  });
  if (!stage1.ok) {
    if (stage1.reason === 'api-key-missing') return { ok: false, reason: 'api-key-missing' };
    if (stage1.reason === 'invalid-workspace-path') {
      return { ok: false, reason: 'invalid-workspace-path' };
    }
    return {
      ok: false,
      reason: 'stage1-golden-run-failed',
      message: `${stage1.reason}: ${stage1.message ?? ''}`,
    };
  }
  const stage1SuccessResult = stage1Success(stage1);
  if (!stage1SuccessResult) {
    return { ok: false, reason: 'stage1-golden-run-failed' };
  }
  if (!stage1SuccessResult.envelopeDigest) {
    return { ok: false, reason: 'evidence-persist-failed' };
  }
  const envelopeEvidence = persistStage2EnvelopeEvidence({
    snapshot: preCompile.snapshot,
    plan: preCompile.plan,
    envelopeDigest: stage1SuccessResult.envelopeDigest,
    database: options.database,
  });
  if (!envelopeEvidence.ok) {
    return { ok: false, reason: 'evidence-persist-failed' };
  }

  const toolResultSessionId = `stage2:${options.sessionKey}:${options.runId}`;
  let toolResultRef;
  try {
    const handle = createContextArchiveHandleForPayloadSync({
      sessionId: toolResultSessionId,
      itemId: createContextItemId(toolResultSessionId, 'observation', stage1SuccessResult.toolCallId),
      payload: stage1SuccessResult.result,
      source: {
        type: 'transcript',
        sessionId: toolResultSessionId,
        entryId: stage1SuccessResult.toolCallId,
      },
      ...(options.toolResultArchiveRoot
        ? { archiveRoot: options.toolResultArchiveRoot }
        : {}),
      createdAt: observedAt,
    });
    toolResultRef = buildStage2ToolResultContextRef({
      sessionKey: options.sessionKey,
      runId: options.runId,
      handle,
      observedAt,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'tool-result-archive-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!toolResultRef.ok) {
    return { ok: false, reason: 'context-ref-build-failed', message: toolResultRef.reason };
  }

  let toolResultUnits: number;
  try {
    toolResultUnits = Math.max(1, JSON.stringify(stage1SuccessResult.result ?? null).length);
  } catch {
    toolResultUnits = 1;
  }
  const postCompileStartedAt = options.collectTimings ? Date.now() : 0;
  const postCompile = compileGoldenRefs({
    refs: [userRef.ref, taskLedgerRef.ref, toolResultRef.ref],
    sessionKey: options.sessionKey,
    runId: options.runId,
    attemptIndex,
    modelCallIndex: modelCallIndex + 1,
    modelId,
    taskLedgerRevision: ledgerRevision.revision,
    observedAt,
    unitEstimates: {
      [userRef.ref.refId]: prompt.length,
      [taskLedgerRef.ref.refId]: 1,
      [toolResultRef.ref.refId]: toolResultUnits,
    },
  });
  if (!('snapshot' in postCompile)) {
    return { ok: false, reason: 'dcs-compile-failed', message: postCompile.message };
  }
  if (!persistEvidence(postCompile.snapshot, postCompile.plan, options.database)) {
    return { ok: false, reason: 'evidence-persist-failed' };
  }
  const postCompileLatencyMs = options.collectTimings ? Date.now() - postCompileStartedAt : 0;

  return {
    ok: true,
    model: STAGE2_GOLDEN_MODEL_REF,
    toolCallId: stage1SuccessResult.toolCallId,
    approvalId: stage1SuccessResult.approvalId,
    effectReceiptId: stage1SuccessResult.effectReceiptId,
    ...(stage1SuccessResult.journalRef
      ? { journalRef: stage1SuccessResult.journalRef }
      : {}),
    ...(stage1SuccessResult.envelopeDigest
      ? { envelopeDigest: stage1SuccessResult.envelopeDigest }
      : {}),
    ...(stage1SuccessResult.envelopeRef
      ? { envelopeRef: stage1SuccessResult.envelopeRef }
      : {}),
    ...(stage1SuccessResult.wireReceiptId
      ? { wireReceiptId: stage1SuccessResult.wireReceiptId }
      : {}),
    ...(stage1SuccessResult.wireDigest
      ? { wireDigest: stage1SuccessResult.wireDigest }
      : {}),
    preSnapshotId: preCompile.snapshot.snapshotId,
    preSnapshotDigest: preCompile.snapshot.snapshotDigest,
    prePlanId: preCompile.plan.planId,
    prePlanDigest: preCompile.plan.planDigest,
    postSnapshotId: postCompile.snapshot.snapshotId,
    postSnapshotDigest: postCompile.snapshot.snapshotDigest,
    postPlanId: postCompile.plan.planId,
    postPlanDigest: postCompile.plan.planDigest,
    postContextRefKinds: postCompile.snapshot.contextRefs.map((ref) => ref.kind).toSorted(),
    postSelectedRefIds: postCompile.plan.order,
    preEvidenceRecovered: true,
    postEvidenceRecovered: true,
    ...(options.collectTimings
      ? {
          timings: {
            preCompileLatencyMs,
            postCompileLatencyMs,
            totalCompileLatencyMs: preCompileLatencyMs + postCompileLatencyMs,
          },
        }
      : {}),
    census: getShadowCensusDiagnostics(),
  };
}
