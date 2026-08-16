import {
  normalizeAciObservation,
  type JsonObject,
  type NormalizedAciObservation,
  type Observation,
} from "./normalizer.js";

export type AciExecuteOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Effectful calls are never replayed. */
  effectful?: boolean;
  /** Host-owned correlation parent. The process manager generates the request id. */
  traceId?: string;
  /** Absolute host deadline in epoch milliseconds. */
  deadlineAt?: number;
  /** Opt in to one bounded retry for a known read-only, idempotent operation. */
  retryable?: boolean;
};

export type AciLifecycleStage =
  | "starting"
  | "handshaking"
  | "ready"
  | "backoff"
  | "stopped"
  | "failed";

export type AciErrorMetadata = Readonly<{
  requestId?: string;
  traceId?: string;
  deadlineAt?: number;
  processKey?: string;
  lifecycleStage?: AciLifecycleStage;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  restartAttempt?: number;
}>;

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
  metadata: AciErrorMetadata;

  constructor(code: string, message: string, cause?: unknown, metadata: AciErrorMetadata = {}) {
    super(message);
    this.name = "AciTransportError";
    this.code = code;
    this.cause = cause;
    this.metadata = metadata;
  }
}

export class AciTimeoutError extends AciTransportError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, metadata?: AciErrorMetadata) {
    super("E_ACI_TIMEOUT", message, undefined, metadata);
    this.name = "AciTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class AciProcessExitedError extends AciTransportError {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(
    message: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    metadata?: AciErrorMetadata,
  ) {
    super("E_ACI_PROCESS_EXITED", message, undefined, {
      ...metadata,
      exitCode,
      signal,
    });
    this.name = "AciProcessExitedError";
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

export class AciProtocolError extends AciTransportError {
  constructor(message: string, cause?: unknown, metadata?: AciErrorMetadata) {
    super("E_ACI_PROTOCOL", message, cause, metadata);
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
