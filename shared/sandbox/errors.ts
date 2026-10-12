/** Diagnostic labels only; presence here does not claim the mechanism is wired. */
export type SandboxDenialMechanism =
  | 'sandbox-gate'
  | 'seatbelt'
  | 'landlock'
  | 'bubblewrap'
  | 'restricted-token'
  | 'job-object'
  | 'unknown';

export type SandboxDenialOperation =
  | 'exec'
  | 'browser'
  | 'cron'
  | 'read'
  | 'write'
  | 'network'
  | 'process'
  | 'unknown';

export type SandboxDenialErrorInput = {
  mechanism: SandboxDenialMechanism;
  operation: SandboxDenialOperation;
  path?: string;
  message?: string;
  cause?: unknown;
  requestedProviderId?: string;
  effectiveProviderId?: string;
  runtimeLevel?: string;
};

export type SandboxDenialDetails = {
  code: 'SANDBOX_DENIED';
  category: 'sandbox-denial';
  mechanism: SandboxDenialMechanism;
  operation: SandboxDenialOperation;
  path?: string;
  requestedProviderId?: string;
  effectiveProviderId?: string;
  runtimeLevel?: string;
};

export function createSandboxDenialDetails(input: SandboxDenialErrorInput): SandboxDenialDetails {
  return {
    code: 'SANDBOX_DENIED',
    category: 'sandbox-denial',
    mechanism: input.mechanism,
    operation: input.operation,
    ...(input.path ? { path: input.path } : {}),
    ...(input.requestedProviderId ? { requestedProviderId: input.requestedProviderId } : {}),
    ...(input.effectiveProviderId ? { effectiveProviderId: input.effectiveProviderId } : {}),
    ...(input.runtimeLevel ? { runtimeLevel: input.runtimeLevel } : {}),
  };
}

/**
 * Domain error for a boundary that actually refused an operation because the
 * active sandbox policy could not authorize it. It is not a second host
 * envelope or renderer taxonomy: callers map `code` into AppError via
 * mapBackendErrorCode('SANDBOX_DENIED') and keep the structured fields in
 * details for diagnosis.
 */
export class SandboxDenialError extends Error {
  readonly code = 'SANDBOX_DENIED';
  readonly mechanism: SandboxDenialMechanism;
  readonly operation: SandboxDenialOperation;
  readonly path?: string;
  readonly requestedProviderId?: string;
  readonly effectiveProviderId?: string;
  readonly runtimeLevel?: string;

  constructor(input: SandboxDenialErrorInput) {
    const location = input.path ? ` at ${input.path}` : '';
    super(
      input.message
        ?? `Sandbox denied ${input.operation} via ${input.mechanism}${location}.`,
      { cause: input.cause },
    );
    this.name = 'SandboxDenialError';
    this.mechanism = input.mechanism;
    this.operation = input.operation;
    this.path = input.path;
    this.requestedProviderId = input.requestedProviderId;
    this.effectiveProviderId = input.effectiveProviderId;
    this.runtimeLevel = input.runtimeLevel;
  }

  toDetails(): SandboxDenialDetails {
    return createSandboxDenialDetails({
      mechanism: this.mechanism,
      operation: this.operation,
      ...(this.path ? { path: this.path } : {}),
      ...(this.requestedProviderId ? { requestedProviderId: this.requestedProviderId } : {}),
      ...(this.effectiveProviderId ? { effectiveProviderId: this.effectiveProviderId } : {}),
      ...(this.runtimeLevel ? { runtimeLevel: this.runtimeLevel } : {}),
    });
  }
}
