import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  Check,
  FileText,
  PencilLine,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* eslint-disable react-refresh/only-export-components */

/**
 * Compact tool-call chip adapted from ReactBits' CallChip.
 *
 * Source: https://www.reactbits.dev/micro/call-chip
 *
 * The reference's signature is preserved: a progress wash, a status-aware
 * leading glyph, a live/fixed timer, and a green completion / red failure
 * state. Icons come from lucide because ClawX already ships that set; the
 * component intentionally has no registry or icon-package dependency.
 */

export type CallChipStatus = 'idle' | 'running' | 'done' | 'error';
export type CallChipIcon = 'terminal' | 'file' | 'search' | 'edit' | 'tool';

export type CallChipProps = {
  name: string;
  argument?: string;
  status?: CallChipStatus;
  icon?: CallChipIcon | ReactNode;
  startedAt?: number;
  durationMs?: number;
  expectedMs?: number;
  showTimer?: boolean;
  statusLabel?: string;
  trailing?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

const ICONS = {
  terminal: Terminal,
  file: FileText,
  search: Search,
  edit: PencilLine,
  tool: Wrench,
} as const;

export function inferCallChipIcon(name: string): CallChipIcon {
  const normalized = name.toLowerCase();
  if (/(search|grep|find|web_fetch|web_search|browse|url)/.test(normalized)) return 'search';
  if (/(read|write|edit|patch|file|apply|image_generate)/.test(normalized)) return 'file';
  if (/(exec|bash|shell|command|terminal|process|run)/.test(normalized)) return 'terminal';
  return 'tool';
}

function formatElapsed(ms: number): string {
  if (ms < 10_000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function CallChip({
  name,
  argument,
  status = 'running',
  icon = 'tool',
  startedAt,
  durationMs,
  expectedMs = 2_500,
  showTimer = true,
  statusLabel,
  trailing,
  className,
  style,
}: CallChipProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [mountedAt, setMountedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);

  const isRunning = status === 'running';
  const isDone = status === 'done';
  const isError = status === 'error';
  const targetProgress = isRunning ? 0.92 : isDone ? 1 : isError ? 0.92 : 0;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stamp = Date.now();
      setMountedAt(stamp);
      setNow(stamp);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!isRunning) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setProgress(targetProgress));
    return () => window.cancelAnimationFrame(frame);
  }, [targetProgress]);

  useEffect(() => {
    const element = rootRef.current;
    if (!isError || !element || prefersReducedMotion() || typeof element.animate !== 'function') {
      return undefined;
    }
    const animation = element.animate(
      [0, -1, 1, -0.66, 0.66, -0.33, 0].map((offset) => ({
        transform: `translateX(${offset * 4}px)`,
      })),
      {
        duration: 420,
        easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
        composite: 'add',
      },
    );
    return () => animation.cancel();
  }, [isError]);

  const elapsed = durationMs ?? (isRunning && now != null
    ? Math.max(0, now - (startedAt ?? mountedAt ?? now))
    : undefined);
  const hasTimer = showTimer && elapsed != null;
  const accessibleLabel = [
    name,
    argument,
    statusLabel,
  ].filter(Boolean).join(', ');
  const fillBackground = isDone
    ? 'transparent'
    : isError
      ? 'color-mix(in srgb, #ef4444 14%, transparent)'
      : 'color-mix(in srgb, currentColor 8%, transparent)';

  const leading = useMemo(() => {
    if (status === 'done') return <Check className="size-3.5" strokeWidth={2.2} />;
    if (status === 'error') {
      return <AlertTriangle className="size-3.5" strokeWidth={2} />;
    }
    if (typeof icon === 'string') {
      const Icon = ICONS[icon as CallChipIcon] ?? Wrench;
      return <Icon className="size-3.5" strokeWidth={1.8} />;
    }
    return icon;
  }, [icon, status]);

  return (
    <span
      ref={rootRef}
      role="status"
      aria-busy={isRunning || undefined}
      aria-label={accessibleLabel || undefined}
      data-status={status}
      data-testid="chat-call-chip"
      className={cn(
        'group relative inline-flex h-8 min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg border px-2.5 text-xs leading-none text-foreground',
        isDone ? 'border-transparent bg-transparent' : 'border-border/60 bg-surface-input',
        'transition-[border-color,background-color,transform] duration-150',
        isRunning && 'border-primary/20',
        isError && 'border-destructive/30',
        className,
      )}
      style={style}
    >
      <span
        aria-hidden="true"
        data-testid="chat-call-chip-progress"
        className="pointer-events-none absolute inset-0 origin-left motion-reduce:!transition-none"
        style={{
          backgroundColor: fillBackground,
          transform: `scaleX(${progress})`,
          transition: isRunning
            ? `transform ${expectedMs}ms linear`
            : 'transform 220ms cubic-bezier(0.23, 1, 0.32, 1), background-color 140ms ease',
        }}
      />
      <span
        className={cn(
          'relative flex size-4 shrink-0 items-center justify-center',
          isDone && 'text-emerald-700 dark:text-emerald-400',
          isError && 'text-destructive',
          !isDone && !isError && 'text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {leading}
      </span>
      <span className="relative min-w-0 max-w-[12rem] truncate font-medium" title={name} aria-hidden="true">
        {name}
      </span>
      {argument ? (
        <span
          className="relative min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
          title={argument}
          aria-hidden="true"
        >
          {argument}
        </span>
      ) : null}
      {hasTimer ? (
        <span className="relative shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/75" aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
      ) : null}
      {trailing ? (
        <span className="relative flex shrink-0 items-center" aria-hidden="true">
          {trailing}
        </span>
      ) : null}
      <span className="sr-only">{accessibleLabel}</span>
    </span>
  );
}
