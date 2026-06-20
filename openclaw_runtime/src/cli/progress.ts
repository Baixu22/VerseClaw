export function withProgress<T>(_label: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

export function withProgressTotals(_label: string, fn: () => Promise<void>): Promise<void> {
  return fn();
}
