// Minimal progress-reporting contract for memory CLI helpers. The host may
// render these progress updates; when no rich renderer is present they are
// no-ops that still drive the callback signature used by callers.
export type ProgressHandle = {
  setLabel: (label: string) => void;
  tick: (by?: number) => void;
  setCurrent: (current: number) => void;
  increment: (by?: number) => void;
};

export type ProgressOptions = {
  label: string;
  total?: number;
  current?: number;
};

export type ProgressTotalsOptions = {
  label: string;
  total?: number;
  current?: number;
  fallback?: string;
};

function normalizeLabel(options: string | ProgressOptions | ProgressTotalsOptions): string {
  return typeof options === "string" ? options : options.label;
}

function noopProgress(): ProgressHandle {
  return {
    setLabel: () => {},
    tick: () => {},
    setCurrent: () => {},
    increment: () => {},
  };
}

export function withProgress<T>(
  options: string | ProgressOptions,
  fn: (progress: ProgressHandle) => Promise<T>,
): Promise<T> {
  void normalizeLabel(options);
  return fn(noopProgress());
}

export function withProgressTotals(
  options: string | ProgressTotalsOptions,
  fn: (update: (total: { label: string; completed: number; total: number }) => void, progress: ProgressHandle) => Promise<void>,
): Promise<void> {
  void normalizeLabel(options);
  const update = (input: { label: string; completed: number; total: number }) => {
    void input;
  };
  return fn(update, noopProgress());
}
