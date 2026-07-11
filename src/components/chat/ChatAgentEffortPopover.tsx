/**
 * Chat Agent Effort Popover
 *
 * Compact reasoning-effort control for the chat composer. It mirrors the
 * composer control style: a ghost trigger plus a small theme-aware popover.
 * Slider movement is local-first and saved with a short debounce so dragging
 * stays smooth while the persisted agent setting remains up to date.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Flame, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { useWebglFire } from '@/hooks/use-webgl-fire';
import type { AgentReasoningEffort } from '@/types/agent';

const EFFORT_OPTIONS: ReadonlyArray<AgentReasoningEffort | 'max'> = [
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

const EFFORT_LABEL_KEY: Record<AgentReasoningEffort | 'max', string> = {
  auto: 'composer.effortStatusAuto',
  minimal: 'composer.effortStatusMinimal',
  low: 'composer.effortStatusLow',
  medium: 'composer.effortStatusMedium',
  high: 'composer.effortStatusHigh',
  xhigh: 'composer.effortStatusXhigh',
  max: 'composer.effortStatusMax',
};

type DisplayEffort = AgentReasoningEffort | 'max';
type SavedEffort = AgentReasoningEffort;

const MAX_SLIDER_VALUE = EFFORT_OPTIONS.length - 1;
const HIGH_INDEX = EFFORT_OPTIONS.indexOf('high');
const SAVE_DEBOUNCE_MS = 140;

const EFFORT_TONE_CLASSES: Record<DisplayEffort, string> = {
  auto: 'border-black/10 bg-black/[0.03] text-muted-foreground dark:border-white/10 dark:bg-white/[0.05]',
  minimal: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  low: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  medium: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  high: 'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  xhigh: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  max: 'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
};

function toSliderIndex(effort: SavedEffort | undefined | null): number {
  if (!effort) return 0;
  if (effort === 'xhigh') return MAX_SLIDER_VALUE;
  const idx = EFFORT_OPTIONS.indexOf(effort);
  return idx < 0 ? 0 : idx;
}

function fromSliderIndex(idx: number): SavedEffort {
  const safe = Math.max(0, Math.min(MAX_SLIDER_VALUE, Math.round(idx)));
  const opt = EFFORT_OPTIONS[safe];
  return opt === 'max' ? 'xhigh' : (opt as SavedEffort);
}

export interface ChatAgentEffortPopoverProps {
  open: boolean;
  anchorRect?: DOMRect | null;
  onClose: () => void;
  agentId: string | null;
  disabled?: boolean;
}

export function ChatAgentEffortPopover({
  open,
  anchorRect,
  onClose,
  agentId,
  disabled = false,
}: ChatAgentEffortPopoverProps) {
  const currentEffort = useAgentsStore((s) => {
    const agent = s.agents.find((a) => a.id === agentId);
    return agent?.reasoningEffort;
  });

  if (!open) return null;

  return (
    <ChatAgentEffortPopoverBody
      key={agentId ?? 'none'}
      anchorRect={anchorRect}
      onClose={onClose}
      agentId={agentId}
      initialEffort={currentEffort}
      disabled={disabled}
    />
  );
}

interface ChatAgentEffortPopoverBodyProps {
  anchorRect?: DOMRect | null;
  onClose: () => void;
  agentId: string | null;
  initialEffort: AgentReasoningEffort | undefined;
  disabled: boolean;
}

function ChatAgentEffortPopoverBody({
  anchorRect,
  onClose,
  agentId,
  initialEffort,
  disabled,
}: ChatAgentEffortPopoverBodyProps) {
  const { t } = useTranslation('chat');
  const updateAgentReasoningEffort = useAgentsStore((s) => s.updateAgentReasoningEffort);
  const [draftIndex, setDraftIndex] = useState<number>(() => toSliderIndex(initialEffort));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fireCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const initialRef = useRef<SavedEffort>(initialEffort ?? 'auto');
  const commitTimerRef = useRef<number | null>(null);

  const statusEffort: DisplayEffort = EFFORT_OPTIONS[draftIndex] ?? 'auto';
  const fillPercent = (draftIndex / MAX_SLIDER_VALUE) * 100;
  const fireActive = draftIndex >= HIGH_INDEX;
  useWebglFire(fireCanvasRef, draftIndex / MAX_SLIDER_VALUE, fireActive);

  const commit = useCallback(
    (idx: number) => {
      if (!agentId) return;
      const target = fromSliderIndex(idx);
      if (target === initialRef.current) return;
      initialRef.current = target;
      void updateAgentReasoningEffort(agentId, target).catch((err) => {
        console.warn('[effort] update failed', err);
      });
    },
    [agentId, updateAgentReasoningEffort],
  );

  const scheduleCommit = useCallback(
    (idx: number) => {
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current);
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        commit(idx);
      }, SAVE_DEBOUNCE_MS);
    },
    [commit],
  );

  const commitDraft = useCallback(() => {
    if (commitTimerRef.current != null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    commit(draftIndex);
  }, [commit, draftIndex]);

  const onSliderInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      setDraftIndex(next);
      scheduleCommit(next);
    },
    [scheduleCommit],
  );

  useEffect(() => {
    return () => {
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (anchorRect) {
        const x = event.clientX;
        const y = event.clientY;
        if (
          x >= anchorRect.left
          && x <= anchorRect.right
          && y >= anchorRect.top
          && y <= anchorRect.bottom
        ) {
          return;
        }
      }
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchorRect, onClose]);

  const left = anchorRect
    ? Math.min(Math.max(8, anchorRect.left), Math.max(8, window.innerWidth - 328))
    : 16;
  const positionStyle: CSSProperties = anchorRect
    ? { left, bottom: window.innerHeight - anchorRect.top + 8 }
    : { left: 16, bottom: 96 };

  return (
    <div
      ref={containerRef}
      data-testid="chat-agent-effort-popover"
      className="fixed z-50 w-[min(344px,calc(100vw-24px))] select-none sm:w-[min(344px,calc(100vw-32px))]"
      style={positionStyle}
    >
      <div className="effort-card rounded-lg border border-black/10 bg-surface-modal p-3 text-foreground shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:zoom-in-95 motion-safe:duration-150 dark:border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Flame
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-[color,filter] duration-200',
                  fireActive && 'text-fuchsia-600 drop-shadow-[0_0_6px_rgba(192,38,211,0.45)] dark:text-fuchsia-300',
                )}
                aria-hidden="true"
              />
              <p className="text-xs font-medium text-foreground">{t('composer.effortTitle')}</p>
              <span
                className={cn(
                  'inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium leading-none',
                  EFFORT_TONE_CLASSES[statusEffort],
                )}
              >
                {t(EFFORT_LABEL_KEY[statusEffort])}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-tiny text-muted-foreground">
              <span>{t('composer.effortFaster')}</span>
              <span aria-hidden="true" className="h-px w-5 bg-border" />
              <span>{t('composer.effortSmarter')}</span>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('composer.effortHelpTooltip')}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              >
                <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="max-w-[220px] text-xs">{t('composer.effortHelpTooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-3">
          <div
            className={cn(
              'effort-track relative h-9 overflow-hidden rounded-lg border border-black/10 bg-surface-input isolation-isolate sm:h-10 dark:border-white/10',
              fireActive && 'effort-track-active',
              draftIndex >= MAX_SLIDER_VALUE && 'effort-track-full',
            )}
            data-testid="chat-agent-effort-track"
          >
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 z-0 rounded-lg bg-fuchsia-500/10 transition-[width] duration-100 dark:bg-fuchsia-400/10"
              style={{ width: `${fillPercent}%` }}
            />
            <canvas
              ref={fireCanvasRef}
              aria-hidden="true"
              data-testid="chat-agent-effort-fire"
              className="effort-fire-canvas pointer-events-none absolute inset-0 z-[2] h-full w-full opacity-0 mix-blend-multiply transition-opacity duration-300 motion-reduce:hidden dark:mix-blend-screen"
              style={{
                maskImage: `linear-gradient(to right, black 0%, black ${Math.min(fillPercent + 2, 100)}%, transparent ${Math.min(fillPercent + 2, 100)}%)`,
                WebkitMaskImage: `linear-gradient(to right, black 0%, black ${Math.min(fillPercent + 2, 100)}%, transparent ${Math.min(fillPercent + 2, 100)}%)`,
              }}
            />
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-between px-3">
              {EFFORT_OPTIONS.map((option) => (
                <span
                  key={option}
                  className={cn(
                    'h-1 w-1 rounded-full bg-muted-foreground/35 transition-[background-color,opacity] duration-200',
                    fireActive && 'opacity-30',
                    EFFORT_OPTIONS[draftIndex] === option && 'bg-fuchsia-600 opacity-100 dark:bg-fuchsia-300',
                  )}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={MAX_SLIDER_VALUE}
              step={1}
              value={draftIndex}
              onChange={onSliderInput}
              onPointerUp={commitDraft}
              onKeyUp={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  commitDraft();
                }
              }}
              onBlur={commitDraft}
              disabled={disabled}
              data-testid="chat-agent-effort-slider"
              className="effort-range"
              aria-label={t('composer.effortTitle')}
            />
          </div>

          <div
            className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] leading-3 text-muted-foreground"
            data-testid="chat-agent-effort-ticks"
          >
            {EFFORT_OPTIONS.map((opt) => (
              <span
                key={opt}
                className={cn(
                  'truncate transition-colors',
                  EFFORT_OPTIONS[draftIndex] === opt && 'font-medium text-primary',
                )}
              >
                {t(EFFORT_LABEL_KEY[opt])}
              </span>
            ))}
          </div>
        </div>
        <style>{EFFORT_CSS}</style>
      </div>
    </div>
  );
}

const EFFORT_CSS = `
  .effort-track-active .effort-fire-canvas {
    opacity: 0.92;
  }
  .effort-track-full .effort-fire-canvas {
    opacity: 1;
  }
  .effort-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    outline: none;
  }
  .effort-range:disabled {
    cursor: not-allowed;
  }
  .effort-range::-webkit-slider-runnable-track {
    height: 100%;
    background: transparent;
  }
  .effort-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    margin-top: 8px;
    border-radius: 7px;
    border: 1px solid hsl(var(--border));
    background: linear-gradient(170deg, hsl(var(--background)) 0%, hsl(var(--surface-modal)) 100%);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .effort-range::-webkit-slider-thumb:active {
    transform: scale(0.94);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
  }
  .effort-range::-moz-range-track {
    height: 100%;
    background: transparent;
    border: 0;
  }
  .effort-range::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 7px;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--background));
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  }
  .effort-track-active .effort-range::-webkit-slider-thumb {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22), 0 0 22px rgba(192, 38, 211, 0.42);
  }
  .effort-track-active .effort-range::-moz-range-thumb {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22), 0 0 22px rgba(192, 38, 211, 0.42);
  }
  @media (min-width: 640px) {
    .effort-range::-webkit-slider-thumb {
      width: 20px;
      height: 20px;
      margin-top: 9px;
    }
    .effort-range::-moz-range-thumb {
      width: 20px;
      height: 20px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .effort-range::-webkit-slider-thumb,
    .effort-range::-moz-range-thumb {
      transition: none;
    }
  }
`;

export interface ChatAgentEffortButtonProps {
  agentId: string | null;
  disabled?: boolean;
}

export function ChatAgentEffortButton({
  agentId,
  disabled = false,
}: ChatAgentEffortButtonProps) {
  const { t } = useTranslation('chat');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const currentEffort = useAgentsStore((s) => {
    const agent = s.agents.find((a) => a.id === agentId);
    return agent?.reasoningEffort;
  });
  const sliderIndex = toSliderIndex(currentEffort);
  const isMax = sliderIndex >= MAX_SLIDER_VALUE;
  const isHigh = sliderIndex >= HIGH_INDEX;
  const currentLabel = t(EFFORT_LABEL_KEY[EFFORT_OPTIONS[sliderIndex] ?? 'auto']);
  const buttonLabel = `${t('composer.effortButton')}: ${currentLabel}`;

  const onToggle = useCallback(() => {
    if (!buttonRef.current) return;
    if (!open) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setOpen((value) => !value);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (buttonRef.current) setAnchorRect(buttonRef.current.getBoundingClientRect());
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="chat-agent-effort-button"
        onClick={onToggle}
        disabled={disabled}
        title={buttonLabel}
        aria-label={buttonLabel}
        className={cn(
          'inline-flex h-8 max-w-[148px] items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors',
          'hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-0 dark:hover:bg-white/10',
          'disabled:pointer-events-none disabled:opacity-50',
          (open || isHigh) && 'text-foreground',
        )}
      >
        <Flame
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-colors',
            isHigh && 'text-fuchsia-600 dark:text-fuchsia-300',
          )}
        />
        <span className="shrink-0">{t('composer.effortButton')}:</span>
        <span
          className={cn(
            'min-w-0 truncate transition-colors',
            isMax && 'text-fuchsia-700 dark:text-fuchsia-300',
          )}
        >
          {currentLabel}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      <ChatAgentEffortPopover
        open={open}
        anchorRect={anchorRect}
        onClose={() => setOpen(false)}
        agentId={agentId}
        disabled={disabled}
      />
    </>
  );
}
