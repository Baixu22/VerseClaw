// Gateway Protocol schema module defines protocol validation shapes.
import { Type } from "typebox";
import { PluginJsonValueSchema } from "./plugins.js";
import { NonEmptyString, SessionLabelString } from "./primitives.js";

/**
 * Session protocol schemas.
 *
 * These requests and results cover transcript discovery, lifecycle control,
 * compaction checkpoints, per-session plugin state, and usage reporting. The
 * schemas are shared by dashboard, CLI, ACP, and gateway RPC callers.
 */

/** Reason a compaction checkpoint was created. */
export const SessionCompactionCheckpointReasonSchema = Type.Union([
  Type.Literal("manual"),
  Type.Literal("auto-threshold"),
  Type.Literal("overflow-retry"),
  Type.Literal("timeout-retry"),
]);

/** Start/end event emitted while a session compaction operation runs. */
export const SessionOperationEventSchema = Type.Object(
  {
    operationId: NonEmptyString,
    operation: Type.Literal("compact"),
    phase: Type.Union([Type.Literal("start"), Type.Literal("end")]),
    sessionKey: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    ts: Type.Integer({ minimum: 0 }),
    completed: Type.Optional(Type.Boolean()),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Reference to the transcript location before or after compaction. */
export const SessionCompactionTranscriptReferenceSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    sessionFile: Type.Optional(NonEmptyString),
    leafId: Type.Optional(NonEmptyString),
    entryId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Stored compaction checkpoint metadata for branching or restoring a session. */
export const SessionCompactionCheckpointSchema = Type.Object(
  {
    checkpointId: NonEmptyString,
    sessionKey: NonEmptyString,
    sessionId: NonEmptyString,
    createdAt: Type.Integer({ minimum: 0 }),
    reason: SessionCompactionCheckpointReasonSchema,
    tokensBefore: Type.Optional(Type.Integer({ minimum: 0 })),
    tokensAfter: Type.Optional(Type.Integer({ minimum: 0 })),
    summary: Type.Optional(Type.String()),
    firstKeptEntryId: Type.Optional(NonEmptyString),
    details: Type.Optional(Type.Unknown()),
    preCompaction: SessionCompactionTranscriptReferenceSchema,
    postCompaction: SessionCompactionTranscriptReferenceSchema,
  },
  { additionalProperties: false },
);

export const CompressionArtifactQualitySchema = Type.Object(
  {
    score: Type.Number({ minimum: 0, maximum: 1 }),
    level: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
    fieldCoverage: Type.Number({ minimum: 0, maximum: 1 }),
    evidenceCoverage: Type.Number({ minimum: 0, maximum: 1 }),
    artifactTokens: Type.Integer({ minimum: 0 }),
    projectionTokens: Type.Integer({ minimum: 0 }),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const CompressionEvidenceRefSchema = Type.Object(
  {
    type: Type.String(),
    ref: NonEmptyString,
    label: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const CompressionFactSchema = Type.Object(
  {
    text: Type.String(),
    evidenceRefs: Type.Array(CompressionEvidenceRefSchema),
  },
  { additionalProperties: false },
);

export const CompressionArtifactSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    objective: Type.String(),
    constraints: Type.Array(CompressionFactSchema),
    currentState: Type.String(),
    done: Type.Array(CompressionFactSchema),
    inProgress: Type.Array(CompressionFactSchema),
    blocked: Type.Array(CompressionFactSchema),
    decisions: Type.Array(CompressionFactSchema),
    filesTouched: Type.Array(CompressionFactSchema),
    testsRun: Type.Array(CompressionFactSchema),
    failedAttempts: Type.Array(CompressionFactSchema),
    deviations: Type.Array(CompressionFactSchema),
    nextAction: Type.String(),
    reviewNeeded: Type.Array(CompressionFactSchema),
    evidenceRefs: Type.Array(CompressionEvidenceRefSchema),
    unverifiedClaims: Type.Array(Type.String()),
    quality: CompressionArtifactQualitySchema,
    tier: Type.Optional(Type.String()),
    strategy: Type.Optional(Type.String()),
    compressionRatio: Type.Optional(Type.Number({ minimum: 0 })),
    tokensBefore: Type.Optional(Type.Integer({ minimum: 0 })),
    tokensAfter: Type.Optional(Type.Integer({ minimum: 0 })),
    rehydratedFiles: Type.Optional(Type.Array(Type.String())),
    staleExcludedCount: Type.Optional(Type.Integer({ minimum: 0 })),
    causalAnchorCount: Type.Optional(Type.Integer({ minimum: 0 })),
    warnings: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/** Lists sessions with optional scope, activity, label, and preview filters. */
export const SessionsListParamsSchema = Type.Object(
  {
    /**
     * Maximum rows to return. Omitted Gateway RPC calls use a bounded default
     * to keep large session stores from monopolizing the event loop.
     */
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    activeMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
    includeGlobal: Type.Optional(Type.Boolean()),
    includeUnknown: Type.Optional(Type.Boolean()),
    /**
     * Limit returned agent-scoped rows to agents currently present in config.
     * Broad disk discovery remains the default for recovery/ACP consumers.
     */
    configuredAgentsOnly: Type.Optional(Type.Boolean()),
    /**
     * Read first 8KB of each session transcript to derive title from first user message.
     * Performs a file read per session - use `limit` to bound result set on large stores.
     */
    includeDerivedTitles: Type.Optional(Type.Boolean()),
    /**
     * Read last 16KB of each session transcript to extract most recent message preview.
     * Performs a file read per session - use `limit` to bound result set on large stores.
     */
    includeLastMessage: Type.Optional(Type.Boolean()),
    label: Type.Optional(SessionLabelString),
    spawnedBy: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
    search: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Repairs or removes invalid session records from the selected agent scope. */
export const SessionsCleanupParamsSchema = Type.Object(
  {
    agent: Type.Optional(NonEmptyString),
    allAgents: Type.Optional(Type.Boolean()),
    enforce: Type.Optional(Type.Boolean()),
    activeKey: Type.Optional(NonEmptyString),
    fixMissing: Type.Optional(Type.Boolean()),
    fixDmScope: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Reads short previews for selected session keys. */
export const SessionsPreviewParamsSchema = Type.Object(
  {
    keys: Type.Array(NonEmptyString, { minItems: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    maxChars: Type.Optional(Type.Integer({ minimum: 20 })),
  },
  { additionalProperties: false },
);

/** Describes one session and optional derived title/last-message previews. */
export const SessionsDescribeParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    includeDerivedTitles: Type.Optional(Type.Boolean()),
    includeLastMessage: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Resolves a session by key, raw session id, label, or parent/agent scope. */
export const SessionsResolveParamsSchema = Type.Object(
  {
    key: Type.Optional(NonEmptyString),
    sessionId: Type.Optional(NonEmptyString),
    label: Type.Optional(SessionLabelString),
    agentId: Type.Optional(NonEmptyString),
    spawnedBy: Type.Optional(NonEmptyString),
    includeGlobal: Type.Optional(Type.Boolean()),
    includeUnknown: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Creates or adopts a session with optional model, label, and parent linkage. */
export const SessionsCreateParamsSchema = Type.Object(
  {
    key: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
    label: Type.Optional(SessionLabelString),
    model: Type.Optional(NonEmptyString),
    parentSessionKey: Type.Optional(NonEmptyString),
    emitCommandHooks: Type.Optional(Type.Boolean()),
    task: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Forks a new session from the current active transcript branch of a parent. */
export const SessionsForkParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    label: Type.Optional(SessionLabelString),
  },
  { additionalProperties: false },
);

/** Sends one message into an existing session. */
export const SessionsSendParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    message: Type.String(),
    thinking: Type.Optional(Type.String()),
    attachments: Type.Optional(Type.Array(Type.Unknown())),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    idempotencyKey: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Subscribes a client to live message updates for one session. */
export const SessionsMessagesSubscribeParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Removes a live message subscription for one session. */
export const SessionsMessagesUnsubscribeParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Aborts the active or named run for a session. */
export const SessionsAbortParamsSchema = Type.Object(
  {
    key: Type.Optional(NonEmptyString),
    runId: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/**
 * Stops all runtime activity owned by one session generation without mutating
 * the session store or transcript.
 */
export const SessionsStopParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Result returned after the session stop pipeline drains. */
export const SessionsStopResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
  },
  { additionalProperties: false },
);

/** Mutable per-session preferences and routing metadata. */
export const SessionsPatchParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    label: Type.Optional(Type.Union([SessionLabelString, Type.Null()])),
    thinkingLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    fastMode: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    verboseLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    traceLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    reasoningLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    responseUsage: Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("tokens"),
        Type.Literal("full"),
        // Backward compat with older clients/stores.
        Type.Literal("on"),
        Type.Null(),
      ]),
    ),
    elevatedLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execHost: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execSecurity: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execAsk: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execNode: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    model: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    spawnedBy: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    spawnedWorkspaceDir: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    spawnedCwd: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    spawnDepth: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    subagentRole: Type.Optional(
      Type.Union([Type.Literal("orchestrator"), Type.Literal("leaf"), Type.Null()]),
    ),
    subagentControlScope: Type.Optional(
      Type.Union([Type.Literal("children"), Type.Literal("none"), Type.Null()]),
    ),
    inheritedToolAllow: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    inheritedToolDeny: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    sendPolicy: Type.Optional(
      Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Null()]),
    ),
    groupActivation: Type.Optional(
      Type.Union([Type.Literal("mention"), Type.Literal("always"), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

/** Updates or clears one plugin namespace value on a session record. */
export const SessionsPluginPatchParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    pluginId: NonEmptyString,
    namespace: NonEmptyString,
    value: Type.Optional(PluginJsonValueSchema),
    unset: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Result returned after patching session plugin state. */
export const SessionsPluginPatchResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    value: Type.Optional(PluginJsonValueSchema),
  },
  { additionalProperties: false },
);

/** Resets a session to a new or reset transcript state. */
export const SessionsResetParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    reason: Type.Optional(Type.Union([Type.Literal("new"), Type.Literal("reset")])),
  },
  { additionalProperties: false },
);

/** Deletes a session record and optionally its transcript. */
export const SessionsDeleteParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    deleteTranscript: Type.Optional(Type.Boolean()),
    // Caller-generated durable operation id for the delete operation journal.
    // The Electron mirror gate is released only after the matching committed receipt.
    operationId: Type.Optional(NonEmptyString),
    // Internal control: when false, still unbind thread bindings but skip hook emission.
    emitLifecycleHooks: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Requests manual compaction for a session transcript. */
export const SessionsCompactParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    maxLines: Type.Optional(Type.Integer({ minimum: 1 })),
    customInstructions: Type.Optional(Type.String()),
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Reads manual compaction availability and context pressure for one session. */
export const SessionsCompactionStatusParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Reads recent compaction checkpoints as a lightweight history. */
export const SessionsCompactionHistoryParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const SessionsCompactionHistoryEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    timestamp: Type.Integer({ minimum: 0 }),
    summary: Type.Optional(Type.String()),
    tokensBefore: Type.Optional(Type.Integer({ minimum: 0 })),
    tokensAfter: Type.Optional(Type.Integer({ minimum: 0 })),
    firstKeptEntryId: Type.Optional(NonEmptyString),
    trigger: SessionCompactionCheckpointReasonSchema,
    quality: Type.Optional(CompressionArtifactQualitySchema),
    artifactTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    projectionTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    evidenceCoverage: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    unverifiedCount: Type.Optional(Type.Integer({ minimum: 0 })),
    warnings: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const SessionsCompactionStatusResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    available: Type.Boolean(),
    canCompact: Type.Boolean(),
    inProgress: Type.Boolean(),
    reason: Type.Optional(Type.String()),
    usedTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    remainingTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    pressure: Type.Union([
      Type.Literal("unknown"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
    lastCompaction: Type.Optional(SessionsCompactionHistoryEntrySchema),
    truncatedMessageCount: Type.Integer({ minimum: 0 }),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionsCompactionHistoryResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    entries: Type.Array(SessionsCompactionHistoryEntrySchema),
  },
  { additionalProperties: false },
);

export const ArchiveHandleSchema = Type.Object(
  {
    uri: NonEmptyString,
    checksum: NonEmptyString,
    byteLength: Type.Integer({ minimum: 0 }),
    source: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    createdAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionRecallDiagnosticSchema = Type.Object(
  {
    code: NonEmptyString,
    message: Type.String(),
    ref: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionsRecallOriginalParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    archiveHandle: ArchiveHandleSchema,
  },
  { additionalProperties: false },
);

export const SessionsRecallOriginalResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    payload: Type.Optional(Type.Unknown()),
    archiveHandle: Type.Optional(ArchiveHandleSchema),
    diagnostics: Type.Array(SessionRecallDiagnosticSchema),
  },
  { additionalProperties: false },
);

export const SessionsExpandSelectorParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    resourceId: NonEmptyString,
    selector: NonEmptyString,
    checksum: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SessionsExpandSelectorResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    content: Type.Optional(Type.String()),
    resourceId: Type.Optional(Type.String()),
    selector: Type.Optional(Type.String()),
    checksum: Type.Optional(Type.String()),
    diagnostics: Type.Array(SessionRecallDiagnosticSchema),
  },
  { additionalProperties: false },
);

export const SessionsCompressionArtifactParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    checkpointId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SessionsRecoveryContextParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    checkpointId: Type.Optional(NonEmptyString),
    budgetTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    purpose: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionsCompressionArtifactResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    checkpointId: Type.Optional(NonEmptyString),
    artifact: Type.Optional(CompressionArtifactSchema),
    quality: Type.Optional(CompressionArtifactQualitySchema),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionsRecoveryContextResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    checkpointId: Type.Optional(NonEmptyString),
    context: Type.String(),
    projectionTokens: Type.Integer({ minimum: 0 }),
    artifact: Type.Optional(CompressionArtifactSchema),
    quality: Type.Optional(CompressionArtifactQualitySchema),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const ResumeCheckpointTriggerSchema = Type.Union([
  Type.Literal("compaction"),
  Type.Literal("interrupt"),
  Type.Literal("run_abort"),
  Type.Literal("clawgraph_node_handoff"),
  Type.Literal("audit_fail"),
  Type.Literal("manual_review"),
  Type.Literal("session_rotation"),
  Type.Literal("queue_drain"),
  Type.Literal("guide"),
]);

export const LongTaskInputModeSchema = Type.Union([
  Type.Literal("interrupt"),
  Type.Literal("guide"),
  Type.Literal("queue"),
]);

export const LongTaskEvidenceRefSchema = Type.Object(
  {
    type: Type.String(),
    ref: NonEmptyString,
    label: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ResumeCheckpointSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: Type.Optional(NonEmptyString),
    workspaceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sessionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    trigger: ResumeCheckpointTriggerSchema,
    objective: Type.Optional(Type.String()),
    activeNodeId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    activeTask: Type.Optional(Type.String()),
    lastConfirmedHandoff: Type.Optional(Type.String()),
    openBlockers: Type.Array(Type.String()),
    decisions: Type.Array(Type.String()),
    deviations: Type.Array(Type.String()),
    filesTouched: Type.Array(Type.String()),
    testsRun: Type.Array(Type.String()),
    nextAction: Type.Optional(Type.String()),
    reviewNeededItems: Type.Array(Type.String()),
    evidenceRefs: Type.Array(LongTaskEvidenceRefSchema),
    createdAt: Type.String(),
    metadata: Type.Optional(Type.Record(Type.String(), PluginJsonValueSchema)),
  },
  { additionalProperties: false },
);

export const LongTaskInterventionEventSchema = Type.Object(
  {
    id: NonEmptyString,
    idempotencyKey: Type.Optional(Type.String()),
    sessionKey: NonEmptyString,
    agentId: Type.Optional(Type.String()),
    workspaceId: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
    clawGraphRunId: Type.Optional(Type.String()),
    checkpointId: Type.Optional(Type.String()),
    mode: Type.Optional(LongTaskInputModeSchema),
    trigger: ResumeCheckpointTriggerSchema,
    status: Type.String(),
    payload: Type.Record(Type.String(), PluginJsonValueSchema),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const LongTaskQueueItemSchema = Type.Object(
  {
    id: NonEmptyString,
    idempotencyKey: Type.Optional(Type.String()),
    text: Type.String(),
    sessionKey: NonEmptyString,
    agentId: Type.Optional(Type.String()),
    workspaceId: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("draining"),
      Type.Literal("drained"),
      Type.Literal("failed"),
    ]),
    attempts: Type.Integer({ minimum: 0 }),
    lastAttemptAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastError: Type.Optional(Type.String()),
    drainedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    enqueuedAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    source: Type.String(),
    payload: Type.Record(Type.String(), PluginJsonValueSchema),
  },
  { additionalProperties: false },
);

export const LongTaskCheckpointRecordSchema = Type.Object(
  {
    id: NonEmptyString,
    idempotencyKey: Type.Optional(Type.String()),
    sessionKey: NonEmptyString,
    agentId: Type.Optional(Type.String()),
    workspaceId: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
    clawGraphRunId: Type.Optional(Type.String()),
    trigger: ResumeCheckpointTriggerSchema,
    status: Type.String(),
    checkpoint: ResumeCheckpointSchema,
    archiveHandle: Type.Optional(ArchiveHandleSchema),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SessionsLongTaskControlStatusParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SessionsLongTaskControlHistoryParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const SessionsResumeCheckpointsParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const SessionsQueueDrainParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SessionsRestoreCheckpointParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    checkpointId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionsLongTaskControlStatusResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    available: Type.Boolean(),
    queueCount: Type.Integer({ minimum: 0 }),
    latestCheckpoint: Type.Optional(LongTaskCheckpointRecordSchema),
    latestIntervention: Type.Optional(LongTaskInterventionEventSchema),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionsLongTaskControlHistoryResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    events: Type.Array(LongTaskInterventionEventSchema),
  },
  { additionalProperties: false },
);

export const SessionsResumeCheckpointsResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    checkpoints: Type.Array(LongTaskCheckpointRecordSchema),
  },
  { additionalProperties: false },
);

export const SessionsRestoreCheckpointResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    checkpointId: NonEmptyString,
    rolledBackTo: Type.String(),
    mode: Type.Union([Type.Literal("legacy_checkpoint_fallback"), Type.Literal("event_log_replay")]),
    evidenceSummary: Type.String(),
  },
  { additionalProperties: false },
);

export const SessionsQueueDrainResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    drained: Type.Boolean(),
    queueCount: Type.Integer({ minimum: 0 }),
    messageCount: Type.Optional(Type.Integer({ minimum: 0 })),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Lists compaction checkpoints for one session. */
export const SessionsCompactionListParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Reads one compaction checkpoint by id. */
export const SessionsCompactionGetParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    checkpointId: NonEmptyString,
  },
  { additionalProperties: false },
);

/** Creates a new branch from a compaction checkpoint. */
export const SessionsCompactionBranchParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    checkpointId: NonEmptyString,
  },
  { additionalProperties: false },
);

