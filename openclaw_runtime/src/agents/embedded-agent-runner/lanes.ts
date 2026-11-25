/**
 * Resolves command queue lane names for embedded-agent sessions and global work.
 */
import { CommandLane } from "../../process/lanes.js";
import type { CommandQueueEnqueueOptions } from "../../process/command-queue.types.js";

export const EMBEDDED_QUEUE_WAIT_MS = 30_000;

/** Session admission and its later global admission consume the same wait budget. */
export function withEmbeddedRunQueueBounds(
  opts: CommandQueueEnqueueOptions | undefined,
  deadlineAtMs: number,
  signal?: AbortSignal,
): CommandQueueEnqueueOptions {
  return {
    ...opts,
    deadline: Math.min(deadlineAtMs, opts?.deadline ?? Infinity),
    maxQueueSize: Math.min(64, opts?.maxQueueSize ?? 64),
    queueDeadlineMs: Math.min(
      opts?.queueDeadlineMs ?? EMBEDDED_QUEUE_WAIT_MS,
      Math.max(0, deadlineAtMs - Date.now()),
    ),
    signal:
      signal && opts?.signal && signal !== opts.signal
        ? AbortSignal.any([signal, opts.signal])
        : (signal ?? opts?.signal),
  };
}

export function resolveSessionLane(key: string) {
  const cleaned = key.trim() || CommandLane.Main;
  return cleaned.startsWith("session:") ? cleaned : `session:${cleaned}`;
}

export function resolveGlobalLane(lane?: string) {
  const cleaned = lane?.trim();
  // Cron jobs hold the cron lane slot; inner operations need a dedicated lane
  // to avoid deadlock without widening shared nested flows.
  if (cleaned === CommandLane.Cron) {
    return CommandLane.CronNested;
  }
  return cleaned ? cleaned : CommandLane.Main;
}

export function resolveEmbeddedSessionLane(key: string) {
  return resolveSessionLane(key);
}
