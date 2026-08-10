export function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Acquire an optional memory manager, run the caller's body, and always close
 * it afterwards. Missing manager: `onMissing` is notified and the run is
 * skipped (memory CLI degrades gracefully instead of throwing).
 */
export async function withManager<T>(options: {
  getManager: () => T | undefined | null | Promise<T | undefined | null>;
  onMissing?: (error: unknown) => void;
  onCloseError?: (error: unknown) => void;
  close?: (manager: T) => Promise<void> | void;
  run: (manager: T) => Promise<void>;
}): Promise<void> {
  const manager = await options.getManager();
  if (!manager) {
    options.onMissing?.(new Error("Memory manager unavailable."));
    return;
  }
  try {
    await options.run(manager);
  } finally {
    try {
      await options.close?.(manager);
    } catch (error) {
      options.onCloseError?.(error);
    }
  }
}
