import { parseMarkdownSourceBlocks, type MarkdownSourceBlock } from "@openclaw/markdown-core/ir";
import { cjkBigrams } from "../../runtime-core/memory-tokenization.js";
import {
  digestOwnerReadContent,
  evaluateOwnerReadSnapshot,
  type RawSourceLocator,
} from "../../runtime-core/knowledge-owner-read.js";
import { knowledgeChunkId } from "./citation.js";
import type {
  ChunkerProfileV1,
  ChunkKnowledgeOptions,
  KnowledgeChunkV2,
  NormalizedSourceDocumentV1,
} from "./contracts.js";

const HARD_LIMITS = {
  targetTokens: 384,
  maxTokens: 768,
  maxChars: 2400,
} as const;

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validateProfile(value: ChunkerProfileV1): ChunkerProfileV1 {
  if (
    value?.schema !== "ChunkerProfile/v1" ||
    typeof value.version !== "string" ||
    !value.version.trim()
  ) {
    throw new Error("invalid chunker profile");
  }
  if (
    !positiveSafeInteger(value.targetTokens) ||
    !positiveSafeInteger(value.maxTokens) ||
    !positiveSafeInteger(value.maxChars)
  ) {
    throw new Error("chunker token and character limits must be positive safe integers");
  }
  if (value.targetTokens > value.maxTokens) {
    throw new Error("chunker targetTokens cannot exceed maxTokens");
  }
  if (
    value.targetTokens > HARD_LIMITS.targetTokens ||
    value.maxTokens > HARD_LIMITS.maxTokens ||
    value.maxChars > HARD_LIMITS.maxChars
  ) {
    throw new Error("chunker profile exceeds hard limits");
  }
  if (value.overlap !== 0) throw new Error("chunker overlap must be zero");
  if (
    typeof value.tokenizerId !== "string" ||
    typeof value.tokenizerDigest !== "string" ||
    !value.tokenizerId.trim() ||
    !value.tokenizerDigest.trim()
  ) {
    throw new Error("chunker tokenizer identity is required");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value.tokenizerDigest)) {
    throw new Error("chunker tokenizer digest must be sha256");
  }
  return structuredClone(value);
}

