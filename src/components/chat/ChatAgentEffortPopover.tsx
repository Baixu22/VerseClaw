/**
 * Chat Agent Effort Popover
 *
 * Reasoning-effort control for the chat composer, visually aligned 1:1 with
 * the claude-range-slider reference: black squircle card, glossy white thumb,
 * dot track, and a WebGL purple flame tail that ignites at max effort.
 * Slider movement is local-first and saved with a short debounce so dragging
 * stays smooth while the persisted agent setting remains up to date.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
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

type DisplayEffort = AgentReasoningEffort;
type SavedEffort = AgentReasoningEffort;

const MAX_SLIDER_VALUE = EFFORT_OPTIONS.length - 1;
const HIGH_INDEX = EFFORT_OPTIONS.indexOf('high');
const SAVE_DEBOUNCE_MS = 140;
// Thumb geometry — must match the CSS below so dots/flame stay aligned to stops.
const THUMB_W = 29;

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
  const [isFlipping, setIsFlipping] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fireCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const initialRef = useRef<SavedEffort>(initialEffort ?? 'auto');
  const commitTimerRef = useRef<number | null>(null);
  const flipTimerRef = useRef<number | null>(null);
  const wasMaxRef = useRef<boolean>(toSliderIndex(initialEffort) >= MAX_SLIDER_VALUE);

  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clipId = `effort-squircle-${rawId}`;
  const clipTrackId = `effort-squircle-track-${rawId}`;

  const statusEffort: DisplayEffort = EFFORT_OPTIONS[draftIndex] ?? 'auto';
  const fillPercent = (draftIndex / MAX_SLIDER_VALUE) * 100;
  // Reference behavior: the flame only ignites at Ultracode (slider = 100%);
  // the shader gates on smoothstep(0.95, 1.0, u_slider) so earlier activation
  // renders nothing anyway.
  const fireActive = draftIndex >= MAX_SLIDER_VALUE;
  const isHighZone = draftIndex >= HIGH_INDEX;
  useWebglFire(fireCanvasRef, draftIndex / MAX_SLIDER_VALUE, fireActive);

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
      updateFlipAnimation(next);
      setDraftIndex(next);
      scheduleCommit(next);
    },
    [scheduleCommit, updateFlipAnimation],
  );

  useEffect(() => {
    return () => {
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current);
      }
      if (flipTimerRef.current != null) {
        window.clearTimeout(flipTimerRef.current);
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
    ? Math.min(Math.max(8, anchorRect.left), Math.max(8, window.innerWidth - 400))
    : 16;
  const positionStyle: CSSProperties = anchorRect
    ? { left, bottom: window.innerHeight - anchorRect.top + 8 }
    : { left: 16, bottom: 96 };

  const maskPercent = Math.min(fillPercent + 2, 100);

  return (
    <div
      ref={containerRef}
      data-testid="chat-agent-effort-popover"
      className="fixed z-50 w-[min(376px,calc(100vw-24px))] select-none"
      style={positionStyle}
    >
      {/* Squircle clip paths (objectBoundingBox units — reference geometry). */}
      <svg className="pointer-events-none absolute h-0 w-0" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d="M 0.053,0 C 0.029,0 0.012,0.008 0.005,0.02 C 0.002,0.028 0,0.038 0,0.053 L 0,0.947 C 0,0.962 0.002,0.972 0.005,0.98 C 0.012,0.992 0.029,1 0.053,1 L 0.947,1 C 0.971,1 0.988,0.992 0.995,0.98 C 0.998,0.972 1,0.962 1,0.947 L 1,0.053 C 1,0.038 0.998,0.028 0.995,0.02 C 0.988,0.008 0.971,0 0.947,0 Z" />
          </clipPath>
          <clipPath id={clipTrackId} clipPathUnits="objectBoundingBox">
            <path d="M 0.033,0 C 0.018,0 0.007,0.012 0.003,0.035 C 0.001,0.055 0,0.1 0,0.15 L 0,0.85 C 0,0.9 0.001,0.945 0.003,0.965 C 0.007,0.988 0.018,1 0.033,1 L 0.967,1 C 0.982,1 0.993,0.988 0.997,0.965 C 0.999,0.945 1,0.9 1,0.85 L 1,0.15 C 1,0.1 0.999,0.055 0.997,0.035 C 0.993,0.012 0.982,0 0.967,0 Z" />
          </clipPath>
        </defs>
      </svg>

      <div className="effort-card-shadow motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:zoom-in-95 motion-safe:duration-150">
        <div
          className="effort-card bg-[#fbfaf8] px-5 pb-4 pt-[18px] text-zinc-900 dark:bg-black dark:text-white"
          style={{ clipPath: `url(#${clipId})` }}
        >
          <div className="mb-3.5 flex items-center justify-between">
            <div className="effort-header-left flex items-center gap-[7px] text-[15px] font-medium">
              <Flame
                className={cn(
                  'h-4 w-4 text-zinc-400 transition-[color,filter] duration-300 dark:text-[#a1a1aa]',
                  isHighZone && 'text-fuchsia-500 dark:text-fuchsia-400',
                  fireActive && 'text-purple-600 drop-shadow-[0_0_8px_rgba(147,51,234,0.45)] dark:text-[#c084fc] dark:drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]',
                )}
                aria-hidden="true"
              />
              <span className="font-bold leading-[1.3] text-zinc-600 dark:text-[#b0b0c7]">{t('composer.effortTitle')}</span>
              <span
                className={cn(
                  'effort-status inline-block align-middle text-zinc-500 dark:text-[#a1a1aa]',
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
                  className="flex items-center justify-center p-0 leading-none text-zinc-400 transition-colors hover:text-zinc-600 dark:text-[#a1a1aa] dark:hover:text-[#d4d4d8]"
                >
                  <HelpCircle className="h-[18px] w-[18px]" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="max-w-[220px] text-xs">{t('composer.effortHelpTooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="mb-[7px] flex items-center justify-between text-[13px] font-extrabold tracking-[0.04em] text-zinc-500 dark:text-[#b0b0b8]">
            <span>{t('composer.effortFaster')}</span>
            <span>{t('composer.effortSmarter')}</span>
          </div>

          <div
            className={cn(
              'effort-track relative h-[30px] overflow-hidden bg-[#0c0c0c]',
              fireActive && 'effort-track-active',
              draftIndex >= MAX_SLIDER_VALUE && 'effort-track-full',
            )}
            style={{ clipPath: `url(#${clipTrackId})`, isolation: 'isolate' }}
            data-testid="chat-agent-effort-track"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 z-0 bg-gradient-to-br from-[#111113] to-[#0a0a0b]"
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]">
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
              className={cn('effort-range', fireActive && 'effort-range-glowing')}
              aria-label={t('composer.effortTitle')}
            />
          </div>

          <div
            className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] leading-3 text-zinc-400 dark:text-[#6b6b74]"
            data-testid="chat-agent-effort-ticks"
          >
            {EFFORT_OPTIONS.map((opt, i) => (
              <span
                key={opt}
                className={cn(
                  'truncate transition-colors duration-200',
                  draftIndex === i
                    && (i >= MAX_SLIDER_VALUE
                      ? 'effort-tick-active font-semibold text-purple-600 dark:text-[#c084fc]'
                      : 'effort-tick-active font-medium text-zinc-900 dark:text-[#e4e4e7]'),
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
  .effort-card-shadow {
    filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.2)) drop-shadow(0 4px 12px rgba(0, 0, 0, 0.1));
  }
  .effort-card {
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 20px;
  }
  .dark .effort-card {
    border-color: rgba(255, 255, 255, 0.12);
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
    color: #7c3aed;
    text-shadow: 0 0 12px rgba(147, 51, 234, 0.35);
    font-weight: 600;
  }
  .dark .effort-status-glowing {
    color: #c084fc;
    text-shadow: 0 0 12px rgba(168, 85, 247, 0.6);
  }
  @keyframes effortFlipUp {
    0% { opacity: 0; transform: translateY(18px) rotateX(-80deg); filter: blur(4px); }
    100% { opacity: 1; transform: translateY(0) rotateX(0deg); filter: blur(0); }
  }
  .effort-status-flip {
    animation: effortFlipUp 0.42s cubic-bezier(0.33, 1, 0.68, 1) forwards;
  }
  .effort-track {
    border: 1px solid #1a1a1e;
  }
  .effort-dot {
    position: absolute;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #494950;
    top: 50%;
    transform: translate(-50%, -50%);
    transition: opacity 0.6s;
  }
  .effort-track-active .effort-dot { opacity: 0.25; }
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
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    outline: none;
    z-index: 5;
  }
  .effort-range:disabled { cursor: not-allowed; }
  .effort-range::-webkit-slider-runnable-track {
    height: 100%;
    background: transparent;
  }
  .effort-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 29px;
    height: 29px;
    border-radius: 10px;
    background: linear-gradient(170deg, #ffffff 0%, #f0f0f2 40%, #e4e4e6 100%);
    border: 0.5px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25), 0 6px 16px rgba(0, 0, 0, 0.12),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.85),
      inset 0 -0.5px 0 rgba(0, 0, 0, 0.06);
    cursor: grab;
    transition: box-shadow 0.4s ease, transform 0.15s ease;
  }
  .effort-range::-webkit-slider-thumb:active {
    cursor: grabbing;
    transform: scale(0.95);
    box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.2),
      0 1px 3px rgba(0, 0, 0, 0.3), 0 3px 8px rgba(0, 0, 0, 0.15),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.7),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08);
  }
  .effort-range-glowing::-webkit-slider-thumb {
    box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25), 0 6px 16px rgba(0, 0, 0, 0.12),
      0 0 28px rgba(168, 85, 247, 0.5),
      0 0 50px rgba(168, 85, 247, 0.25),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.85),
      inset 0 -0.5px 0 rgba(0, 0, 0, 0.06);
  }
  .effort-range-glowing::-webkit-slider-thumb:active {
    box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.2),
      0 1px 3px rgba(0, 0, 0, 0.3), 0 3px 8px rgba(0, 0, 0, 0.15),
      0 0 32px rgba(168, 85, 247, 0.55),
      0 0 56px rgba(168, 85, 247, 0.3),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.7),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08);
  }
  .effort-range::-moz-range-track {
    height: 30px;
    background: transparent;
    border: none;
  }
  .effort-range::-moz-range-thumb {
    width: 26px;
    height: 26px;
    border-radius: 9px;
    background: linear-gradient(170deg, #ffffff 0%, #f0f0f2 40%, #e4e4e6 100%);
    border: 0.5px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25), 0 6px 16px rgba(0, 0, 0, 0.12);
    cursor: grab;
    transition: box-shadow 0.4s ease;
  }
  .effort-range::-moz-range-thumb:active {
    cursor: grabbing;
    transform: scale(0.95);
  }
  .effort-range-glowing::-moz-range-thumb {
    box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25), 0 6px 16px rgba(0, 0, 0, 0.12),
      0 0 28px rgba(168, 85, 247, 0.5),
      0 0 50px rgba(168, 85, 247, 0.25);
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
              'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors',
              !compact && 'max-w-[148px]',
              compact && 'w-8 justify-center px-0',
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
            {!compact && <>
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
            </>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" collisionPadding={8}>{buttonLabel}</TooltipContent>
      </Tooltip>
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
