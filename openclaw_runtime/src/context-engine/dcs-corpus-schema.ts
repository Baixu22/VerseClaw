/**
 * DCS evidence-factory corpus schema + loader.
 * kind: recorded | synthetic-agent | live (live is type-reserved; this package does not emit live).
 * Never claims live traffic; never flips DEFAULT_* or view-tools defaults.
 */
import { readFileSync } from "node:fs";

export const DCS_CORPUS_KINDS = ["recorded", "synthetic-agent", "live"] as const;
export type DcsCorpusKind = (typeof DCS_CORPUS_KINDS)[number];

export const DCS_CORPUS_ARMS = ["baseline", "factstore", "mcp_control"] as const;
export type DcsCorpusArm = (typeof DCS_CORPUS_ARMS)[number];

export const DCS_CORPUS_TURN_ROLES = ["user", "assistant", "tool"] as const;
export type DcsCorpusTurnRole = (typeof DCS_CORPUS_TURN_ROLES)[number];

export type DcsCorpusToolCall = {
  name: string;
  /** Coarse argument payload size in characters. */
  argsChars?: number;
  /** Coarse tool result size in characters. */
  resultChars?: number;
};

export type DcsCorpusTurn = {
  index: number;
  role: DcsCorpusTurnRole;
  /** Coarse character estimate of turn content. */
  chars: number;
  /** Coarse token estimate (typically ~chars/4). */
  tokenEstimate: number;
  toolCalls?: DcsCorpusToolCall[];
};

export type DcsCorpusEntry = {
  sessionId: string;
  kind: DcsCorpusKind;
  source: string;
  pass: boolean;
  turns: DcsCorpusTurn[];
  /** Optional coding A/B arm (baseline / factstore / mcp_control). */
  arm?: DcsCorpusArm;
  taskId?: string;
  category?: string;
  query?: string;
};

export type DcsCorpusDocument = {
  version: 1;
  kind: DcsCorpusKind;
  source: string;
  /** Present for synthetic-agent generation for deterministic replay. */
  seed?: number;
  notes?: string[];
  entries: DcsCorpusEntry[];
};

export class DcsCorpusValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "DcsCorpusValidationError";
    this.path = path;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string") {
    throw new DcsCorpusValidationError(path, `expected string, got ${typeof value}`);
  }
  if (!allowEmpty && value.trim() === "") {
    throw new DcsCorpusValidationError(path, "expected non-empty string");
  }
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new DcsCorpusValidationError(path, `expected boolean, got ${typeof value}`);
  }
  return value;
}

function assertFiniteNumber(
  value: unknown,
  path: string,
  opts?: { min?: number; integer?: boolean },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DcsCorpusValidationError(path, `expected finite number, got ${typeof value}`);
  }
  if (opts?.integer && !Number.isInteger(value)) {
    throw new DcsCorpusValidationError(path, "expected integer");
  }
  if (opts?.min !== undefined && value < opts.min) {
    throw new DcsCorpusValidationError(path, `expected >= ${opts.min}, got ${value}`);
  }
  return value;
}

function assertKind(value: unknown, path: string): DcsCorpusKind {
  const s = assertString(value, path);
  if (!(DCS_CORPUS_KINDS as readonly string[]).includes(s)) {
    throw new DcsCorpusValidationError(
      path,
      `invalid kind "${s}"; allowed: ${DCS_CORPUS_KINDS.join(" | ")}`,
    );
  }
  return s as DcsCorpusKind;
}

function assertArm(value: unknown, path: string): DcsCorpusArm {
  const s = assertString(value, path);
  if (!(DCS_CORPUS_ARMS as readonly string[]).includes(s)) {
    throw new DcsCorpusValidationError(
      path,
      `invalid arm "${s}"; allowed: ${DCS_CORPUS_ARMS.join(" | ")}`,
    );
  }
  return s as DcsCorpusArm;
}

function assertRole(value: unknown, path: string): DcsCorpusTurnRole {
  const s = assertString(value, path);
  if (!(DCS_CORPUS_TURN_ROLES as readonly string[]).includes(s)) {
    throw new DcsCorpusValidationError(
      path,
      `invalid role "${s}"; allowed: ${DCS_CORPUS_TURN_ROLES.join(" | ")}`,
    );
  }
  return s as DcsCorpusTurnRole;
}

function validateToolCall(raw: unknown, path: string): DcsCorpusToolCall {
  if (!isPlainObject(raw)) {
    throw new DcsCorpusValidationError(path, "expected object");
  }
  const name = assertString(raw.name, `${path}.name`);
  const out: DcsCorpusToolCall = { name };
  if (raw.argsChars !== undefined) {
    out.argsChars = assertFiniteNumber(raw.argsChars, `${path}.argsChars`, {
      min: 0,
      integer: true,
    });
  }
  if (raw.resultChars !== undefined) {
    out.resultChars = assertFiniteNumber(raw.resultChars, `${path}.resultChars`, {
      min: 0,
      integer: true,
    });
  }
  return out;
}

