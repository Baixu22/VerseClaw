/**
 * Stage 0 Context Control Plane contract types.
 *
 * Draft-only. These schemas define the golden coding turn contract and are
 * intentionally NOT imported by any production module. They are validated only
 * by tests/unit/context-control-plane-stage0-contracts.test.ts in this stage.
 *
 * Hard rules encoded here:
 * - ContextRef carries no payload.
 * - Receipt-shaped artifacts carry digest/ref/policy/lineage, never raw content.
 * - CapabilityGrant is a derived short-lived credential, not a permission table.
 * - RequestEnvelope structurally covers system/messages/tools/media/transforms.
 */
import { z } from "zod";

export const STAGE0_SCHEMA_STATUS = "draft" as const;

export const CONTEXT_REF_SCHEMA = "ContextRef/v1" as const;
export const COMPILATION_SNAPSHOT_SCHEMA = "CompilationSnapshot/v1" as const;
export const PROMPT_PLAN_SCHEMA = "PromptPlan/v1" as const;
export const REQUEST_ENVELOPE_SCHEMA = "RequestEnvelope/v1" as const;
export const CAPABILITY_GRANT_SCHEMA = "CapabilityGrant/v1" as const;
export const EFFECT_RECEIPT_SCHEMA = "EffectReceipt/v1" as const;

export const STAGE0_ARTIFACT_SCHEMAS = [
  CONTEXT_REF_SCHEMA,
  COMPILATION_SNAPSHOT_SCHEMA,
  PROMPT_PLAN_SCHEMA,
  REQUEST_ENVELOPE_SCHEMA,
  CAPABILITY_GRANT_SCHEMA,
  EFFECT_RECEIPT_SCHEMA,
] as const;

export type Stage0ArtifactSchema = (typeof STAGE0_ARTIFACT_SCHEMAS)[number];

const MAX_ID_LENGTH = 256;
const MAX_REFERENCE_LENGTH = 512;
const MAX_INDEX = 2_147_483_647;

const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

/** Grant/effect action name. "*" is syntactically allowed here so the grant
 *  superRefine can emit the explicit Stage 1 wildcard rejection. */
const actionSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9*._:@/-]*$/);

/** Bounded human-readable purpose; free text is prohibited elsewhere. */
const purposeTextSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[^\r\n]+$/);

const referenceSchema = z
  .string()
  .min(1)
  .max(MAX_REFERENCE_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@%+_-]*$/);

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/);

const isoTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/);

const nonNegativeIndexSchema = z.number().int().nonnegative().max(MAX_INDEX);

export const turnIdentitySchema = z.strictObject({
  sessionKey: idSchema,
  runId: idSchema,
  attemptIndex: nonNegativeIndexSchema,
  modelCallIndex: nonNegativeIndexSchema,
});

export type TurnIdentity = z.infer<typeof turnIdentitySchema>;

const registeredTransformSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(["semantic", "non-semantic"]),
  mutates: z.enum(["system_prompt", "messages", "tool_schema", "media", "transport"]),
  version: idSchema,
  registeredDigest: digestSchema,
});

export type RegisteredTransform = z.infer<typeof registeredTransformSchema>;

export const contextRefKindSchema = z.enum(["user_intent", "task_ledger", "tool_result"]);
export type ContextRefKind = z.infer<typeof contextRefKindSchema>;

export const contextRefOwnerSchema = z.enum([
  "transcript",
  "task_ledger",
  "archive",
  "memory",
  "workspace",
  "observability",
]);
export type ContextRefOwner = z.infer<typeof contextRefOwnerSchema>;

