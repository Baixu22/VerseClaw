/**
 * Chat Agent Effort Popover
 *
 * Reasoning-effort control for the chat composer, visually aligned 1:1 with
 * the claude-range-slider reference: a theme-aware rounded track, compact
 * circular thumb, and a WebGL amber flame tail that ignites at max effort.
 * Slider movement stays local while dragging and persists only when the
 * interaction ends, preventing agent refreshes from interrupting the thumb.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Flame, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { useWebglFire } from '@/hooks/use-webgl-fire';
import type { AgentReasoningEffort } from '@/types/agent';

const EFFORT_OPTIONS: ReadonlyArray<AgentReasoningEffort> = [
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

const EFFORT_LABEL_KEY: Record<AgentReasoningEffort, string> = {
  auto: 'composer.effortStatusAuto',
  minimal: 'composer.effortStatusMinimal',
  low: 'composer.effortStatusLow',
  medium: 'composer.effortStatusMedium',
  high: 'composer.effortStatusHigh',
  xhigh: 'composer.effortStatusXhigh',
  max: 'composer.effortStatusMax',
};

export function getAgentEffortLabelKey(effort: AgentReasoningEffort | undefined | null): string {
  return EFFORT_LABEL_KEY[effort ?? 'auto'] ?? EFFORT_LABEL_KEY.auto;
}

type DisplayEffort = AgentReasoningEffort;
type SavedEffort = AgentReasoningEffort;

const MAX_SLIDER_VALUE = EFFORT_OPTIONS.length - 1;
const HIGH_INDEX = EFFORT_OPTIONS.indexOf('high');
// Thumb geometry — must match the CSS below so dots/flame stay aligned to stops.
const THUMB_W = 18;

function toSliderIndex(effort: SavedEffort | undefined | null): number {
  if (!effort) return 0;
  const idx = EFFORT_OPTIONS.indexOf(effort);
  return idx < 0 ? 0 : idx;
}

function fromSliderIndex(idx: number): SavedEffort {
  const safe = Math.max(0, Math.min(MAX_SLIDER_VALUE, Math.round(idx)));
  return EFFORT_OPTIONS[safe];
}

export interface ChatAgentEffortPopoverProps {
  open: boolean;
  anchorRect?: DOMRect | null;
  onClose: () => void;
  agentId: string | null;
  disabled?: boolean;
}

export interface ChatAgentEffortPanelProps {
  agentId: string | null;
  disabled?: boolean;
  onEffortChange?: (effort: AgentReasoningEffort) => void;
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

/** Inline form used by the combined model and reasoning settings menu. */
export function ChatAgentEffortPanel({ agentId, disabled = false, onEffortChange }: ChatAgentEffortPanelProps) {
  const currentEffort = useAgentsStore((s) => {
    const agent = s.agents.find((a) => a.id === agentId);
    return agent?.reasoningEffort;
  });

  return (
    <ChatAgentEffortPopoverBody
      key={agentId ?? 'none'}
      onClose={() => undefined}
      agentId={agentId}
      initialEffort={currentEffort}
      disabled={disabled}
      onEffortChange={onEffortChange}
      inline
    />
  );
}

interface ChatAgentEffortPopoverBodyProps {
  anchorRect?: DOMRect | null;
  onClose: () => void;
  agentId: string | null;
  initialEffort: AgentReasoningEffort | undefined;
  disabled: boolean;
  inline?: boolean;
  onEffortChange?: (effort: AgentReasoningEffort) => void;
}

