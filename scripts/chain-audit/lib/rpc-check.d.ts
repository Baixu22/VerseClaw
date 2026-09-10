export interface RpcCheckGroup {
  id?: string;
  checks?: Array<{
    method?: string;
    expectError?: string;
    params?: unknown;
    [key: string]: unknown;
  }>;
  adminOnly?: Array<{
    method?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface RpcChecksConfig {
  groups?: RpcCheckGroup[];
  [key: string]: unknown;
}

export interface EvaluateRpcCheckArgs {
  result?: {
    ok?: boolean;
    error?: {
      message?: string;
    };
    [key: string]: unknown;
  };
  check?: {
    method?: string;
    expectError?: string;
    [key: string]: unknown;
  };
  adminGated?: boolean;
}

export interface EvaluateRpcCheckResult {
  ok: boolean;
  passed: boolean;
  adminGated: boolean;
  expectErrorMatched: boolean;
  error?: string;
}

export function compileExpectError(expectError: unknown): RegExp | null;

export function isAdminGatedMethod(group: RpcCheckGroup | undefined, method: string): boolean;

export function evaluateRpcCheck(args: EvaluateRpcCheckArgs): EvaluateRpcCheckResult;

export function validateRpcChecksConfig(config: unknown): string[];
