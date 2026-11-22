import { Circle, CircleAlert, CircleCheck, CircleX, Info, Pause, Square, WifiOff, type LucideIcon } from 'lucide-react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { cn } from '@/lib/utils';

/**
 * Active states use `thinking-orbs`; settled states use a single Lucide
 * semantic icon so they remain legible at sidebar and inline sizes.
 */
export type OrbStatusState =
  | 'idle' | 'loading' | 'thinking' | 'streaming' | 'searching' | 'syncing'
  | 'working' | 'connecting' | 'waiting' | 'uploading' | 'downloading' | 'listening'
  | 'speaking' | 'recording' | 'success' | 'error' | 'warning' | 'info'
  | 'paused' | 'stopped' | 'offline';

/** Active states → thinking-orbs shape. */
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
  recording: 'listening',
};

const SETTLED_STATUS_ICONS: Partial<Record<OrbStatusState, { Icon: LucideIcon; color: string }>> = {
  idle: { Icon: Circle, color: 'text-muted-foreground' },
  success: { Icon: CircleCheck, color: 'text-emerald-700 dark:text-emerald-400' },
  error: { Icon: CircleX, color: 'text-red-700 dark:text-red-400' },
  warning: { Icon: CircleAlert, color: 'text-amber-700 dark:text-amber-400' },
  info: { Icon: Info, color: 'text-blue-700 dark:text-blue-400' },
  paused: { Icon: Pause, color: 'text-muted-foreground' },
  stopped: { Icon: Square, color: 'text-muted-foreground' },
  offline: { Icon: WifiOff, color: 'text-muted-foreground' },
};

export type OrbStatusProps = {
  state?: OrbStatusState;
  /**
   * Size preset. thinking-orbs ships two tuned presets (64 full-density, 20
   * inline); settled icons size to the same caller-owned box.
   */
  size?: 64 | 20 | 'md';
  /** Accessible label; defaults to the state name. */
  label?: string;
  /** Kept for API compatibility. */
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
  className,
  ...rest
}: OrbStatusProps) {
  const isMd = size === 'md';
  const hasExplicitSize = /\bsize-/.test(className ?? '');
  const settled = SETTLED_STATUS_ICONS[state];
  const slotStyle = hasExplicitSize ? undefined : { width: isMd ? MD_SIZE_CSS : size, height: isMd ? MD_SIZE_CSS : size };

  if (settled) {
    const { Icon, color } = settled;
    return (
      <span
        role="img"
        aria-label={label ?? state}
        className={cn('inline-flex shrink-0 items-center justify-center', className, color)}
        style={slotStyle}
        data-testid={rest['data-testid']}
        data-state={state}
      >
        <Icon
          aria-hidden="true"
          className="size-full"
          strokeWidth={1.9}
        />
      </span>
    );
  }

  const orbState = ANIMATED_ORB[state] ?? 'breathing';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={slotStyle}
      data-testid={rest['data-testid']}
      data-state={state}
    >
      <ThinkingOrb
        state={orbState}
        size={isMd ? 64 : size}
        theme="auto"
        aria-label={label ?? state}
        style={{ width: '100%', height: '100%' }}
      />
    </span>
  );
}

export { ANIMATED_ORB, SETTLED_STATUS_ICONS };
