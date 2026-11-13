import type { AgentMessage } from "../agents/runtime/index.js";
import { digestOwnerReadContent } from "../runtime-core/knowledge-owner-read.js";
import type {
  KnowledgeEvidenceCitation,
  RetainedEvidenceUnit,
  RetainedEvidenceManifestV1,
} from "../runtime-core/knowledge-packing-types.js";
export type {
  KnowledgeCandidatePackingV2,
  RetainedEvidenceManifestV1,
} from "../runtime-core/knowledge-packing-types.js";
import {
  packResolvedChatKnowledgeRef,
  type ResolvedChatKnowledgeRef,
} from "./chat-knowledge-intent.js";
import type { createContextCandidate } from "./context-candidate.js";

export type RetainedKnowledgeProjection = {
  unit: RetainedEvidenceUnit;
  timestamp: string | number;
};

export function knowledgeTextUsage(text: string) {
  const utf8Bytes = Buffer.byteLength(text, "utf8");
  return { chars: text.length, utf8Bytes, estimatedTokens: Math.ceil(utf8Bytes / 4) };
}

/** A conflict group occupies its first member's ordinal and keeps member order. */
export function packKnowledgeCandidates(
  refs: readonly ResolvedChatKnowledgeRef[],
): Array<Parameters<typeof createContextCandidate>[0]> {
  const groups = new Map<string, ResolvedChatKnowledgeRef[]>();
  const seen = new Map<string, string>();
  for (const ref of refs) {
    const key = ref.conflictGroupId ? "conflict:" + ref.conflictGroupId : "chunk:" + ref.refId;
    if (seen.has(ref.refId)) {
      if (seen.get(ref.refId) !== key)
        throw new Error("A knowledge chunk has conflicting packing groups");
      continue;
    }
    seen.set(ref.refId, key);
    const group = groups.get(key) ?? [];
    group.push(ref);
    groups.set(key, group);
  }
  return [...groups].map(([unitId, group]): Parameters<typeof createContextCandidate>[0] => {
    const text = group.map(packResolvedChatKnowledgeRef).join("\n\n");
    const citations = group.map((ref): KnowledgeEvidenceCitation => {
      const snapshot = ref.ownerSnapshot;
      if (!snapshot) throw new Error("DCS knowledge packing requires an owner-bound snapshot");
      return {
        refId: ref.refId,
        ...(ref.intentId ? { intentId: ref.intentId } : {}),
        sourceRef: structuredClone(snapshot.source),
        sourceDigest: snapshot.source.sourceDigest,
        chunkDigest: snapshot.contentDigest,
        retainedBodyChars: snapshot.content.length,
        retainedBodyUtf8Bytes: Buffer.byteLength(snapshot.content, "utf8"),
      };
    });
    return {
      authorityObjectId: "chat-knowledge:" + JSON.stringify(group.map((ref) => ref.refId)),
      authorityVersion: JSON.stringify(group.map((ref) => ref.revision)),
      sourceId: "dcs-knowledge",
      channel: "knowledge",
      target: "message",
      text,
      knowledgePacking: { schema: "KnowledgeCandidatePacking/v2", unitId, citations },
    };
  });
}

/** Reopened model calls account only for projections still present in their messages. */
export function retainedKnowledgeManifest(
  turnId: string,
  records: readonly RetainedKnowledgeProjection[],
  messages: readonly AgentMessage[],
): RetainedEvidenceManifestV1 {
  const units = records
    .filter((record) =>
      messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content === "string" &&
          message.timestamp === record.timestamp &&
          digestOwnerReadContent(message.content) === record.unit.projectionDigest,
      ),
    )
    .map((record) => structuredClone(record.unit));
  return {
    schema: "RetainedEvidenceManifest/v1",
    turnId,
    estimateMethod: "utf8-bytes-div4",
    units,
    retainedChars: units.reduce((sum, unit) => sum + unit.retainedChars, 0),
    retainedUtf8Bytes: units.reduce((sum, unit) => sum + unit.retainedUtf8Bytes, 0),
    estimatedTokens: units.reduce((sum, unit) => sum + unit.estimatedTokens, 0),
  };
}
