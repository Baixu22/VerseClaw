import { digestOwnerReadContent } from "../../runtime-core/knowledge-owner-read.js";

export type EmbeddingSpaceDescriptor = {
  providerRef: string;
  model: string;
  modelRevision: string;
  dimensions: number;
  maxInputTokens: number;
  tokenizerId: string;
  tokenizerDigest: string;
  inputFormat: { id: string; query: string; document: string };
  normalization: "l2" | "none";
};

export type EmbeddingSpaceV1 = EmbeddingSpaceDescriptor & {
  schema: "EmbeddingSpace/v1";
  spaceId: string;
};

export type ProviderCapabilitySnapshotV1 = {
  schema: "ProviderCapabilitySnapshot/v1";
  providerRef: string;
  transport: "local" | "remote";
  credentialEpoch: number;
  observedAt: string;
} & (
  | { status: "ready"; space: EmbeddingSpaceV1 }
  | { status: "unavailable" | "installing" | "warming" | "cancelled"; reason: string }
);

/** Every input-affecting fact participates in identity; credentials stay outside the space. */
export function createEmbeddingSpace(input: EmbeddingSpaceDescriptor): EmbeddingSpaceV1 {
  if (
    ![
      input.providerRef,
      input.model,
      input.modelRevision,
      input.tokenizerId,
      input.inputFormat.id,
    ].every((value) => typeof value === "string" && value.trim().length > 0) ||
    !/^sha256:[a-f0-9]{64}$/.test(input.tokenizerDigest) ||
    !Number.isSafeInteger(input.dimensions) ||
    input.dimensions <= 0 ||
    !Number.isSafeInteger(input.maxInputTokens) ||
    input.maxInputTokens <= 0 ||
    !["l2", "none"].includes(input.normalization)
  ) {
    throw new Error("Invalid embedding space descriptor");
  }
  for (const template of [input.inputFormat.query, input.inputFormat.document]) {
    if (typeof template !== "string" || template.split("{text}").length !== 2) {
      throw new Error("Embedding input format must retain text exactly once");
    }
  }
  const descriptor: EmbeddingSpaceDescriptor = {
    providerRef: input.providerRef,
    model: input.model,
    modelRevision: input.modelRevision,
    dimensions: input.dimensions,
    maxInputTokens: input.maxInputTokens,
    tokenizerId: input.tokenizerId,
    tokenizerDigest: input.tokenizerDigest,
    inputFormat: Object.freeze({
      id: input.inputFormat.id,
      query: input.inputFormat.query,
      document: input.inputFormat.document,
    }),
    normalization: input.normalization,
  };
  return Object.freeze({
    schema: "EmbeddingSpace/v1",
    spaceId: digestOwnerReadContent(JSON.stringify(descriptor)),
    ...descriptor,
  });
}

export function assertSameEmbeddingSpace(expected: EmbeddingSpaceV1, actual: EmbeddingSpaceV1) {
  if (
    expected.spaceId !== actual.spaceId ||
    createEmbeddingSpace(expected).spaceId !== expected.spaceId ||
    createEmbeddingSpace(actual).spaceId !== actual.spaceId
  ) {
    throw new Error("Embedding space mismatch");
  }
}

/** Substitute in one pass so placeholders in source text remain literal source text. */
export function formatEmbeddingInput(
  space: EmbeddingSpaceV1,
  kind: "query" | "document",
  text: string,
  title = "none",
): string {
  return space.inputFormat[kind].replace(/\{text\}|\{title\}/g, (key) =>
    key === "{text}" ? text : title,
  );
}

export async function checkEmbeddingInputBudget(
  space: EmbeddingSpaceV1,
  formattedText: string,
  tokenizer: {
    id: string;
    digest: string;
    count: (text: string, signal?: AbortSignal) => number | Promise<number>;
  },
  signal?: AbortSignal,
): Promise<number> {
  if (space.tokenizerId !== tokenizer.id || space.tokenizerDigest !== tokenizer.digest) {
    throw new Error("Embedding tokenizer mismatch");
  }
  // Tokenize the complete formatted input; prefix and body token counts are not additive.
  const count = await tokenizer.count(formattedText, signal);
  if (!Number.isSafeInteger(count) || count <= 0 || count > space.maxInputTokens) {
    throw new Error("Embedding input token budget exceeded");
  }
  return count;
}

export function validateEmbeddingVector(space: EmbeddingSpaceV1, value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== space.dimensions ||
    value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
  ) {
    throw new Error("Embedding vector dimensions or coordinates are invalid");
  }
  const magnitude = Math.sqrt(value.reduce((sum, coordinate) => sum + coordinate * coordinate, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Embedding vector magnitude is invalid");
  }
  return space.normalization === "l2"
    ? value.map((coordinate) => coordinate / magnitude)
    : [...value];
}