/** Restores an existing session to a compaction checkpoint. */
export const SessionsCompactionRestoreParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    checkpointId: NonEmptyString,
  },
  { additionalProperties: false },
);

/** List response for session compaction checkpoints. */
export const SessionsCompactionListResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    checkpoints: Type.Array(SessionCompactionCheckpointSchema),
  },
  { additionalProperties: false },
);

/** Get response for a single compaction checkpoint. */
export const SessionsCompactionGetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    checkpoint: SessionCompactionCheckpointSchema,
  },
  { additionalProperties: false },
);

/** Branch response with the newly created session key and entry metadata. */
export const SessionsCompactionBranchResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    sourceKey: NonEmptyString,
    key: NonEmptyString,
    sessionId: NonEmptyString,
    checkpoint: SessionCompactionCheckpointSchema,
    entry: Type.Object(
      {
        sessionId: NonEmptyString,
        updatedAt: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: false },
);

/** Restore response with updated session entry metadata. */
export const SessionsCompactionRestoreResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    key: NonEmptyString,
    sessionId: NonEmptyString,
    checkpoint: SessionCompactionCheckpointSchema,
    entry: Type.Object(
      {
        sessionId: NonEmptyString,
        updatedAt: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: false },
);

/** Usage report query across one session, one agent, or all agent sessions. */
export const SessionsUsageParamsSchema = Type.Object(
  {
    /** Specific session key to analyze; if omitted returns sessions for the effective agent. */
    key: Type.Optional(NonEmptyString),
    /** Agent scope for list-style usage queries. */
    agentId: Type.Optional(NonEmptyString),
    /** Explicit all-agent scope for list-style usage queries. */
    agentScope: Type.Optional(Type.Literal("all")),
    /** Start date for range filter (YYYY-MM-DD). */
    startDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    /** End date for range filter (YYYY-MM-DD). */
    endDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    /** How start/end dates should be interpreted. Defaults to UTC when omitted. */
    mode: Type.Optional(
      Type.Union([Type.Literal("utc"), Type.Literal("gateway"), Type.Literal("specific")]),
    ),
    /** Preset range for usage queries when explicit start/end dates are omitted. */
    range: Type.Optional(
      Type.Union([
        Type.Literal("7d"),
        Type.Literal("30d"),
        Type.Literal("90d"),
        Type.Literal("1y"),
        Type.Literal("all"),
      ]),
    ),
    /** Usage row grouping. `family` rolls up known rotated session ids for a logical key. */
    groupBy: Type.Optional(Type.Union([Type.Literal("instance"), Type.Literal("family")])),
    /** Backward-compatible alias for requesting family grouping. */
    includeHistorical: Type.Optional(Type.Boolean()),
    /** UTC offset to use when mode is `specific` (for example, UTC-4 or UTC+5:30). */
    utcOffset: Type.Optional(Type.String({ pattern: "^UTC[+-]\\d{1,2}(?::[0-5]\\d)?$" })),
    /** Maximum sessions to return (default 50). */
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    /** Include context weight breakdown (systemPromptReport). */
    includeContextWeight: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
