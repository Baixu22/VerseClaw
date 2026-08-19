import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CAPABILITY_GRANT_SCHEMA,
  COMPILATION_SNAPSHOT_SCHEMA,
  CONTEXT_REF_SCHEMA,
  EFFECT_RECEIPT_SCHEMA,
  PROMPT_PLAN_SCHEMA,
  REQUEST_ENVELOPE_SCHEMA,
  STAGE0_ARTIFACT_SCHEMAS,
  normalizeCapabilityGrant,
  normalizeCompilationSnapshot,
  normalizeContextRef,
  normalizeEffectReceipt,
  normalizePromptPlan,
  normalizeRequestEnvelope,
  normalizeStage0Artifact,
} from "../../shared/types/context-control-plane/artifacts";

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const AT = "2026-08-16T00:00:00.000Z";
const IDENTITY = {
  sessionKey: "session-golden",
  runId: "run-golden-1",
  attemptIndex: 0,
  modelCallIndex: 0,
};

const TRANSFORMS = [
  {
    id: "dcs-user-intent",
    kind: "semantic" as const,
    mutates: "messages" as const,
    version: "1",
    registeredDigest: sha256("dcs-user-intent:1"),
  },
  {
    id: "transport-wire-serialization",
    kind: "non-semantic" as const,
    mutates: "transport" as const,
    version: "1",
    registeredDigest: sha256("transport-wire-serialization:1"),
  },
];

const CONTEXT_REFS = [
  {
    schema: CONTEXT_REF_SCHEMA,
    refId: "ctxref:transcript:user-1",
    kind: "user_intent" as const,
    owner: "transcript" as const,
    sourceRef: "transcript:session-golden/entry-user-1",
    revision: "1",
    contentDigest: sha256("user intent"),
    acl: { scope: "turn" as const, allowedActors: ["session-golden"] },
    retention: { policyId: "transcript-retention-v1" },
    provenance: {
      producerId: "identity-adapter",
      observedAt: AT,
      evidenceRefs: ["transcript:session-golden/entry-user-1"],
    },
    lifecycle: "active" as const,
  },
  {
    schema: CONTEXT_REF_SCHEMA,
    refId: "ctxref:task-ledger:task-1",
    kind: "task_ledger" as const,
    owner: "task_ledger" as const,
    sourceRef: "task-ledger:workspace-demo/task-1",
    revision: "4",
    contentDigest: sha256("task ledger revision 4"),
    acl: { scope: "task" as const, allowedActors: ["session-golden"] },
    retention: { policyId: "task-ledger-retention-v1" },
    provenance: {
      producerId: "task-ledger-adapter",
      observedAt: AT,
      evidenceRefs: ["task-ledger:workspace-demo/task-1"],
    },
    lifecycle: "active" as const,
  },
  {
    schema: CONTEXT_REF_SCHEMA,
    refId: "ctxref:archive:tool-result-1",
    kind: "tool_result" as const,
    owner: "archive" as const,
    sourceRef: "archive:tool-result-1",
    revision: "1",
    contentDigest: sha256("tool result"),
    acl: { scope: "turn" as const, allowedActors: ["session-golden"] },
    retention: { policyId: "archive-retention-v1" },
    provenance: {
      producerId: "tool-result-adapter",
      observedAt: AT,
      evidenceRefs: ["archive:tool-result-1"],
    },
    lifecycle: "active" as const,
  },
];

const makeSnapshot = () => ({
  schema: COMPILATION_SNAPSHOT_SCHEMA,
  snapshotId: "snap_golden_1",
  identity: IDENTITY,
  contextRefs: CONTEXT_REFS.map(({ refId, kind, revision, contentDigest }) => ({
    refId,
    kind,
    revision,
    contentDigest,
  })),
  taskLedgerRevision: "4",
  catalogEpoch: "catalog-epoch-7",
  policyEpoch: "policy-epoch-3",
  policyDigest: sha256("golden-policy"),
  modelProfile: { providerId: "anthropic", modelId: "claude-test", adapterId: "anthropic-messages" },
  transformGraph: TRANSFORMS,
  budget: { unit: "tokens" as const, limit: 20_000, outputReserve: 2_000 },
  snapshotDigest: sha256("snapshot-content"),
  createdAt: AT,
});

