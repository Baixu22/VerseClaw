/**
 * R2: five-state model for async renderer surfaces.
 *
 * loading — request in flight
 * empty   — the surface genuinely has nothing to show
 * ready   — success with data
 * unavailable — the capability/host route is missing or degraded; not retryable
 * failed  — a transient error; the caller must offer retry
 */
export type SurfaceErrorState = {
  /** i18n key for the user-facing explanation. */
  messageKey: string;
  /** Developer-log reference id minted by src/lib/user-error.ts. */
  errorId?: string;
  /** Retry action; absent means there is nothing to retry. */
  retry?: () => void;
};

export type AsyncSurfaceState<T> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; data: T }
  | { status: 'unavailable'; error: SurfaceErrorState }
  | { status: 'failed'; error: SurfaceErrorState };
