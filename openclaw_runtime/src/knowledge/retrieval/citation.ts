import {
  digestOwnerReadContent,
  evaluateOwnerReadSnapshot,
  matchOwnerReadPin,
  type OwnerReadSnapshotV1,
  type ReadAdmissionContextV1,
} from "../../runtime-core/knowledge-owner-read.js";
import type { ChunkerProfileV1, CitationLocatorV2, KnowledgeChunkV2 } from "./contracts.js";

export function knowledgeChunkId(
  source: KnowledgeChunkV2["source"],
  profile: ChunkerProfileV1,
): string {
  const range = source.locator;
  return `chunk:${digestOwnerReadContent(
    JSON.stringify([
      "KnowledgeChunk/v2",
      source.domain,
      source.authorityId,
      source.namespaceId,
      source.subjectId,
      source.revision,
      source.sourceDigest,
      source.policyEpoch,
      range.coordinateSpace,
      range.startByte,
      range.endByteExclusive,
      range.startLine,
      range.endLine,
      profile.schema,
      profile.version,
      profile.targetTokens,
      profile.maxTokens,
      profile.maxChars,
      profile.overlap,
      profile.tokenizerId,
      profile.tokenizerDigest,
    ]),
  )}`;
}

export function citationLocatorForChunk(chunk: KnowledgeChunkV2): CitationLocatorV2 {
  return {
    schema: "CitationLocator/v2",
    chunkId: chunk.chunkId,
    chunkDigest: chunk.chunkDigest,
    source: structuredClone(chunk.source),
    chunker: structuredClone(chunk.chunker),
  };
}

/** The owner reopens the exact version and range; retrieval prefixes are never quotes. */
export function verifyKnowledgeCitation(input: {
  locator: CitationLocatorV2;
  snapshot: OwnerReadSnapshotV1;
  context: ReadAdmissionContextV1;
  signal?: AbortSignal;
}): { status: "exact-match"; quote: string } | { status: "invalid"; reason: string } {
  const { locator, snapshot, context, signal } = input;
  if (
    locator.schema !== "CitationLocator/v2" ||
    !/^chunk:sha256:[a-f0-9]{64}$/.test(locator.chunkId)
  )
    return { status: "invalid", reason: "invalid_locator" };
  const reason =
    evaluateOwnerReadSnapshot(snapshot, context, { signal }) ??
    matchOwnerReadPin(snapshot, locator.source);
  if (reason) return { status: "invalid", reason };
  if (!locator.chunker || knowledgeChunkId(locator.source, locator.chunker) !== locator.chunkId)
    return { status: "invalid", reason: "chunk_identity_mismatch" };
  if (digestOwnerReadContent(snapshot.content) !== locator.chunkDigest)
    return { status: "invalid", reason: "chunk_digest_mismatch" };
  return { status: "exact-match", quote: snapshot.content };
}
