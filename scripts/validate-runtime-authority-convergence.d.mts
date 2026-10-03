export type RuntimeAuthorityConvergenceResult = {
  ok: boolean;
  errors: string[];
  phase?: string;
  manifest?: unknown;
  report?: unknown;
  baseline?: unknown;
};

export function validateRuntimeAuthorityConvergencePreflight(
  options?: Record<string, unknown>,
): RuntimeAuthorityConvergenceResult;
export function validateRuntimeAuthorityConvergence(
  options?: Record<string, unknown>,
): RuntimeAuthorityConvergenceResult;
export function main(argv?: string[]): number;
