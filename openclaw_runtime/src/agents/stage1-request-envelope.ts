/**
 * Stage 1 RequestEnvelope observation builder. It runs only when the existing
 * RC-02 shadow path is active and a final providerBody is available at the
 * guarded fetch boundary. It never changes request bytes and never persists
 * raw prompt content; only the envelopeDigest/ref is handed to receipts.
 */
import { createHash, randomUUID } from "node:crypto";

import type {
  RegisteredTransform,
  RequestEnvelope,
} from "../../../shared/types/context-control-plane/artifacts.js";
import {
  canonicalJsonValue,
} from "./approval-ledger.js";
import {
  sealProducerDigest,
  getSealProducer,
  type SealProducerRegistration,
} from "../context-engine/seal-registry.js";
import type {
  ShadowReceiptOptions,
  Stage2PromptPlanCarrier,
  Stage2SnapshotCarrier,
} from "./shadow-census.js";

export const STAGE1_REQUEST_ENVELOPE_SCHEMA = "RequestEnvelope/v1" as const;
export const STAGE1_ENVELOPE_REF_PREFIX = "ref:request-envelope:" as const;

export type Stage1EnvelopeEndpointClass = "public" | "custom" | "local";

export type Stage1EnvelopeBuildInput = {
  /** Final parsed provider body read by buildGuardedModelFetch. */
  body: unknown;
  /** Exact final serialized body anchored by the guard. */
  bodyText: string;
  providerId: string;
  adapterId: string;
  modelId: string;
  url: string;
  method: string;
  endpointClass: Stage1EnvelopeEndpointClass;
  wireAttemptIndex: number;
  shadow: ShadowReceiptOptions;
};

export type Stage1EnvelopeBuildResult =
  | { ok: true; envelope: RequestEnvelope; envelopeRef: string; envelopeDigest: string }
  | {
      ok: false;
      reason:
        | "request-envelope-incomplete"
        | "request-envelope-invalid-body"
        | "request-envelope-identity-missing"
        | "unregistered-transform"
        | "prompt-plan-not-sealed"
        | "snapshot-plan-mismatch";
      unregisteredTransformIds?: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function collectMedia(messages: Array<Record<string, unknown>>): unknown[] {
  const media: unknown[] = [];
  for (const message of messages) {
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
        if (
          type.includes("image") ||
          type.includes("audio") ||
          type.includes("video") ||
          type.includes("file") ||
          isRecord(block.source) ||
          isRecord(block.image_url) ||
          isRecord(block.input_image) ||
          isRecord(block.image_media) ||
          isRecord(block.media)
        ) {
          media.push(block);
        }
      }
    } else if (isRecord(content)) {
      media.push(content);
    }
  }
  return media;
}

function registeredDigest(registration: SealProducerRegistration): string {
  return `sha256:${sealProducerDigest(registration)}`;
}

function toRegisteredTransform(registration: SealProducerRegistration): RegisteredTransform {
  return {
    id: registration.id,
    kind: registration.kind,
    mutates: registration.mutates === "tool-schema" ? "tool_schema" : registration.mutates,
    version: registration.version,
    registeredDigest: registeredDigest(registration),
  };
}

function registeredTransformsForPlan(
  plan: ShadowReceiptOptions["rc03Plan"],
): { transforms: RegisteredTransform[]; unregisteredTransformIds: string[] } {
  if (!plan) return { transforms: [], unregisteredTransformIds: [] };
  const transforms: RegisteredTransform[] = [];
  const unregisteredTransformIds: string[] = [];
  // Only producers that the sealed plan says actually ran may appear in the
  // envelope. The seal registry remains the single owner of registration facts;
  // an id in the plan that is absent from the registry is an unregistered
  // mutation and is reported as a diagnostic instead of being silently skipped.
  for (const producer of plan.preSealProducers) {
    if (!producer.applied) continue;
    const registration = getSealProducer(producer.producerId);
    if (registration) {
      transforms.push(toRegisteredTransform(registration));
    } else {
      unregisteredTransformIds.push(producer.producerId);
    }
  }
  for (const transformId of plan.postSealTransformIds) {
    const registration = getSealProducer(transformId);
    if (registration) {
      transforms.push(toRegisteredTransform(registration));
    } else {
      unregisteredTransformIds.push(transformId);
    }
  }
  return { transforms, unregisteredTransformIds };
}

/**
 * Stage 2 Provider Guard path: consume the frozen DCS snapshot transform graph
 * exactly as compiled. The guard only verifies that every id remains
 * registered; it does not select, sort, filter, or recompile transforms.
 */
function registeredTransformsForStage2Snapshot(
  snapshot: Stage2SnapshotCarrier,
): { transforms: RegisteredTransform[]; unregisteredTransformIds: string[] } {
  const transforms = [...snapshot.transformGraph];
  const unregisteredTransformIds = transforms
    .map((transform) => transform.id)
    .filter((id) => !getSealProducer(id));
  return { transforms, unregisteredTransformIds };
}

function systemFromMessages(messages: Array<Record<string, unknown>>): unknown[] {
  return messages.filter((message) => message.role === "system");
}

function nonSystemMessages(messages: Array<Record<string, unknown>>): unknown[] {
  return messages.filter((message) => message.role !== "system");
}