function validateTurn(raw: unknown, path: string): DcsCorpusTurn {
  if (!isPlainObject(raw)) {
    throw new DcsCorpusValidationError(path, "expected object");
  }
  const index = assertFiniteNumber(raw.index, `${path}.index`, { min: 0, integer: true });
  const role = assertRole(raw.role, `${path}.role`);
  const chars = assertFiniteNumber(raw.chars, `${path}.chars`, { min: 0, integer: true });
  const tokenEstimate = assertFiniteNumber(raw.tokenEstimate, `${path}.tokenEstimate`, {
    min: 0,
    integer: true,
  });
  const turn: DcsCorpusTurn = { index, role, chars, tokenEstimate };
  if (raw.toolCalls !== undefined) {
    if (!Array.isArray(raw.toolCalls)) {
      throw new DcsCorpusValidationError(`${path}.toolCalls`, "expected array");
    }
    turn.toolCalls = raw.toolCalls.map((tc, i) => validateToolCall(tc, `${path}.toolCalls[${i}]`));
  }
  return turn;
}

function validateEntry(raw: unknown, path: string, docKind: DcsCorpusKind): DcsCorpusEntry {
  if (!isPlainObject(raw)) {
    throw new DcsCorpusValidationError(path, "expected object");
  }
  const sessionId = assertString(raw.sessionId, `${path}.sessionId`);
  const kind = assertKind(raw.kind, `${path}.kind`);
  // Entry kind must not claim live when document is synthetic-agent (honesty).
  if (docKind === "synthetic-agent" && kind === "live") {
    throw new DcsCorpusValidationError(
      `${path}.kind`,
      "synthetic-agent document must not contain live entries",
    );
  }
  const source = assertString(raw.source, `${path}.source`);
  const pass = assertBoolean(raw.pass, `${path}.pass`);
  if (!Array.isArray(raw.turns)) {
    throw new DcsCorpusValidationError(`${path}.turns`, "expected array");
  }
  if (raw.turns.length === 0) {
    throw new DcsCorpusValidationError(`${path}.turns`, "expected at least one turn");
  }
  const turns = raw.turns.map((t, i) => validateTurn(t, `${path}.turns[${i}]`));
  const entry: DcsCorpusEntry = { sessionId, kind, source, pass, turns };
  if (raw.arm !== undefined) entry.arm = assertArm(raw.arm, `${path}.arm`);
  if (raw.taskId !== undefined) entry.taskId = assertString(raw.taskId, `${path}.taskId`);
  if (raw.category !== undefined) entry.category = assertString(raw.category, `${path}.category`);
  if (raw.query !== undefined) entry.query = assertString(raw.query, `${path}.query`);
  return entry;
}

/**
 * Validate unknown JSON into a DcsCorpusDocument. Throws DcsCorpusValidationError on failure.
 */
export function validateCorpus(data: unknown): DcsCorpusDocument {
  if (data === null || data === undefined) {
    throw new DcsCorpusValidationError("$", "corpus is null/undefined");
  }
  if (!isPlainObject(data)) {
    throw new DcsCorpusValidationError("$", "expected object");
  }
  const version = assertFiniteNumber(data.version, "$.version", { integer: true });
  if (version !== 1) {
    throw new DcsCorpusValidationError("$.version", `unsupported version ${version}; expected 1`);
  }
  const kind = assertKind(data.kind, "$.kind");
  const source = assertString(data.source, "$.source");
  if (!Array.isArray(data.entries)) {
    throw new DcsCorpusValidationError("$.entries", "expected array");
  }
  if (data.entries.length === 0) {
    throw new DcsCorpusValidationError("$.entries", "expected at least one entry");
  }
  const entries = data.entries.map((e, i) => validateEntry(e, `$.entries[${i}]`, kind));
  const doc: DcsCorpusDocument = { version: 1, kind, source, entries };
  if (data.seed !== undefined) {
    doc.seed = assertFiniteNumber(data.seed, "$.seed", { integer: true });
  }
  if (data.notes !== undefined) {
    if (!Array.isArray(data.notes)) {
      throw new DcsCorpusValidationError("$.notes", "expected array");
    }
    doc.notes = data.notes.map((n, i) => assertString(n, `$.notes[${i}]`, true));
  }
  return doc;
}

/**
 * Load and validate a corpus JSON file from disk.
 */
export function loadCorpus(filePath: string): DcsCorpusDocument {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DcsCorpusValidationError(filePath, `failed to read: ${msg}`);
  }
  if (text.trim() === "") {
    throw new DcsCorpusValidationError(filePath, "empty file");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DcsCorpusValidationError(filePath, `invalid JSON: ${msg}`);
  }
  return validateCorpus(parsed);
}

/** Coarse token estimate from character count (~4 chars/token). */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}