const makePlan = () => ({
  schema: PROMPT_PLAN_SCHEMA,
  planId: "plan_golden_1",
  snapshotId: "snap_golden_1",
  identity: IDENTITY,
  selected: [
    {
      refId: "ctxref:transcript:user-1",
      order: 0,
      projection: "verbatim" as const,
      basis: "user_intent" as const,
      budgetUnits: 120,
    },
    {
      refId: "ctxref:task-ledger:task-1",
      order: 1,
      projection: "summary" as const,
      basis: "task_ledger" as const,
      budgetUnits: 400,
    },
  ],
  omitted: [
    {
      refId: "ctxref:archive:tool-result-1",
      reason: "budget-drop" as const,
      policyDigest: sha256("golden-policy"),
    },
  ],
  order: ["ctxref:transcript:user-1", "ctxref:task-ledger:task-1"],
  budget: { unit: "chars" as const, requested: 1_200, applied: 520, outputReserve: 400 },
  why: {
    policyDigest: sha256("golden-policy"),
    policyEpoch: "policy-epoch-3",
    ruleId: "dcs-pack-golden-v1",
  },
  planDigest: sha256("prompt-plan"),
  sealed: true,
  createdAt: AT,
});

const makeEnvelope = () => ({
  schema: REQUEST_ENVELOPE_SCHEMA,
  envelopeId: "env_golden_1",
  planId: "plan_golden_1",
  snapshotId: "snap_golden_1",
  identity: IDENTITY,
  system: "golden system prompt",
  messages: [{ role: "user", content: "fix the test" }],
  tools: [{ name: "write", description: "write a file" }],
  media: [],
  transforms: TRANSFORMS,
  transport: {
    method: "POST" as const,
    targetOrigin: "https://api.example.invalid",
    endpointClass: "public" as const,
    providerId: "anthropic",
    adapterId: "anthropic-messages",
    modelId: "claude-test",
  },
  envelopeDigest: sha256("request-envelope"),
  createdAt: AT,
});

const makeGrant = () => ({
  schema: CAPABILITY_GRANT_SCHEMA,
  grantId: "grant_golden_1",
  derivation: {
    ruleId: "grant-adapter-v1",
    ruleVersion: "1",
    policyDigest: sha256("golden-policy"),
    inputRefs: ["aprv_golden_1", "plan_golden_1"],
  },
  actor: { ...IDENTITY, actorKind: "principal" as const },
  scope: {
    taskBranchId: "task-1",
    resource: "tool:write",
    action: "write-file",
    purpose: "apply requested patch",
  },
  approvalRef: {
    approvalId: "aprv_golden_1",
    decision: "approved" as const,
    resolvedBy: "operator-inbox",
    policyDigest: sha256("approval-policy"),
  },
  ttl: { issuedAt: AT, expiresAt: "2026-08-16T00:00:05.000Z" },
  effectIdempotency: { key: "efx:grant_golden_1:aprv_golden_1", namespace: "tool:write" },
  status: "active" as const,
});

const makeReceipt = () => ({
  schema: EFFECT_RECEIPT_SCHEMA,
  receiptId: "efx_golden_1",
  idempotencyKey: "efx:grant_golden_1:aprv_golden_1",
  approvalRef: {
    approvalId: "aprv_golden_1",
    decision: "approved" as const,
    policyDigest: sha256("approval-policy"),
  },
  actor: { ...IDENTITY, actorKind: "principal" as const },
  effect: {
    toolCallId: "toolcall_golden_1",
    toolName: "write",
    resource: "file:src/example.ts",
    action: "write-file",
  },
  outcome: "applied" as const,
  proposalDigest: sha256("proposal"),
  journalRef: "journal:file:src/example.ts",
  recoverability: "none-needed" as const,
  createdAt: AT,
});

