import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { cn } from '@/lib/utils';

/**
 * State mapping — DotMatrix's 21 states onto the 9 thinking-orbs shapes.
 *
 * thinking-orbs is strictly monochrome (light ink on dark, dark ink on light),
 * so states that previously carried a semantic COLOR (success/error/warning/…)
 * keep their meaning through a small colored dot rendered beside the orb —
 * Plan B per design decision. The orb shape itself still conveys motion/activity
 * for every state, and the colored dot restores the at-a-glance semantic cue
 * the 5×5 dot-matrix used to provide.
 */

/** DotMatrix-compatible states we still accept (superset of what callers use). */
export type OrbStatusState =
  | 'idle' | 'loading' | 'thinking' | 'streaming' | 'searching' | 'syncing'
  | 'working' | 'connecting' | 'waiting' | 'uploading' | 'downloading' | 'listening'
  | 'speaking' | 'recording' | 'success' | 'error' | 'warning' | 'info'
  | 'paused' | 'stopped' | 'offline';

const ANIMATED_ORB: Record<OrbStatusState, OrbState> = {
  idle: 'breathing',
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
  recording: 'listening',
  // Semantic states — motion via orb, meaning via colored dot below.
  success: 'breathing',
  error: 'breathing',
  warning: 'breathing',
  info: 'breathing',
  paused: 'breathing',
  stopped: 'breathing',
  offline: 'breathing',
};

/** Colored dot shown next to the orb for states that carry semantic color. */
const SEMANTIC_DOT: Partial<Record<OrbStatusState, string>> = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
  recording: 'bg-red-500',
  paused: 'bg-muted-foreground',
  stopped: 'bg-muted-foreground',
  offline: 'bg-muted-foreground',
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
  /** Semantic dot size — 'sm' inside the row, 'lg' beside a lead orb. */
  dotSize?: 'sm' | 'lg';
  className?: string;
  /** Passed through to the underlying orb (for test ids etc.). */
  ['data-testid']?: string;
};

/** CSS size for the 'md' preset — roughly 2× the 14px body text. */
const MD_SIZE_CSS = 28;

export function OrbStatus({
  state = 'loading',
  size = 20,
  label,
  dotSize = 'sm',
  className,
  ...rest
}: OrbStatusProps) {
  const orbState = ANIMATED_ORB[state] ?? 'breathing';
  const dotClass = SEMANTIC_DOT[state];
  const dot = dotSize === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5';
  const isMd = size === 'md';

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center gap-1', className)}
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
      {dotClass && <span aria-hidden className={cn('rounded-full', dot, dotClass)} />}
    </span>
  );
}

export { ANIMATED_ORB, SEMANTIC_DOT };
