import {
  chunkKnowledgeDocument,
  normalizeKnowledgeSourceDocument,
  verifyKnowledgeCitation,
  type ChunkerProfileV1,
  type CitationLocatorV2,
  type KnowledgeTokenizer,
  type SourceProvenance,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import { getMemoryWikiPage } from "./query.js";

type WikiReadInput = Parameters<typeof getMemoryWikiPage>[0];

function provenance(
  sourceType: string | undefined,
  sourcePath: string | undefined,
): SourceProvenance {
  const kind =
    sourceType === "local-file" || sourceType === "file"
      ? "file"
      : sourceType === "directory" || sourceType === "watched-directory"
        ? "directory"
        : sourceType === "github" || sourceType === "github-public-directory"
          ? "github"
          : "wiki";
  return { kind, ...(sourcePath ? { sourcePath } : {}) };
}

/** Read through the existing owner, which rechecks the file and policy before return. */
export async function readMemoryWikiRetrievalChunks(
  input: WikiReadInput & {
    profile: ChunkerProfileV1;
    tokenizer: KnowledgeTokenizer;
  },
) {
  const result = await getMemoryWikiPage({
    ...input,
    fromLine: 1,
    lineCount: Number.MAX_SAFE_INTEGER,
  });
  if (!result || result.status === "denied" || !result.ownerSnapshot) {
    return { status: "denied" as const, reason: result?.reason ?? "not_found" };
  }
  if (result.truncated) return { status: "denied" as const, reason: "incomplete_source" };
  const snapshot = result.ownerSnapshot;
  const document = normalizeKnowledgeSourceDocument({
    snapshot,
    context: snapshot.context,
    provenance: provenance(result.sourceType, result.sourcePath),
    signal: input.signal,
  });
  const chunks = chunkKnowledgeDocument(document, {
    context: snapshot.context,
    profile: input.profile,
    tokenizer: input.tokenizer,
    signal: input.signal,
  });
  return { status: "admitted" as const, document, chunks };
}

export async function readMemoryWikiChunkCitation(
  input: Omit<WikiReadInput, "sourceRef"> & { locator: CitationLocatorV2 },
) {
  const result = await getMemoryWikiPage({ ...input, sourceRef: input.locator.source });
  if (!result || result.status === "denied" || !result.ownerSnapshot)
    return { status: "invalid" as const, reason: result?.reason ?? "not_found" };
  return verifyKnowledgeCitation({
    locator: input.locator,
    snapshot: result.ownerSnapshot,
    context: result.ownerSnapshot.context,
    signal: input.signal,
  });
}
