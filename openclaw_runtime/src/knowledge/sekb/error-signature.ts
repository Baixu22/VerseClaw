import { createHash } from "node:crypto";
import type { KnowledgeStore } from "./knowledge-store.js";

export type ErrorSignatureExtractor = (rawError: string) => string | Promise<string>;

export type ExtractErrorSignatureOptions = {
  store: KnowledgeStore;
  rawError: string;
  extractor?: ErrorSignatureExtractor;
};

/** Extracts an idempotent SEKB error signature and caches it by raw-error hash. */
export async function extractErrorSignature(
  options: ExtractErrorSignatureOptions,
): Promise<string> {
  const hash = rawErrorHash(options.rawError);
  const cached = options.store.read_error_signature_cache(hash);
  if (cached) {
    return cached;
  }
  const signature = normalizeErrorSignature(
    options.extractor ? await options.extractor(options.rawError) : fallbackErrorSignature(options.rawError),
  );
  options.store.write_error_signature_cache({
    raw_error_hash: hash,
    raw_error_sample: options.rawError,
    error_signature: signature,
  });
  return signature;
}

/** Synchronous variant used by the local capture path and deterministic tests. */
export function extractErrorSignatureSync(options: ExtractErrorSignatureOptions): string {
  const hash = rawErrorHash(options.rawError);
  const cached = options.store.read_error_signature_cache(hash);
  if (cached) {
    return cached;
  }
  if (options.extractor) {
    const extracted = options.extractor(options.rawError);
    if (typeof extracted !== "string") {
      throw new Error("Async error signature extractors must use extractErrorSignature().");
    }
    return cacheSignature(options.store, hash, options.rawError, extracted);
  }
  return cacheSignature(options.store, hash, options.rawError, fallbackErrorSignature(options.rawError));
}

export function rawErrorHash(rawError: string): string {
  return createHash("sha256").update(rawError).digest("hex");
}

function cacheSignature(
  store: KnowledgeStore,
  hash: string,
  rawError: string,
  signature: string,
): string {
  const normalized = normalizeErrorSignature(signature);
  store.write_error_signature_cache({
    raw_error_hash: hash,
    raw_error_sample: rawError,
    error_signature: normalized,
  });
  return normalized;
}

function fallbackErrorSignature(rawError: string): string {
  const text = rawError.toLowerCase();
  if (text.includes("connection refused") && (text.includes("postgres") || text.includes("5432"))) {
    return "ConnectionError::db_connection_refused::postgresql";
  }
  if (text.includes("pool") && (text.includes("exhaust") || text.includes("timeout"))) {
    return "ConnectionError::db_pool_exhausted::database";
  }
  if (text.includes("keyerror")) {
    return "KeyError::missing_nested_dict_key::python";
  }
  if (text.includes("typeerror")) {
    return "TypeError::wrong_param_type_in_api_call::typescript";
  }
  if (text.includes("timeout")) {
    return "TimeoutError::operation_timeout::runtime";
  }
  return "Error::unknown_failure::runtime";
}

function normalizeErrorSignature(value: string): string {
  const parts = value.split("::").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) {
    return "Error::unknown_failure::runtime";
  }
  return `${className(parts[0])}::${snakeCase(parts[1])}::${slug(parts[2])}`;
}

function className(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned.endsWith("Error") ? cleaned : `${cleaned || "Error"}`;
}

function snakeCase(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || "unknown_failure";
}

function slug(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "runtime";
}
