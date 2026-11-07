export type ResourceWaitOptions = {
  signal?: AbortSignal;
  /** Absolute Unix time in milliseconds; shared by admission and execution. */
  deadline?: number;
};

const timeoutError = () => new DOMException('Resource deadline expired', 'TimeoutError');

export function checkResourceWait(
  options: ResourceWaitOptions,
  expired: () => Error = timeoutError,
  now: () => number = Date.now,
): void {
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason : new DOMException('Resource request aborted', 'AbortError');
  }
  if (options.deadline !== undefined) {
    if (!Number.isFinite(options.deadline)) throw new TypeError('Resource deadline must be finite');
    if (now() >= options.deadline) throw expired();
  }
}

/** One disposable wait registration, shared by lease owners and subscribers. */
export function watchResourceWait(
  options: ResourceWaitOptions,
  reject: (error: Error) => void,
  expired: () => Error = timeoutError,
  now: () => number = Date.now,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    options.signal?.removeEventListener('abort', check);
  };
  const check = () => {
    try { checkResourceWait(options, expired, now); }
    catch (error) { cleanup(); reject(error as Error); return; }
    if (options.deadline !== undefined) {
      // Long deadlines must not overflow Node's signed 32-bit timer delay.
      timer = setTimeout(check, Math.min(2_147_483_647, Math.max(1, options.deadline - now())));
    }
  };
  options.signal?.addEventListener('abort', check, { once: true });
  check();
  return cleanup;
}

export function resourceQueueFullError(): Error & { code: string } {
  return Object.assign(new RangeError('Resource waiting queue is full'), { code: 'RESOURCE_QUEUE_FULL' });
}
