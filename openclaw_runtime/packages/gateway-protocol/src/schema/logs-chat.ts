// Gateway Protocol schema module defines protocol validation shapes.
import type { Static } from "typebox";
import { Type } from "typebox";
import { ChatSendSessionKeyString, InputProvenanceSchema, NonEmptyString } from "./primitives.js";

/** Cursor-based request for the gateway log tail endpoint. */
export const LogsTailParamsSchema = Type.Object(
  {
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);

/** Gateway log tail payload returned to dashboard clients. */
export const LogsTailResultSchema = Type.Object(
  {
    file: NonEmptyString,
    cursor: Type.Integer({ minimum: 0 }),
    size: Type.Integer({ minimum: 0 }),
    lines: Type.Array(Type.String()),
    truncated: Type.Optional(Type.Boolean()),
    reset: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Session-scoped history request used by WebChat and native WebSocket clients. */
export const ChatHistoryParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 500_000 })),
  },
  { additionalProperties: false },
);

/** Lightweight chat metadata request; optional agent scope keeps selector state explicit. */
export const ChatMetadataParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Fetches one stored chat message without forcing history callers to request huge payloads. */
export const ChatMessageGetParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    messageId: NonEmptyString,
    maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000_000 })),
  },
  { additionalProperties: false },
);

/** Result envelope for single-message lookup, including the stable miss/visibility reason. */
export const ChatMessageGetResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.Optional(Type.Unknown()),
    unavailableReason: Type.Optional(
      Type.Union([
        Type.Literal("not_found"),
        Type.Literal("oversized"),
        Type.Literal("not_visible"),
      ]),
    ),
  },
  { additionalProperties: false },
);
/** Typed result shape for callers that branch on message availability. */
export type ChatMessageGetResult = Static<typeof ChatMessageGetResultSchema>;

/** Typed, renderer-supplied knowledge retrieval intent. Body fields are intentionally absent. */
export const SourceRefV2Schema = Type.Object(
  {
    schema: Type.Literal("SourceRef/v2"),
    domain: Type.Union(
      ["wiki", "native-memory", "role-memory", "experience", "code", "task"].map((value) =>
        Type.Literal(value),
      ),
    ),
    authorityId: NonEmptyString,
    namespaceId: NonEmptyString,
    subjectId: NonEmptyString,
    revision: NonEmptyString,
    sourceDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
    policyEpoch: NonEmptyString,
    locator: Type.Optional(
      Type.Object(
        {
          coordinateSpace: Type.Literal("raw-source-utf8-v1"),
          startByte: Type.Integer({ minimum: 0 }),
          endByteExclusive: Type.Integer({ minimum: 0 }),
          startLine: Type.Integer({ minimum: 1 }),
          endLine: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ChatKnowledgeReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    lookup: Type.String({ minLength: 1 }),
    corpus: Type.Optional(
      Type.Union([Type.Literal("wiki"), Type.Literal("memory"), Type.Literal("all")]),
    ),
    pageId: Type.Optional(Type.String()),
    pagePath: Type.Optional(Type.String()),
    sourcePath: Type.Optional(Type.String()),
    attachKind: Type.Optional(
      Type.Union([Type.Literal("manual"), Type.Literal("suggested"), Type.Literal("auto")]),
    ),
    routingReason: Type.Optional(Type.String()),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    freshnessLevel: Type.Optional(Type.String()),
    matchedClaimStatus: Type.Optional(Type.String()),
    sourceRef: Type.Optional(SourceRefV2Schema),
    revision: Type.Optional(NonEmptyString),
    contentDigest: Type.Optional(Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })),
  },
  { additionalProperties: false },
);

/** User-to-agent send request; idempotency key lets clients safely retry transport failures. */
export const ChatSendParamsSchema = Type.Object(
  {
    sessionKey: ChatSendSessionKeyString,
    expectedSessionGeneration: Type.Optional(NonEmptyString),
    requesterSessionKey: Type.Optional(NonEmptyString),
    expectedRequesterSessionId: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
    workspaceId: Type.Optional(Type.String()),
    /** Trusted Backend-selected workspace root for this chat session. */
    workspaceDir: Type.Optional(NonEmptyString),
    /**
     * D3 closeout: trusted workspace authority fingerprint
     * (sha256(normalized absolute rootPath).slice(0, 16)) produced by Main
     * from the workspace's normalized rootPath. Embedded attempt binds this
     * via `bindSessionWorkspaceFingerprint` so workspace switches invalidate
     * `working-memory:${sessionId}` consistently across the Chat→Main→Gateway
     * chain. Optional; absent when workspaceId is missing or rootPath lookup
     * fails (agent-config fallback path, no false invalidation).
     */
    workspaceFingerprint: Type.Optional(Type.String()),
    sessionId: Type.Optional(NonEmptyString),
    message: Type.String(),
    thinking: Type.Optional(Type.String()),
    fastMode: Type.Optional(Type.Boolean()),
    /** Turn-scoped model override (Area 2 §3.2). Resolved above session/agent defaults. */
    model: Type.Optional(Type.String()),
    deliver: Type.Optional(Type.Boolean()),
    originatingChannel: Type.Optional(Type.String()),
    originatingTo: Type.Optional(Type.String()),
    originatingAccountId: Type.Optional(Type.String()),
    originatingThreadId: Type.Optional(Type.String()),
    attachments: Type.Optional(Type.Array(Type.Unknown())),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    /**
     * NET-E (TF-0442): absolute epoch-ms deadline for the whole logical request,
     * propagated from the outermost layer (renderer -> Main). The gateway clamps
     * its turn watchdog and the provider request timeout to the remaining budget
     * instead of starting a fresh window at every layer.
     */
    deadlineAtMs: Type.Optional(Type.Integer({ minimum: 1 })),
    systemInputProvenance: Type.Optional(InputProvenanceSchema),
    systemProvenanceReceipt: Type.Optional(Type.String()),
    suppressCommandInterpretation: Type.Optional(Type.Boolean()),
    inputMode: Type.Optional(
      Type.Union([
        Type.Literal("interrupt"),
        Type.Literal("guide"),
        Type.Literal("queue"),
        Type.Literal("revise-goal"),
      ]),
    ),
    idempotencyKey: NonEmptyString,
    promptMode: Type.Optional(
      Type.Union([Type.Literal("full"), Type.Literal("minimal"), Type.Literal("none")]),
    ),
    knowledgeScope: Type.Optional(
      Type.Union([
        Type.Literal("none"),
        Type.Literal("memory"),
        Type.Literal("wiki"),
        Type.Literal("all"),
      ]),
    ),
    knowledgeMode: Type.Optional(
      Type.Union([Type.Literal("manual"), Type.Literal("suggest"), Type.Literal("auto-read")]),
    ),
    knowledgeReferences: Type.Optional(Type.Array(ChatKnowledgeReferenceSchema, { maxItems: 8 })),
  },
  { additionalProperties: false },
);

/** Cancels the active or named run for a chat session. */
export const ChatAbortParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    runId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Inserts an operator-visible synthetic message into an existing chat transcript. */
export const ChatInjectParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    message: NonEmptyString,
    label: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: false },
);

