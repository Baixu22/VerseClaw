import {
  digestOwnerReadContent,
  evaluateOwnerReadSnapshot,
  type OwnerReadSnapshotV1,
  type ReadAdmissionContextV1,
} from "../../runtime-core/knowledge-owner-read.js";
import type { NormalizedSourceDocumentV1, SourceProvenance } from "./contracts.js";

export function normalizeKnowledgeSourceDocument(input: {
  snapshot: OwnerReadSnapshotV1;
  context: ReadAdmissionContextV1;
  provenance?: SourceProvenance;
  signal?: AbortSignal;
}): NormalizedSourceDocumentV1 {
  const reason = evaluateOwnerReadSnapshot(input.snapshot, input.context, { signal: input.signal });
  if (reason) throw new Error(`knowledge source denied: ${reason}`);
  const text = input.snapshot.content;
  if (!text.trim()) throw new Error("knowledge source is empty");
  if (text.includes("\0")) throw new Error("knowledge source is not valid UTF-8 text");
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("knowledge source exceeds 2 MiB");
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (decoded !== text || digestOwnerReadContent(bytes) !== input.snapshot.contentDigest)
    throw new Error("knowledge source byte mapping changed");
  const range = input.snapshot.source.locator!;
  let startChar = 0,
    startByte = range.startByte,
    rawLine = range.startLine;
  const lines = [...text.matchAll(/[^\n]*\n|[^\n]+$/g)].map((match) => {
    const row = {
      startChar,
      endChar: startChar + match[0].length,
      startByte,
      endByteExclusive: startByte + Buffer.byteLength(match[0], "utf8"),
      rawLine,
    };
    startChar = row.endChar;
    startByte = row.endByteExclusive;
    rawLine++;
    return row;
  });
  if (
    startByte !== range.endByteExclusive ||
    (lines.at(-1)?.rawLine ?? range.startLine) !== range.endLine
  )
    throw new Error("knowledge source raw line mapping changed");
  return {
    schema: "NormalizedSourceDocument/v1",
    snapshot: structuredClone(input.snapshot),
    text,
    parser: { id: "owner-markdown/v1", encoding: "utf-8", normalization: "identity-raw-utf8" },
    provenance: {
      ...(input.provenance ?? { kind: "wiki" }),
      sourceRevision: input.provenance?.sourceRevision ?? input.snapshot.source.revision,
    },
    lines,
  };
}
