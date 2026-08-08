import type {
  VerseShellLifecycleErrorCode,
  VerseShellLifecycleStage,
  VerseShellTransportErrorCode,
} from './types.js';

export type VerseShellContractErrorCode =
  | 'invalid_json'
  | 'max_bytes_exceeded'
  | 'invalid_shape'
  | 'schema_mismatch'
  | 'version_mismatch'
  | 'request_id_mismatch'
  | 'operation_mismatch'
  | 'argument_schema_mismatch';

export interface VerseShellErrorOptions {
  path?: string;
  expected?: unknown;
  actual?: unknown;
  cause?: unknown;
}

export class VerseShellContractError extends Error {
  readonly code: VerseShellContractErrorCode;
  readonly path?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;

  constructor(code: VerseShellContractErrorCode, message: string, options: VerseShellErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'VerseShellContractError';
    this.code = code;
    this.path = options.path;
    this.expected = options.expected;
    this.actual = options.actual;
  }
}

export class VerseShellTransportError extends Error {
  readonly code: VerseShellTransportErrorCode;
  readonly recoverable: boolean;

  constructor(
    code: VerseShellTransportErrorCode,
    message: string,
    options: { recoverable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'VerseShellTransportError';
    this.code = code;
    this.recoverable = options.recoverable ?? true;
  }
}

export class VerseShellLifecycleError extends Error {
  readonly code: VerseShellLifecycleErrorCode;
  readonly stage: VerseShellLifecycleStage;
  readonly recoverable: boolean;

  constructor(
    code: VerseShellLifecycleErrorCode,
    stage: VerseShellLifecycleStage,
    message: string,
    options: { recoverable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'VerseShellLifecycleError';
    this.code = code;
    this.stage = stage;
    this.recoverable = options.recoverable ?? stage !== 'failed';
  }
}