/** Shared event fields preserve stream ordering and route events to the right session. */
const ChatEventBaseSchema = {
  runId: NonEmptyString,
  sessionKey: NonEmptyString,
  agentId: Type.Optional(NonEmptyString),
  spawnedBy: Type.Optional(NonEmptyString),
  seq: Type.Integer({ minimum: 0 }),
};

/** Stable error categories exposed over the chat stream. */
const ChatEventErrorKindSchema = Type.Union([
  Type.Literal("refusal"),
  Type.Literal("timeout"),
  Type.Literal("rate_limit"),
  Type.Literal("context_length"),
  Type.Literal("unknown"),
]);

/** Incremental assistant output event; `replace` marks full-content refresh deltas. */
export const ChatDeltaEventSchema = Type.Object(
  {
    ...ChatEventBaseSchema,
    state: Type.Literal("delta"),
    message: Type.Optional(Type.Unknown()),
    deltaText: Type.String(),
    replace: Type.Optional(Type.Boolean()),
    usage: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

/** Successful terminal event for a completed chat run. */
export const ChatFinalEventSchema = Type.Object(
  {
    ...ChatEventBaseSchema,
    state: Type.Literal("final"),
    message: Type.Optional(Type.Unknown()),
    usage: Type.Optional(Type.Unknown()),
    stopReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Terminal event for user-initiated or coordinator-initiated cancellation. */
export const ChatAbortedEventSchema = Type.Object(
  {
    ...ChatEventBaseSchema,
    state: Type.Literal("aborted"),
    message: Type.Optional(Type.Unknown()),
    stopReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Terminal event for failed chat runs with an optional normalized failure kind. */
export const ChatErrorEventSchema = Type.Object(
  {
    ...ChatEventBaseSchema,
    state: Type.Literal("error"),
    message: Type.Optional(Type.Unknown()),
    errorMessage: Type.Optional(Type.String()),
    errorKind: Type.Optional(ChatEventErrorKindSchema),
    usage: Type.Optional(Type.Unknown()),
    stopReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Public chat stream event union consumed by gateway protocol validators. */
export const ChatEventSchema = Type.Union([
  ChatDeltaEventSchema,
  ChatFinalEventSchema,
  ChatAbortedEventSchema,
  ChatErrorEventSchema,
]);