function ChatAgentEffortPopoverBody({
  anchorRect,
  onClose,
  agentId,
  initialEffort,
  disabled,
  inline = false,
  onEffortChange,
}: ChatAgentEffortPopoverBodyProps) {
  const { t } = useTranslation('chat');
  const updateAgentReasoningEffort = useAgentsStore((s) => s.updateAgentReasoningEffort);
  const [draftValue, setDraftValue] = useState<number>(() => toSliderIndex(initialEffort));
  const [isFlipping, setIsFlipping] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fireCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const initialRef = useRef<SavedEffort>(initialEffort ?? 'auto');
  const flipTimerRef = useRef<number | null>(null);
  const wasMaxRef = useRef<boolean>(toSliderIndex(initialEffort) >= MAX_SLIDER_VALUE);

  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clipId = `effort-squircle-${rawId}`;
  const draftIndex = Math.round(draftValue);
  const statusEffort: DisplayEffort = EFFORT_OPTIONS[draftIndex] ?? 'auto';
  const fillPercent = (draftValue / MAX_SLIDER_VALUE) * 100;
  // Reference behavior: the flame only ignites at Ultracode (slider = 100%);
  // the shader gates on smoothstep(0.95, 1.0, u_slider) so earlier activation
  // renders nothing anyway.
  const fireActive = draftValue >= MAX_SLIDER_VALUE - 0.01;
  const isHighZone = draftIndex >= HIGH_INDEX;
  useWebglFire(fireCanvasRef, draftValue / MAX_SLIDER_VALUE, fireActive);

  const updateFlipAnimation = useCallback((nextIndex: number) => {
    const isMax = nextIndex >= MAX_SLIDER_VALUE;
    if (isMax && !wasMaxRef.current) {
      setIsFlipping(true);
      if (flipTimerRef.current != null) window.clearTimeout(flipTimerRef.current);
      flipTimerRef.current = window.setTimeout(() => {
        flipTimerRef.current = null;
        setIsFlipping(false);
      }, 460);
    } else if (!isMax && wasMaxRef.current) {
      if (flipTimerRef.current != null) {
        window.clearTimeout(flipTimerRef.current);
        flipTimerRef.current = null;
      }
      setIsFlipping(false);
    }
    wasMaxRef.current = isMax;
  }, []);

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

  const finishInteraction = useCallback(
    (value: number) => {
      const nextIndex = Math.max(0, Math.min(MAX_SLIDER_VALUE, Math.round(value)));
      setDraftValue(nextIndex);
      updateFlipAnimation(nextIndex);
      onEffortChange?.(fromSliderIndex(nextIndex));
      commit(nextIndex);
    },
    [commit, onEffortChange, updateFlipAnimation],
  );

  const onSliderInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const nextValue = Math.max(0, Math.min(MAX_SLIDER_VALUE, Number(e.target.value)));
      const nextIndex = Math.round(nextValue);
      updateFlipAnimation(nextIndex);
      setDraftValue(nextValue);
      onEffortChange?.(fromSliderIndex(nextIndex));
    },
    [onEffortChange, updateFlipAnimation],
  );

  useEffect(() => {
    return () => {
      if (flipTimerRef.current != null) {
        window.clearTimeout(flipTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (inline) return;
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
  }, [anchorRect, inline, onClose]);

  // Right-align the popover to the button so it sits directly above the trigger
  // instead of extending past its right edge.
  const popoverWidth = Math.min(300, window.innerWidth - 24);
  const left = anchorRect
    ? Math.max(8, Math.min(anchorRect.right - popoverWidth, window.innerWidth - popoverWidth - 8))
    : 16;
  const positionStyle: CSSProperties = anchorRect
    ? { left, bottom: window.innerHeight - anchorRect.top + 8 }
    : { left: 16, bottom: 96 };

  const maskPercent = Math.min(fillPercent + 2, 100);

  return (
    <div
      ref={containerRef}
      data-testid="chat-agent-effort-popover"
      className={cn(
        !inline && 'fixed z-50 w-[min(300px,calc(100vw-24px))]',
        inline && 'w-full',
        'select-none',
      )}
      style={inline ? undefined : positionStyle}
    >
      {/* Squircle clip paths (objectBoundingBox units — reference geometry). */}
      <svg className="pointer-events-none absolute h-0 w-0" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d="M 0.053,0 C 0.029,0 0.012,0.008 0.005,0.02 C 0.002,0.028 0,0.038 0,0.053 L 0,0.947 C 0,0.962 0.002,0.972 0.005,0.98 C 0.012,0.992 0.029,1 0.053,1 L 0.947,1 C 0.971,1 0.988,0.992 0.995,0.98 C 0.998,0.972 1,0.962 1,0.947 L 1,0.053 C 1,0.038 0.998,0.028 0.995,0.02 C 0.988,0.008 0.971,0 0.947,0 Z" />
          </clipPath>
        </defs>
      </svg>

      <div className="effort-card-shadow motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:zoom-in-95 motion-safe:duration-150">
        <div
          className={cn(
            'effort-card px-4 pb-3.5 pt-4',
            inline ? 'effort-card--inline' : 'effort-card--dropdown',
          )}
          style={inline ? undefined : { clipPath: `url(#${clipId})` }}
        >
          {!inline && <div className="mb-3.5 flex items-center justify-between">
            <div className="effort-header-left flex items-center gap-[7px] text-[15px] font-medium">
              <Flame
                className={cn(
                  'h-4 w-4 opacity-50 transition-[color,filter] duration-300',
                  isHighZone && 'text-orange-500 opacity-100 dark:text-orange-300',
                  fireActive && 'text-orange-600 drop-shadow-[0_0_8px_rgba(251,106,34,0.45)] opacity-100 dark:text-orange-300 dark:drop-shadow-[0_0_8px_rgba(255,133,73,0.6)]',
                )}
                aria-hidden="true"
              />
              <span className="font-bold leading-[1.3] opacity-70">{t('composer.effortTitle')}</span>
              <span
                className={cn(
                  'effort-status inline-block align-middle opacity-55',
                  fireActive && 'effort-status-glowing',
                  isFlipping && 'effort-status-flip',
                )}
              >
                {t(EFFORT_LABEL_KEY[statusEffort])}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('composer.effortHelpTooltip')}
                  className="flex items-center justify-center p-0 leading-none opacity-50 transition-opacity hover:opacity-100"
                >
                  <HelpCircle className="h-[18px] w-[18px]" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="max-w-[220px] text-xs">{t('composer.effortHelpTooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </div>}

          <div className="mb-[7px] flex items-center justify-between text-[13px] font-extrabold tracking-[0.04em] opacity-50">
            <span>{t('composer.effortFaster')}</span>
            <span>{t('composer.effortSmarter')}</span>
          </div>

          <div
            className={cn(
              'effort-track relative h-[22px] overflow-hidden rounded-full',
              fireActive && 'effort-track-active',
              fireActive && 'effort-track-full',
            )}
            style={{ isolation: 'isolate' }}
            data-testid="chat-agent-effort-track"
          >
            <div aria-hidden="true" className="effort-track-surface absolute inset-0 z-0" />
            <div
              aria-hidden="true"
              className="effort-track-progress pointer-events-none absolute inset-y-0 left-0 z-[1]"
              style={{
                width: `calc(${fillPercent}% + ${THUMB_W / 2 - (fillPercent / 100) * THUMB_W}px)`,
              }}
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2]">
              {EFFORT_OPTIONS.map((option, i) => {
                const frac = i / MAX_SLIDER_VALUE;
                return (
                  <span
                    key={option}
                    className="effort-dot"
                    style={{
                      left: `calc(${frac * 100}% + ${THUMB_W / 2 - frac * THUMB_W}px)`,
                    }}
                  />
                );
              })}
            </div>
            <canvas
              ref={fireCanvasRef}
              aria-hidden="true"
              data-testid="chat-agent-effort-fire"
              className="effort-fire-canvas pointer-events-none absolute inset-0 h-full w-full opacity-0 mix-blend-screen transition-opacity duration-300 motion-reduce:hidden"
              style={{
                maskImage: `linear-gradient(to right, black 0%, black ${maskPercent}%, transparent ${maskPercent}%)`,
                WebkitMaskImage: `linear-gradient(to right, black 0%, black ${maskPercent}%, transparent ${maskPercent}%)`,
              }}
            />
            <input
              type="range"
              min={0}
              max={MAX_SLIDER_VALUE}
              step={0.05}
              value={draftValue}
              onChange={onSliderInput}
              onPointerUp={(event) => finishInteraction(Number(event.currentTarget.value))}
              onPointerCancel={(event) => finishInteraction(Number(event.currentTarget.value))}
              onKeyDown={(event) => {
                let nextIndex: number | null = null;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextIndex = draftIndex - 1;
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextIndex = draftIndex + 1;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = MAX_SLIDER_VALUE;
                if (nextIndex == null) return;
                event.preventDefault();
                const next = Math.max(0, Math.min(MAX_SLIDER_VALUE, nextIndex));
                updateFlipAnimation(next);
                setDraftValue(next);
                onEffortChange?.(fromSliderIndex(next));
              }}
              onKeyUp={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  finishInteraction(Number(event.currentTarget.value));
                }
              }}
              onBlur={(event) => finishInteraction(Number(event.currentTarget.value))}
              disabled={disabled}
              data-testid="chat-agent-effort-slider"
              className={cn('effort-range', fireActive && 'effort-range-glowing')}
              aria-label={t('composer.effortTitle')}
              aria-valuetext={t(EFFORT_LABEL_KEY[statusEffort])}
            />
          </div>

          <div
            className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] leading-3 opacity-40"
            data-testid="chat-agent-effort-ticks"
          >
            {EFFORT_OPTIONS.map((opt, i) => (
              <span
                key={opt}
                className={cn(
                  'truncate transition-colors duration-200',
                  draftIndex === i
                    && (i >= MAX_SLIDER_VALUE
                      ? 'effort-tick-active font-semibold text-orange-600 opacity-100 dark:text-orange-300'
                      : 'effort-tick-active font-medium opacity-100'),
                )}
              >
                {t(EFFORT_LABEL_KEY[opt])}
              </span>
            ))}
          </div>
        </div>
      </div>
      <style>{EFFORT_CSS}</style>
    </div>
  );
}

