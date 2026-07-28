import {
  normalizeAciObservation,
  type JsonObject,
  type NormalizedAciObservation,
  type Observation,
} from "./normalizer.js";

export type AciExecuteOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Effectful calls are never replayed; this flag is descriptive for callers. */
  effectful?: boolean;
};

export interface AciTransport {
  readonly key: string;
  readonly workspace: string;
  readonly capabilities: readonly string[];
  readonly protocolVersion: string;
  readonly catalogDigest: string;
  request(op: string, args: JsonObject, opts?: AciExecuteOptions): Promise<Observation>;
}

export class AciTransportError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "AciTransportError";
    this.code = code;
    this.cause = cause;
  }
}

export class AciTimeoutError extends AciTransportError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super("E_ACI_TIMEOUT", message);
    this.name = "AciTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class AciProcessExitedError extends AciTransportError {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(message: string, exitCode: number | null, signal: NodeJS.Signals | null) {
    super("E_ACI_PROCESS_EXITED", message);
    this.name = "AciProcessExitedError";
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

export class AciProtocolError extends AciTransportError {
  constructor(message: string, cause?: unknown) {
    super("E_ACI_PROTOCOL", message, cause);
    this.name = "AciProtocolError";
  }
}

/** Typed client over one immutable, supervised VerseShell transport. */
export class VerseShellAciClient {
  constructor(private readonly transport: AciTransport) {}

  get processKey(): string {
    return this.transport.key;
  }

  get workspace(): string {
    return this.transport.workspace;
  }

  get capabilities(): readonly string[] {
    return this.transport.capabilities;
  }

  get protocolVersion(): string {
    return this.transport.protocolVersion;
  }

  /** ok=false remains an Observation; only transport/lifecycle failures reject. */
  execute(op: string, args: JsonObject = {}, opts?: AciExecuteOptions): Promise<Observation> {
    if (!op.trim()) {
      return Promise.reject(new AciProtocolError("ACI operation name must not be empty"));
    }
    return this.transport.request(op, args, opts);
  }

  executeNormalized(
    op: string,
    args: JsonObject = {},
    opts?: AciExecuteOptions,
  ): Promise<NormalizedAciObservation> {
    return this.execute(op, args, opts).then(normalizeAciObservation);
  }

  listOperations(opts?: AciExecuteOptions): Promise<Observation> {
    return this.execute("ops.list", {}, opts);
  }

  queryResult(
    handle: string,
    query: JsonObject = {},
    opts?: AciExecuteOptions,
  ): Promise<Observation> {
    return this.execute("result.query", { handle, ...query }, opts);
  }

}