const contextRefSchema = z.strictObject({
  schema: z.literal(CONTEXT_REF_SCHEMA),
  refId: idSchema,
  kind: contextRefKindSchema,
  owner: contextRefOwnerSchema,
  sourceRef: referenceSchema,
  revision: idSchema,
  contentDigest: digestSchema,
  acl: z.strictObject({
    scope: z.enum(["turn", "task", "session", "workspace"]),
    allowedActors: z.array(idSchema).min(1),
  }),
  retention: z.strictObject({
    policyId: idSchema,
    expiresAt: isoTimestampSchema.optional(),
  }),
  provenance: z.strictObject({
    producerId: idSchema,
    observedAt: isoTimestampSchema,
    evidenceRefs: z.array(referenceSchema),
  }),
  lifecycle: z.enum(["active", "archived", "evicted"]),
});

export type ContextRef = z.infer<typeof contextRefSchema>;

const contextRefFingerprintSchema = z.strictObject({
  refId: idSchema,
  kind: contextRefKindSchema,
  revision: idSchema,
  contentDigest: digestSchema,
});

const compilationSnapshotSchema = z.strictObject({
  schema: z.literal(COMPILATION_SNAPSHOT_SCHEMA),
  snapshotId: idSchema,
  identity: turnIdentitySchema,
  contextRefs: z.array(contextRefFingerprintSchema).min(1),
  taskLedgerRevision: idSchema,
  catalogEpoch: idSchema,
  policyEpoch: idSchema,
  policyDigest: digestSchema,
  modelProfile: z.strictObject({
    providerId: idSchema,
    modelId: idSchema,
    adapterId: idSchema,
  }),
  transformGraph: z.array(registeredTransformSchema).min(1),
  budget: z.strictObject({
    unit: z.enum(["tokens", "chars"]),
    limit: nonNegativeIndexSchema,
    outputReserve: nonNegativeIndexSchema,
  }),
  snapshotDigest: digestSchema,
  createdAt: isoTimestampSchema,
});

export type CompilationSnapshot = z.infer<typeof compilationSnapshotSchema>;

export const projectionModeSchema = z.enum(["verbatim", "summary", "index_only"]);
export type ProjectionMode = z.infer<typeof projectionModeSchema>;

const promptPlanDecisionSchema = z.strictObject({
  refId: idSchema,
  order: nonNegativeIndexSchema,
  projection: projectionModeSchema,
  basis: contextRefKindSchema,
  budgetUnits: nonNegativeIndexSchema,
});

const promptPlanOmissionReasonSchema = z.enum([
  "duplicate",
  "budget-drop",
  "budget-truncate",
  "flag-off",
  "kill-switch",
  "stale",
  "sensitivity",
  "policy-denied",
]);

const promptPlanSchema = z
  .strictObject({
    schema: z.literal(PROMPT_PLAN_SCHEMA),
    planId: idSchema,
    snapshotId: idSchema,
    identity: turnIdentitySchema,
    selected: z.array(promptPlanDecisionSchema).min(1),
    omitted: z.array(
      z.strictObject({
        refId: idSchema,
        reason: promptPlanOmissionReasonSchema,
        policyDigest: digestSchema,
      }),
    ),
    order: z.array(idSchema).min(1),
    budget: z.strictObject({
      unit: z.enum(["tokens", "chars"]),
      requested: nonNegativeIndexSchema,
      applied: nonNegativeIndexSchema,
      outputReserve: nonNegativeIndexSchema,
    }),
    why: z.strictObject({
      policyDigest: digestSchema,
      policyEpoch: idSchema,
      ruleId: idSchema,
    }),
    planDigest: digestSchema,
    sealed: z.boolean(),
    createdAt: isoTimestampSchema,
  })
  .superRefine((plan, ctx) => {
    const selectedRefs = plan.selected.map((entry) => entry.refId);
    const omittedRefs = new Set(plan.omitted.map((entry) => entry.refId));
    if (selectedRefs.some((refId) => omittedRefs.has(refId))) {
      ctx.addIssue({
        code: "custom",
        message: "PromptPlan selected and omitted refs must be disjoint",
      });
    }
    if (plan.order.length !== selectedRefs.length) {
      ctx.addIssue({
        code: "custom",
        message: "PromptPlan order must contain exactly the selected refs",
      });
      return;
    }
    const orderCounts = new Map<string, number>();
    for (const refId of plan.order) {
      orderCounts.set(refId, (orderCounts.get(refId) ?? 0) + 1);
    }
    for (const refId of selectedRefs) {
      if (orderCounts.get(refId) !== 1) {
        ctx.addIssue({
          code: "custom",
          message: `PromptPlan selected ref ${refId} must appear exactly once in order`,
        });
      }
    }
    if (plan.budget.applied > plan.budget.requested) {
      ctx.addIssue({
        code: "custom",
        message: "PromptPlan budget.applied must not exceed budget.requested",
      });
    }
  });