function validateDocument(
  document: NormalizedSourceDocumentV1,
  options: ChunkKnowledgeOptions,
): void {
  const rejection = evaluateOwnerReadSnapshot(document.snapshot, options.context, {
    signal: options.signal,
  });
  if (rejection) throw new Error(`knowledge source denied: ${rejection}`);
  if (
    document.schema !== "NormalizedSourceDocument/v1" ||
    document.parser.id !== "owner-markdown/v1" ||
    document.parser.encoding !== "utf-8" ||
    document.parser.normalization !== "identity-raw-utf8" ||
    document.snapshot.content !== document.text
  ) {
    throw new Error("normalized knowledge source does not match its snapshot");
  }
  if (!document.text.trim()) throw new Error("knowledge source is empty");
  if (document.text.includes("\0")) {
    throw new Error("knowledge source is not valid UTF-8 text");
  }

  const bytes = Buffer.from(document.text, "utf8");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("knowledge source exceeds 2 MiB");
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const locator = document.snapshot.source.locator;
  if (
    !locator ||
    locator.coordinateSpace !== "raw-source-utf8-v1" ||
    locator.endByteExclusive - locator.startByte !== bytes.length ||
    digestOwnerReadContent(bytes) !== document.snapshot.contentDigest ||
    decoded !== document.text
  ) {
    throw new Error("knowledge source byte mapping changed");
  }

  const rawLines = [...document.text.matchAll(/[^\n]*\n|[^\n]+$/g)];
  if (rawLines.length !== document.lines.length) {
    throw new Error("knowledge source line map changed");
  }
  let expectedChar = 0;
  let expectedByte = locator.startByte;
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index]![0];
    const row = document.lines[index]!;
    const expectedLine = locator.startLine + index;
    if (
      row.startChar !== expectedChar ||
      row.endChar !== expectedChar + raw.length ||
      row.startByte !== expectedByte ||
      row.endByteExclusive !== expectedByte + Buffer.byteLength(raw, "utf8") ||
      row.rawLine !== expectedLine
    ) {
      throw new Error("knowledge source line map changed");
    }
    expectedChar = row.endChar;
    expectedByte = row.endByteExclusive;
  }
  if (
    expectedChar !== document.text.length ||
    expectedByte !== locator.endByteExclusive ||
    document.lines.at(-1)?.rawLine !== locator.endLine
  ) {
    throw new Error("knowledge source byte mapping changed");
  }
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}:${digestOwnerReadContent(JSON.stringify(value)).slice("sha256:".length)}`;
}

function codepointLength(value: string): number {
  let length = 0;
  for (const _ of value) length += 1;
  return length;
}

function normalizeForRetrieval(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function retrievalFor(
  headingPath: string[],
  quote: string,
  kind: KnowledgeChunkV2["kind"],
): string {
  const prefix = kind === "heading" ? headingPath.slice(0, -1) : headingPath;
  const normalizedPrefix = prefix.map(normalizeForRetrieval).filter(Boolean);
  const normalizedQuote = normalizeForRetrieval(quote);
  return [...normalizedPrefix, normalizedQuote].join("\n\n");
}

function searchTokensFor(text: string): string[] {
  const normalized = text.normalize("NFKC");
  const folded = normalized.toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[\p{L}\p{N}_]+(?:[._/:+-][\p{L}\p{N}_]+)*/gu)) {
    const identifier = match[0];
    tokens.add(identifier.toLowerCase());
    const camelSplit = identifier
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");
    for (const word of camelSplit.split(/[\s._/:+-]+/u)) {
      if (word) tokens.add(word.toLowerCase());
    }
  }
  for (const gram of cjkBigrams(folded)) tokens.add(gram);
  for (const run of folded.match(/[\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) ?? []) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
  }
  return [...tokens];
}

function lineIndexContaining(document: NormalizedSourceDocumentV1, charOffset: number): number {
  let low = 0;
  let high = document.lines.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const row = document.lines[middle]!;
    if (charOffset < row.startChar) high = middle - 1;
    else if (charOffset >= row.endChar) low = middle + 1;
    else return middle;
  }
  throw new Error("knowledge source offset is outside its line map");
}

function lineContaining(
  document: NormalizedSourceDocumentV1,
  charOffset: number,
): NormalizedSourceDocumentV1["lines"][number] {
  return document.lines[lineIndexContaining(document, charOffset)]!;
}

function localLineEnds(
  document: NormalizedSourceDocumentV1,
  startChar: number,
  endChar: number,
  assertActive: () => void,
): number[] {
  const ends: number[] = [];
  for (
    let index = lineIndexContaining(document, startChar);
    index < document.lines.length;
    index += 1
  ) {
    assertActive();
    const row = document.lines[index]!;
    if (row.startChar >= endChar) break;
    if (row.endChar > startChar && row.endChar <= endChar) ends.push(row.endChar);
  }
  return ends;
}

function locatorForRange(
  document: NormalizedSourceDocumentV1,
  startChar: number,
  quote: string,
): RawSourceLocator {
  const startLine = lineContaining(document, startChar);
  const startByte =
    startLine.startByte + Buffer.byteLength(document.text.slice(startLine.startChar, startChar));
  const linesInside = quote.slice(0, -1).match(/\n/g)?.length ?? 0;
  return {
    coordinateSpace: "raw-source-utf8-v1",
    startByte,
    endByteExclusive: startByte + Buffer.byteLength(quote, "utf8"),
    startLine: startLine.rawLine,
    endLine: startLine.rawLine + linesInside,
  };
}

function sourceForRange(
  document: NormalizedSourceDocumentV1,
  startChar: number,
  quote: string,
): KnowledgeChunkV2["source"] {
  return {
    ...structuredClone(document.snapshot.source),
    locator: locatorForRange(document, startChar, quote),
  };
}

function sourceParentId(document: NormalizedSourceDocumentV1): string {
  const source = document.snapshot.source;
  return stableId("parent", [
    source.domain,
    source.authorityId,
    source.namespaceId,
    source.subjectId,
    source.revision,
    source.sourceDigest,
    source.policyEpoch,
  ]);
}

function semanticRanges(
  document: NormalizedSourceDocumentV1,
  blocks: MarkdownSourceBlock[],
): Array<{ block: MarkdownSourceBlock; startChar: number; endChar: number }> {
  const starts: Array<{ block: MarkdownSourceBlock; startChar: number }> = [];
  const seen = new Set<number>();
  for (const block of blocks) {
    const row = document.lines[block.startLine];
    if (!row || seen.has(row.startChar)) continue;
    seen.add(row.startChar);
    starts.push({ block, startChar: row.startChar });
  }
  if (starts.length === 0) {
    return [
      {
        block: { kind: "other", startLine: 0, endLine: document.lines.length },
        startChar: 0,
        endChar: document.text.length,
      },
    ];
  }
  starts[0]!.startChar = 0;
  return starts.map((entry, index) => ({
    block: entry.block,
    startChar: entry.startChar,
    endChar: starts[index + 1]?.startChar ?? document.text.length,
  }));
}

export function chunkKnowledgeDocument(
  document: NormalizedSourceDocumentV1,
  options: ChunkKnowledgeOptions,
): KnowledgeChunkV2[] {
  validateDocument(document, options);
  const profile = validateProfile(options.profile);
  if (
    options.tokenizer.id !== profile.tokenizerId ||
    options.tokenizer.digest !== profile.tokenizerDigest
  ) {
    throw new Error("chunker tokenizer identity does not match profile");
  }

  const assertActive = (): void => {
    if (options.signal?.aborted) {
      const error = new Error("knowledge chunking aborted");
      error.name = "AbortError";
      throw error;
    }
  };
  const countTokens = (text: string): number => {
    assertActive();
    const count = options.tokenizer.count(text);
    assertActive();
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("tokenizer count must be a finite non-negative integer");
    }
    return count;
  };

  const blocks = parseMarkdownSourceBlocks(document.text);
  const ranges = semanticRanges(document, blocks);
  const parentId = sourceParentId(document);
  const headingStack: Array<{ level: number; text: string; startLine: number }> = [];
  const chunks: KnowledgeChunkV2[] = [];

  const fits = (
    startChar: number,
    endChar: number,
    tokenLimit: number,
    headingPath: string[],
    kind: KnowledgeChunkV2["kind"],
  ): boolean => {
    // UTF-16 units are never fewer than code points, so this avoids normalizing huge tails.
    if (endChar - startChar > profile.maxChars * 2) return false;
    const quote = document.text.slice(startChar, endChar);
    const retrievalText = retrievalFor(headingPath, quote, kind);
    return (
      codepointLength(retrievalText) <= profile.maxChars && countTokens(retrievalText) <= tokenLimit
    );
  };

  // Tokenizer prefix counts are not generally monotone. Inspect every candidate in the
  // bounded character window and retain the furthest target/max fit without binary inference.
  const findEnd = (
    startChar: number,
    endChar: number,
    headingPath: string[],
    kind: KnowledgeChunkV2["kind"],
  ): { targetEnd: number; maxEnd: number } => {
    const pointEnds = new Set<number>();
    let scanEnd = startChar;
    let scannedCodepoints = 0;
    while (scanEnd < endChar && scannedCodepoints < profile.maxChars) {
      assertActive();
      const codePoint = document.text.codePointAt(scanEnd)!;
      let next = scanEnd + (codePoint > 0xffff ? 2 : 1);
      let width = 1;
      if (document.text.charCodeAt(next - 1) === 0x0d && document.text.charCodeAt(next) === 0x0a) {
        next += 1;
        width = 2;
      }
      if (scannedCodepoints + width > profile.maxChars) break;
      scannedCodepoints += width;
      scanEnd = next;
      pointEnds.add(next);
    }
    for (const lineEnd of localLineEnds(document, startChar, scanEnd, assertActive)) {
      pointEnds.add(lineEnd);
    }

    let targetEnd = startChar;
    let maxEnd = startChar;
    for (const candidate of [...pointEnds].sort((left, right) => left - right)) {
      assertActive();
      const quote = document.text.slice(startChar, candidate);
      const retrievalText = retrievalFor(headingPath, quote, kind);
      if (codepointLength(retrievalText) > profile.maxChars) continue;
      const tokenCount = countTokens(retrievalText);
      if (tokenCount <= profile.targetTokens) targetEnd = candidate;
      if (tokenCount <= profile.maxTokens) maxEnd = candidate;
    }
    return { targetEnd, maxEnd };
  };

  for (const range of ranges) {
    assertActive();
    const block = range.block;
    let headingPath: string[];
    if (block.kind === "heading") {
      const level = block.headingLevel ?? 1;
      while (headingStack.at(-1)?.level !== undefined && headingStack.at(-1)!.level >= level) {
        headingStack.pop();
      }
      headingStack.push({
        level,
        text: block.headingText ?? document.text.slice(range.startChar, range.endChar).trim(),
        startLine: block.startLine,
      });
      headingPath = headingStack.map((entry) => entry.text);
    } else {
      headingPath = headingStack.map((entry) => entry.text);
    }

    // The heading's source line distinguishes repeated headings with the same title.
    const currentHeading = headingStack.at(-1);
    const sectionId = currentHeading
      ? stableId("section", [parentId, currentHeading.startLine, headingPath])
      : stableId("section", [parentId, "root"]);
    let startChar = range.startChar;
    while (startChar < range.endChar) {
      assertActive();
      let endChar = range.endChar;
      if (!fits(startChar, endChar, profile.maxTokens, headingPath, block.kind)) {
        const found = findEnd(startChar, range.endChar, headingPath, block.kind);
        endChar = found.targetEnd > startChar ? found.targetEnd : found.maxEnd;
      }
      if (endChar <= startChar) {
        throw new Error("chunk budget cannot hold a single Unicode code point");
      }

      const quote = document.text.slice(startChar, endChar);
      const retrievalText = retrievalFor(headingPath, quote, block.kind);
      const tokenCount = countTokens(retrievalText);
      if (codepointLength(retrievalText) > profile.maxChars || tokenCount > profile.maxTokens) {
        throw new Error("chunk budget was exceeded");
      }
      const source = sourceForRange(document, startChar, quote);
      chunks.push({
        schema: "KnowledgeChunk/v2",
        chunkId: knowledgeChunkId(source, profile),
        parentId,
        sectionId,
        ordinal: chunks.length,
        kind: block.kind,
        headingPath,
        source,
        quote,
        chunkDigest: digestOwnerReadContent(quote),
        retrievalText,
        searchTokens: searchTokensFor([...headingPath, quote].join("\n\n")),
        tokenCount,
        chunker: structuredClone(profile),
      });
      startChar = endChar;
    }
  }

  const finalRejection = evaluateOwnerReadSnapshot(document.snapshot, options.context, {
    signal: options.signal,
  });
  if (finalRejection) throw new Error(`knowledge source denied: ${finalRejection}`);
  return chunks;
}