const EFFORT_CSS = `
  .effort-card-shadow { filter: none; }
  .effort-card {
    --effort-track-background: color-mix(
      in oklab,
      var(--color-text-foreground) 6%,
      var(--color-background-elevated-secondary-opaque)
    );
    --effort-track-progress: color-mix(in oklab, var(--color-text-foreground) 12%, transparent);
    --effort-track-dot: color-mix(in oklab, var(--color-text-foreground) 38%, transparent);
    --effort-thumb-background: var(--gray-0);
    --effort-thumb-border: color-mix(in oklab, var(--codex-ink) 12%, transparent);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 20px;
  }
  .dark .effort-card {
    --effort-thumb-background: var(--gray-100);
    --effort-thumb-border: color-mix(in oklab, var(--gray-1000) 38%, transparent);
    border-color: rgba(255, 255, 255, 0.12);
  }
  /* Dropdown-transparent variant — matches codex-composer-menu surface
     (CDP: bg-token-dropdown-background/90 + backdrop-blur-sm + rounded-xl 15px).
     Uses the same --ccm-surface token so it stays in sync with the permission
     and knowledge-scope menus. Text color follows the dropdown ink. */
  .effort-card--dropdown {
    --ccm-surface: var(--color-background-elevated-primary);
    --ccm-ring: var(--color-border);
    --ccm-shadow: var(--shadow-xl-spread);
    background: var(--ccm-surface);
    color: var(--color-text-foreground);
    border: none;
    border-radius: 15px;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    box-shadow: var(--ccm-shadow);
  }
  .effort-card--inline {
    background: transparent;
    color: var(--color-text-foreground);
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .effort-header-left {
    perspective: 280px;
    perspective-origin: center 120%;
  }
  .effort-status {
    transition: color 0.3s, text-shadow 0.3s;
    will-change: transform, opacity, filter;
    transform-origin: center bottom;
    transform: rotateX(0deg) translateY(0);
  }
  .effort-status-glowing {
    color: var(--orange-500);
    text-shadow: 0 0 12px color-mix(in srgb, var(--orange-400) 45%, transparent);
    font-weight: 600;
  }
  .dark .effort-status-glowing {
    color: var(--orange-300);
    text-shadow: 0 0 12px color-mix(in srgb, var(--orange-300) 55%, transparent);
  }
  @keyframes effortFlipUp {
    0% { opacity: 0; transform: translateY(18px) rotateX(-80deg); filter: blur(4px); }
    100% { opacity: 1; transform: translateY(0) rotateX(0deg); filter: blur(0); }
  }
  .effort-status-flip {
    animation: effortFlipUp 0.42s cubic-bezier(0.33, 1, 0.68, 1) forwards;
  }
  .effort-track {
    --effort-thumb-size: 18px;
    border: 1px solid var(--color-border-heavy);
    border-radius: 9999px;
    box-shadow: inset 0 0 0 0.5px var(--color-border-light);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  .effort-track-surface {
    border-radius: inherit;
    background: var(--effort-track-background);
  }
  .effort-track-progress {
    border-radius: inherit;
    background: var(--effort-track-progress);
    transition: width 70ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 160ms ease;
  }
  .effort-track:has(.effort-range:focus-visible) {
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-border-focus) 22%, transparent);
  }
  .effort-dot {
    position: absolute;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--effort-track-dot);
    top: 50%;
    transform: translate(-50%, -50%);
    transition: opacity 180ms ease, transform 180ms ease;
  }
  .effort-track-active .effort-dot { opacity: 0.22; }
  .effort-track-full .effort-dot { opacity: 0; }
  .effort-fire-canvas { z-index: 2; }
  .effort-track-active .effort-fire-canvas {
    opacity: 1;
    z-index: 4;
  }
  .effort-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    cursor: ew-resize;
    touch-action: pan-y;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    outline: none;
    z-index: 5;
  }
  .effort-range:disabled { cursor: not-allowed; opacity: 0.5; }
  .effort-range::-webkit-slider-runnable-track {
    height: 100%;
    background: transparent;
    border-radius: 9999px;
  }
  .effort-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: var(--effort-thumb-size);
    height: var(--effort-thumb-size);
    margin-top: 1px;
    border-radius: 50%;
    background: var(--effort-thumb-background);
    border: 1px solid var(--effort-thumb-border);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16),
      0 2px 5px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.72);
    cursor: ew-resize;
    transition: box-shadow 120ms ease, transform 90ms ease, background-color 160ms ease;
  }
  .effort-range::-webkit-slider-thumb:active {
    cursor: ew-resize;
    transform: scale(0.9);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18),
      0 1px 3px rgba(0, 0, 0, 0.14),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
  }
  .effort-range-glowing::-webkit-slider-thumb {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16),
      0 2px 5px rgba(0, 0, 0, 0.12),
      0 0 16px rgba(251, 106, 34, 0.48),
      0 0 30px rgba(255, 133, 73, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.72);
  }
  .effort-range-glowing::-webkit-slider-thumb:active {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18),
      0 0 18px rgba(251, 106, 34, 0.55),
      0 0 32px rgba(255, 133, 73, 0.26),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
  }
  .effort-range::-moz-range-track {
    height: 22px;
    background: transparent;
    border: none;
    border-radius: 9999px;
  }
  .effort-range::-moz-range-thumb {
    width: var(--effort-thumb-size);
    height: var(--effort-thumb-size);
    border-radius: 50%;
    background: var(--effort-thumb-background);
    border: 1px solid var(--effort-thumb-border);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16), 0 2px 5px rgba(0, 0, 0, 0.12);
    cursor: ew-resize;
    transition: box-shadow 120ms ease, transform 90ms ease, background-color 160ms ease;
  }
  .effort-range::-moz-range-thumb:active {
    cursor: ew-resize;
    transform: scale(0.9);
  }
  .effort-range-glowing::-moz-range-thumb {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16),
      0 2px 5px rgba(0, 0, 0, 0.12),
      0 0 16px rgba(251, 106, 34, 0.48),
      0 0 30px rgba(255, 133, 73, 0.22);
  }
  @media (prefers-reduced-motion: reduce) {
    .effort-range::-webkit-slider-thumb,
    .effort-range::-moz-range-thumb,
    .effort-status {
      transition: none;
      animation: none;
    }
  }
`;