export type PromptPlan = z.infer<typeof promptPlanSchema>;

const requestEnvelopeSchema = z.strictObject({
  schema: z.literal(REQUEST_ENVELOPE_SCHEMA),
  envelopeId: idSchema,
  planId: idSchema,
  snapshotId: idSchema,
  identity: turnIdentitySchema,
  system: z.unknown(),
  messages: z.array(z.unknown()),
  tools: z.array(z.unknown()),
  media: z.array(z.unknown()),
  transforms: z.array(registeredTransformSchema).min(1),
  transport: z.strictObject({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    targetOrigin: referenceSchema,
    endpointClass: z.enum(["public", "custom", "local"]),
    providerId: idSchema,
    adapterId: idSchema,
    modelId: idSchema,
  }),
  envelopeDigest: digestSchema,
  createdAt: isoTimestampSchema,
});

export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;

const capabilityGrantSchema = z
  .strictObject({
    schema: z.literal(CAPABILITY_GRANT_SCHEMA),
    grantId: idSchema,
    derivation: z.strictObject({
      ruleId: idSchema,
      ruleVersion: idSchema,
      policyDigest: digestSchema,
      inputRefs: z.array(referenceSchema).min(1),
    }),
    actor: z.strictObject({
      sessionKey: idSchema,
      runId: idSchema,
      attemptIndex: nonNegativeIndexSchema,
      modelCallIndex: nonNegativeIndexSchema,
      actorKind: z.enum(["principal", "delegate"]),
    }),
    scope: z.strictObject({
      taskBranchId: idSchema,
      resource: referenceSchema,
      action: actionSchema,
      purpose: purposeTextSchema,
    }),
    approvalRef: z.strictObject({
      approvalId: idSchema,
      decision: z.literal("approved"),
      resolvedBy: idSchema,
      policyDigest: digestSchema,
    }),
    ttl: z.strictObject({
      issuedAt: isoTimestampSchema,
      expiresAt: isoTimestampSchema,
    }),
    effectIdempotency: z.strictObject({
      key: idSchema,
      namespace: idSchema,
    }),
    delegation: z
      .strictObject({
        parentGrantId: idSchema,
        maxDepth: nonNegativeIndexSchema,
      })
      .optional(),
    revocation: z
      .strictObject({
        revokedAt: isoTimestampSchema,
        reason: idSchema,
        revocationEpoch: idSchema,
      })
      .optional(),
    status: z.enum(["proposed", "active", "expired", "revoked"]),
  })
  .superRefine((grant, ctx) => {
    if (grant.scope.action === "*") {
      ctx.addIssue({
        code: "custom",
        message: "Stage 1 minimal grant forbids wildcard action",
      });
    }
    if (grant.ttl.expiresAt <= grant.ttl.issuedAt) {
      ctx.addIssue({
        code: "custom",
        message: "CapabilityGrant ttl.expiresAt must be after ttl.issuedAt",
      });
    }
    if (grant.status === "revoked" && !grant.revocation) {
      ctx.addIssue({
        code: "custom",
        message: "CapabilityGrant status=revoked requires revocation metadata",
      });
    }
    if (grant.revocation && grant.status !== "revoked") {
      ctx.addIssue({
        code: "custom",
        message: "CapabilityGrant revocation metadata requires status=revoked",
      });
    }
  });

