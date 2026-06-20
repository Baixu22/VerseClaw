export function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function withManager<T>(fn: (manager: unknown) => T): T {
  return fn(undefined);
}
