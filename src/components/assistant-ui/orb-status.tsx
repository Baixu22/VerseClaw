import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { DotMatrix, type DotMatrixState } from '@/components/assistant-ui/dot-matrix';
import { cn } from '@/lib/utils';

/**
 * OrbStatus — one status glyph, two engines.
 *
 * MOTION states (loading / streaming / searching / …) render the monochrome
 * `thinking-orbs` canvas: continuous motion reads as "the agent is doing
 * something right now", and the orb shapes are tuned for exactly that.
 *
 * SETTLED states (success / error / stopped / …) render the 5×5 DotMatrix
 * glyph instead: a colored, nearly-still figure (emerald ✓, red ✕, STOP
 * square, pause bars…). A terminal state must not keep breathing — an
 * animated orb after `run.ended` reads as "still running", which is the
 * regression this split repairs. The matrix also restores the at-a-glance
 * semantic color the monochrome orb cannot carry.
 *
 * Same public API as before — callers pick a state, this module picks the
 * engine. `data-state` stays on the wrapper for tests and styling.
 */

/** DotMatrix-compatible states we still accept (superset of what callers use). */
export type OrbStatusState =
  | 'idle' | 'loading' | 'thinking' | 'streaming' | 'searching' | 'syncing'
  | 'working' | 'connecting' | 'waiting' | 'uploading' | 'downloading' | 'listening'
  | 'speaking' | 'recording' | 'success' | 'error' | 'warning' | 'info'
  | 'paused' | 'stopped' | 'offline';

/** Motion states → thinking-orbs shape. Anything not listed here is settled. */
const ANIMATED_ORB: Partial<Record<OrbStatusState, OrbState>> = {
  loading: 'solving',
  thinking: 'breathing',
  streaming: 'composing',
  searching: 'searching',
  syncing: 'working',
  working: 'working',
  connecting: 'connecting',
  waiting: 'breathing',
  uploading: 'weaving',
  downloading: 'weaving',
  listening: 'listening',
  speaking: 'listening',
};

/**
 * Settled / semantic states → DotMatrix state. The matrix names match ours
 * one-to-one; `idle` and `recording` live here too — an idle session row
 * must not pulse like a working one, and the red record pulse is the
 * matrix's own classic design.
 */
const SETTLED_MATRIX: Partial<Record<OrbStatusState, DotMatrixState>> = {
  idle: 'idle',
  recording: 'recording',
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
  paused: 'paused',
  stopped: 'stopped',
  offline: 'offline',
};

export type OrbStatusProps = {
  state?: OrbStatusState;
  /**
   * Size preset. thinking-orbs ships two tuned presets (64 full-density, 20
   * inline), each a separate design rather than a scale factor. For sizes
   * between them (e.g. 28 beside a text row) we render the 64px preset and
   * downscale via CSS — the full-density preset survives downscaling far
   * better than upscaling the sparse 20px preset would.
   */
  size?: 64 | 20 | 'md';
  /** Accessible label; defaults to the state name. */
  label?: string;
  /** Kept for API compatibility; the settled matrix carries its own color now. */
  dotSize?: 'sm' | 'lg';
  className?: string;
  /** Passed through to the underlying orb (for test ids etc.). */
  ['data-testid']?: string;
};

/** CSS size for the 'md' preset — roughly 2× the 14px body text. */
const MD_SIZE_CSS = 28;

/** Matrix render sizes per preset — the 5×5 glyph reads best a notch smaller than the orb. */
const MATRIX_SIZE_CSS: Record<'md' | '20' | '64', number> = { md: 22, 20: 16, 64: 40 };

export function OrbStatus({
  state = 'loading',
  size = 20,
  label,
  className,
  ...rest
}: OrbStatusProps) {
  const matrixState = SETTLED_MATRIX[state];
  const isMd = size === 'md';

  if (matrixState) {
    // Callers that size the wrapper (`size-3.5` on session rows) own the box;
    // otherwise fall back to the preset so the lead orb slot keeps its weight.
    const hasExplicitSize = /\bsize-/.test(className ?? '');
    const matrixCss = MATRIX_SIZE_CSS[isMd ? 'md' : (String(size) as '20' | '64')];
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
        data-testid={rest['data-testid']}
        data-state={state}
      >
        <DotMatrix
          state={matrixState}
          label={label ?? state}
          className="size-full"
          style={hasExplicitSize ? undefined : { width: matrixCss, height: matrixCss }}
        />
      </span>
    );
  }

  const orbState = ANIMATED_ORB[state] ?? 'breathing';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      data-testid={rest['data-testid']}
      data-state={state}
    >
      <ThinkingOrb
        state={orbState}
        size={isMd ? 64 : size}
        theme="auto"
        aria-label={label ?? state}
        style={isMd ? { width: MD_SIZE_CSS, height: MD_SIZE_CSS } : undefined}
      />
    </span>
  );
}

export { ANIMATED_ORB, SETTLED_MATRIX };