export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;

const effectReceiptSchema = z
  .strictObject({
    schema: z.literal(EFFECT_RECEIPT_SCHEMA),
    receiptId: idSchema,
    idempotencyKey: idSchema,
    approvalRef: z.strictObject({
      approvalId: idSchema,
      decision: z.enum(["approved", "denied"]),
      policyDigest: digestSchema,
    }),
    actor: z.strictObject({
      sessionKey: idSchema,
      runId: idSchema,
      attemptIndex: nonNegativeIndexSchema,
      modelCallIndex: nonNegativeIndexSchema,
      actorKind: z.enum(["principal", "delegate"]),
    }),
    effect: z.strictObject({
      toolCallId: idSchema,
      toolName: idSchema,
      resource: referenceSchema,
      action: actionSchema,
    }),
    outcome: z.enum(["applied", "not_applied", "unknown", "reconciled"]),
    proposalDigest: digestSchema,
    journalRef: referenceSchema.optional(),
    artifactRef: referenceSchema.optional(),
    recoverability: z.enum(["none-needed", "journal-replay", "reconcile-from-journal"]),
    createdAt: isoTimestampSchema,
  })
  .superRefine((receipt, ctx) => {
    if (receipt.approvalRef.decision === "denied" && receipt.outcome !== "not_applied") {
      ctx.addIssue({
        code: "custom",
        message: "EffectReceipt for a denied approval must have outcome not_applied",
      });
    }
    if (receipt.approvalRef.decision === "approved" && receipt.outcome === "reconciled") {
      ctx.addIssue({
        code: "custom",
        message: "EffectReceipt must record the executor outcome, not a pre-reconciled state",
      });
    }
  });

export type EffectReceipt = z.infer<typeof effectReceiptSchema>;

export const stage0ArtifactValidators = {
  [CONTEXT_REF_SCHEMA]: contextRefSchema,
  [COMPILATION_SNAPSHOT_SCHEMA]: compilationSnapshotSchema,
  [PROMPT_PLAN_SCHEMA]: promptPlanSchema,
  [REQUEST_ENVELOPE_SCHEMA]: requestEnvelopeSchema,
  [CAPABILITY_GRANT_SCHEMA]: capabilityGrantSchema,
  [EFFECT_RECEIPT_SCHEMA]: effectReceiptSchema,
} as const;

export type Stage0Artifact =
  | ContextRef
  | CompilationSnapshot
  | PromptPlan
  | RequestEnvelope
  | CapabilityGrant
  | EffectReceipt;

export function normalizeContextRef(input: unknown): ContextRef {
  return contextRefSchema.parse(input);
}

export function normalizeCompilationSnapshot(input: unknown): CompilationSnapshot {
  return compilationSnapshotSchema.parse(input);
}

export function normalizePromptPlan(input: unknown): PromptPlan {
  return promptPlanSchema.parse(input);
}

export function normalizeRequestEnvelope(input: unknown): RequestEnvelope {
  return requestEnvelopeSchema.parse(input);
}

export function normalizeCapabilityGrant(input: unknown): CapabilityGrant {
  return capabilityGrantSchema.parse(input);
}

export function normalizeEffectReceipt(input: unknown): EffectReceipt {
  return effectReceiptSchema.parse(input);
}

/** Validate a stage 0 artifact without importing production modules. */
export function normalizeStage0Artifact(
  schema: Stage0ArtifactSchema,
  input: unknown,
): Stage0Artifact {
  const validator = stage0ArtifactValidators[schema];
  if (!validator) {
    throw new Error(`Unknown stage 0 artifact schema: ${String(schema)}`);
  }
  return validator.parse(input) as Stage0Artifact;
}