describe("Stage 0 context control plane contracts", () => {
  it("validates all six artifacts through their typed normalizers", () => {
    const contextRefs = CONTEXT_REFS.map(normalizeContextRef);
    expect(contextRefs).toHaveLength(3);
    expect(contextRefs[0].kind).toBe("user_intent");

    const snapshot = normalizeCompilationSnapshot(makeSnapshot());
    expect(snapshot.snapshotDigest).toBe(sha256("snapshot-content"));

    const plan = normalizePromptPlan(makePlan());
    expect(plan.sealed).toBe(true);

    const envelope = normalizeRequestEnvelope(makeEnvelope());
    expect(envelope.transforms).toHaveLength(2);

    const grant = normalizeCapabilityGrant(makeGrant());
    expect(grant.status).toBe("active");

    const receipt = normalizeEffectReceipt(makeReceipt());
    expect(receipt.outcome).toBe("applied");
  });

  it("dispatches all six schema literals through one validation entry point", () => {
    const fixtures: Record<string, unknown> = {
      [CONTEXT_REF_SCHEMA]: CONTEXT_REFS[0],
      [COMPILATION_SNAPSHOT_SCHEMA]: makeSnapshot(),
      [PROMPT_PLAN_SCHEMA]: makePlan(),
      [REQUEST_ENVELOPE_SCHEMA]: makeEnvelope(),
      [CAPABILITY_GRANT_SCHEMA]: makeGrant(),
      [EFFECT_RECEIPT_SCHEMA]: makeReceipt(),
    };
    for (const schema of STAGE0_ARTIFACT_SCHEMAS) {
      const normalized = normalizeStage0Artifact(schema, fixtures[schema]);
      expect(normalized.schema).toBe(schema);
    }
    expect(() => normalizeStage0Artifact("Unknown/v1" as never, {})).toThrow(
      /Unknown stage 0 artifact schema/,
    );
  });

  it("rejects unknown payload fields on ContextRef so refs never carry raw content", () => {
    expect(() =>
      normalizeContextRef({ ...CONTEXT_REFS[0], payload: { role: "user", text: "raw" } }),
    ).toThrow();
    expect(() =>
      normalizeContextRef({ ...CONTEXT_REFS[0], summary: "derived text is still content" }),
    ).toThrow();
  });

  it("rejects raw proposal and raw tool output fields on EffectReceipt", () => {
    expect(() => normalizeEffectReceipt({ ...makeReceipt(), rawProposal: { file: "x" } })).toThrow();
    expect(() => normalizeEffectReceipt({ ...makeReceipt(), toolOutput: "file contents" })).toThrow();
  });

  it("requires RequestEnvelope coverage of system/messages/tools/media/transforms", () => {
    const { media: _media, ...noMedia } = makeEnvelope();
    expect(() => normalizeRequestEnvelope(noMedia)).toThrow();
    expect(() => normalizeRequestEnvelope({ ...makeEnvelope(), transforms: [] })).toThrow();
  });

  it("rejects a PromptPlan where selected and omitted overlap", () => {
    const plan = makePlan();
    expect(() =>
      normalizePromptPlan({
        ...plan,
        omitted: [{ refId: plan.selected[0].refId, reason: "duplicate", policyDigest: sha256("p") }],
      }),
    ).toThrow(/disjoint/);
  });

  it("rejects a PromptPlan whose order does not cover selected refs exactly once", () => {
    const plan = makePlan();
    expect(() => normalizePromptPlan({ ...plan, order: [plan.selected[0].refId] })).toThrow(/order/);
    expect(() =>
      normalizePromptPlan({ ...plan, order: [plan.selected[0].refId, plan.selected[0].refId] }),
    ).toThrow(/exactly once/);
  });

  it("enforces derived short-lived grant constraints", () => {
    expect(() => normalizeCapabilityGrant({ ...makeGrant(), scope: { ...makeGrant().scope, action: "*" } })).toThrow(
      /wildcard/,
    );
    expect(() =>
      normalizeCapabilityGrant({
        ...makeGrant(),
        ttl: { issuedAt: AT, expiresAt: AT },
      }),
    ).toThrow(/expiresAt/);
    expect(() =>
      normalizeCapabilityGrant({ ...makeGrant(), status: "revoked" as const }),
    ).toThrow(/revocation/);
  });

  it("keeps denied effects out of applied outcomes", () => {
    expect(() =>
      normalizeEffectReceipt({
        ...makeReceipt(),
        approvalRef: {
          ...makeReceipt().approvalRef,
          decision: "denied" as const,
        },
        outcome: "applied" as const,
      }),
    ).toThrow(/denied/);
  });

  it("rejects snapshot with no context refs", () => {
    expect(() => normalizeCompilationSnapshot({ ...makeSnapshot(), contextRefs: [] })).toThrow();
  });
});