export interface ChatAgentEffortButtonProps {
  agentId: string | null;
  disabled?: boolean;
  compact?: boolean;
}

export function ChatAgentEffortButton({
  agentId,
  disabled = false,
  compact = false,
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            data-testid="chat-agent-effort-button"
            onClick={onToggle}
            disabled={disabled}
            aria-label={buttonLabel}
            className={cn(
              'codex-composer-control',
              !compact && 'max-w-[168px]',
              compact && 'w-8 justify-center px-0',
              'disabled:pointer-events-none',
              (open || isHigh) && 'is-active',
            )}
          >
            <Flame
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-colors',
                isHigh && 'text-orange-600 dark:text-orange-300',
              )}
            />
            {!compact && <>
              <span className="shrink-0">{t('composer.effortButton')}:</span>
              <span
                className={cn(
                  'min-w-0 truncate transition-colors',
                  isMax && 'text-orange-700 dark:text-orange-300',
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
            </>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" collisionPadding={8}>{buttonLabel}</TooltipContent>
      </Tooltip>
      {createPortal(
        <ChatAgentEffortPopover
          open={open}
          anchorRect={anchorRect}
          onClose={() => setOpen(false)}
          agentId={agentId}
          disabled={disabled}
        />,
        document.body,
      )}
    </>
  );
}