function normalizeMethod(method: string): RequestEnvelope["transport"]["method"] {
  switch (method.toUpperCase()) {
    case "GET":
      return "GET";
    case "PUT":
      return "PUT";
    case "PATCH":
      return "PATCH";
    case "DELETE":
      return "DELETE";
    default:
      return "POST";
  }
}

export function computeStage1EnvelopeDigest(
  envelope: Omit<RequestEnvelope, "envelopeId" | "createdAt" | "envelopeDigest">,
): string {
  return `sha256:${createHash("sha256").update(canonicalJsonValue(envelope)).digest("hex")}`;
}

/**
 * Build the memory-only RequestEnvelope/v1 at the guarded body boundary.
 * Stage 2: when a sealed PromptPlan + matching snapshot carrier is present the
 * guard consumes exactly those DCS artifacts. Otherwise the Stage 1 RC-03
 * sealed plan remains the legacy fallback. Any failure is an observational
 * diagnostic, never a send-path failure.
 */
export function buildStage1RequestEnvelope(
  input: Stage1EnvelopeBuildInput,
): Stage1EnvelopeBuildResult {
  const body = isRecord(input.body) ? input.body : undefined;
  if (!body) {
    return { ok: false, reason: "request-envelope-invalid-body" };
  }
  const sessionKey = input.shadow.sessionKey;
  const runId = input.shadow.runId;
  if (!sessionKey || !runId) {
    return { ok: false, reason: "request-envelope-identity-missing" };
  }
  const messages = asRecordArray(body.messages);

  const stage2Plan: Stage2PromptPlanCarrier | undefined = input.shadow.stage2PromptPlan;
  const stage2Snapshot: Stage2SnapshotCarrier | undefined = input.shadow.stage2Snapshot;
  let planId: string;
  let snapshotId: string;
  let attemptIndex: number;
  let modelCallIndex: number;
  let transforms: RegisteredTransform[];

  if (stage2Plan || stage2Snapshot) {
    if (!stage2Plan || stage2Plan.sealed !== true) {
      return { ok: false, reason: "prompt-plan-not-sealed" };
    }
    if (!stage2Snapshot || stage2Snapshot.snapshotId !== stage2Plan.snapshotId) {
      return { ok: false, reason: "snapshot-plan-mismatch" };
    }
    planId = stage2Plan.planId;
    snapshotId = stage2Snapshot.snapshotId;
    attemptIndex = stage2Plan.identity.attemptIndex;
    modelCallIndex = stage2Plan.identity.modelCallIndex;
    const stage2Transforms = registeredTransformsForStage2Snapshot(stage2Snapshot);
    if (stage2Transforms.unregisteredTransformIds.length > 0) {
      return {
        ok: false,
        reason: "unregistered-transform",
        unregisteredTransformIds: stage2Transforms.unregisteredTransformIds,
      };
    }
    transforms = stage2Transforms.transforms;
  } else {
    // Legacy Stage 1 RC-03 observational fallback. It remains byte-identical
    // to Stage 1 and is only used when no Stage 2 DCS carrier is present.
    const plan = input.shadow.rc03Plan;
    if (!plan) {
      return { ok: false, reason: "request-envelope-incomplete" };
    }
    planId = plan.planId;
    snapshotId = `snap_stage1:${planId}`;
    attemptIndex = input.shadow.attemptIndex ?? plan.callIndex.attemptIndex;
    modelCallIndex = input.shadow.modelCallIndex ?? plan.callIndex.modelCallIndex;
    const planTransforms = registeredTransformsForPlan(plan);
    if (planTransforms.unregisteredTransformIds.length > 0) {
      return {
        ok: false,
        reason: "unregistered-transform",
        unregisteredTransformIds: planTransforms.unregisteredTransformIds,
      };
    }
    transforms = planTransforms.transforms;
  }

  if (transforms.length === 0) {
    return { ok: false, reason: "request-envelope-incomplete" };
  }
  let targetOrigin: string;
  try {
    targetOrigin = new URL(input.url).origin;
  } catch {
    return { ok: false, reason: "request-envelope-invalid-body" };
  }

  const envelopeWithoutDigest = {
    schema: STAGE1_REQUEST_ENVELOPE_SCHEMA,
    planId,
    snapshotId,
    identity: {
      sessionKey: stage2Plan?.identity.sessionKey ?? sessionKey,
      runId: stage2Plan?.identity.runId ?? runId,
      attemptIndex,
      modelCallIndex,
    },
    system: systemFromMessages(messages),
    messages: nonSystemMessages(messages),
    tools: asUnknownArray(body.tools),
    media: collectMedia(messages),
    transforms,
    transport: {
      method: normalizeMethod(input.method),
      targetOrigin,
      endpointClass: input.endpointClass,
      providerId: input.providerId,
      adapterId: input.adapterId,
      modelId: input.modelId,
    },
  } satisfies Omit<RequestEnvelope, "envelopeId" | "createdAt" | "envelopeDigest">;
  const envelopeDigest = computeStage1EnvelopeDigest(envelopeWithoutDigest);
  const envelopeId = `env_${randomUUID()}`;
  const envelope: RequestEnvelope = {
    ...envelopeWithoutDigest,
    envelopeId,
    envelopeDigest,
    createdAt: new Date().toISOString(),
  };
  return {
    ok: true,
    envelope,
    envelopeRef: `${STAGE1_ENVELOPE_REF_PREFIX}${envelopeDigest.slice("sha256:".length)}`,
    envelopeDigest,
  };
}
