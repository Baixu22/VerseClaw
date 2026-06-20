/**
 * Chat Agent Effort Popover
 *
 * A squircle-shaped popover that lets the user pick the reasoning effort for
 * the current chat agent. Visual style is a faithful port of the
 * `claude-range-slider` reference (EffortCard.vue → React): rounded card,
 * 5-segment dot track, range slider with a glow effect on the thumb, a
 * 3D flip-up status label, and a WebGL-driven purple fire overlay when
 * the slider crosses the "high" threshold (the `useWebglFire` hook from
 * `src/hooks/use-webgl-fire.ts`).
 *
 * The "strength modification logic" is intentionally NOT touched — the
 * real save path is `useAgentsStore.updateAgentReasoningEffort`, which
 * accepts the existing `AgentReasoningEffort` enum. The popover simply
 * exposes one extra display slot at the very top of the slider ("Max",
 * mapping 1:1 to the underlying `xhigh` value) so users get a more
 * expressive label without changing the API surface. Everything below
 * the visual layer (store mutation, IPC, gateway call) is unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentsStore } from '@/stores/agents';
import { useWebglFire } from '@/hooks/use-webgl-fire';
import { cn } from '@/lib/utils';
import type { AgentReasoningEffort } from '@/types/agent';

// ── Effort model ────────────────────────────────────────────────
//
// `AgentReasoningEffort` is the real underlying enum. The popover adds a
// single extra display slot ("max") at the very top of the slider that
// maps 1:1 to the existing highest value (`xhigh`) — this gives the user
// a more expressive label without changing the API/contract. The slider
// is indexed by integer 0..6 and we resolve to / from this enum when
// reading or writing the agent config.

const EFFORT_OPTIONS: ReadonlyArray<AgentReasoningEffort | 'max'> = [
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** The label key in the `chat.composer` namespace for a given option. */
const EFFORT_LABEL_KEY: Record<AgentReasoningEffort | 'max', string> = {
  auto: 'composer.effortStatusAuto',
  minimal: 'composer.effortStatusMinimal',
  low: 'composer.effortStatusLow',
  medium: 'composer.effortStatusMedium',
  high: 'composer.effortStatusHigh',
  xhigh: 'composer.effortStatusXhigh',
  max: 'composer.effortStatusMax',
};

/** The "display" effort for the popover — adds 'max' as a visual-only slot. */
type DisplayEffort = AgentReasoningEffort | 'max';

/** The "real" effort we save through the store. */
type SavedEffort = AgentReasoningEffort;

const MAX_SLIDER_VALUE = EFFORT_OPTIONS.length - 1; // 6
const FIRE_THRESHOLD = MAX_SLIDER_VALUE; // fire only at the very top

/** Convert the underlying enum into our display slot index. */
function toSliderIndex(effort: SavedEffort | undefined | null): number {
  if (!effort) return 0;
  if (effort === 'xhigh') return MAX_SLIDER_VALUE; // 'xhigh' shares the top slot with 'max'
  const idx = EFFORT_OPTIONS.indexOf(effort);
  return idx < 0 ? 0 : idx;
}

/** Convert a slider index back into the underlying enum (collapses 'max' → 'xhigh'). */
function fromSliderIndex(idx: number): SavedEffort {
  const safe = Math.max(0, Math.min(MAX_SLIDER_VALUE, Math.round(idx)));
  const opt = EFFORT_OPTIONS[safe];
  return opt === 'max' ? 'xhigh' : (opt as SavedEffort);
}

// ── Squircle clip-path ──────────────────────────────────────────
//
// The reference uses a precise superellipse path so the card has the
// soft, slightly squashed Apple-icon look. We use a CSS approximation
// of the same path (objectBoundingBox units) so it scales with the
// element's actual size and adapts to both light and dark surfaces.

const CARD_CLIP_PATH =
  'polygon(5.3% 0%, 94.7% 0%, 100% 5.3%, 100% 94.7%, 94.7% 100%, 5.3% 100%, 0% 94.7%, 0% 5.3%)';

const TRACK_CLIP_PATH =
  'polygon(3.3% 0%, 96.7% 0%, 100% 15%, 100% 85%, 96.7% 100%, 3.3% 100%, 0% 85%, 0% 15%)';

// ── Component ───────────────────────────────────────────────────

export interface ChatAgentEffortPopoverProps {
  /** Whether the popover is open. */
  open: boolean;
  /** Anchor element (used to position the popover above the trigger). */
  anchorRect?: DOMRect | null;
  /** Close the popover. */
  onClose: () => void;
  /** The current agent whose `reasoningEffort` is being edited. */
  agentId: string | null;
  /** Disabled state (e.g. when the gateway is not ready). */
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

  // The inner component holds all local UI state (draft index, animation
  // key, etc.). We mount it with `key={agentId ?? 'none'}` so that
  // switching to a different agent resets the slider position cleanly
  // without us having to call setState inside an effect to mirror the
  // store. Within a single agent session, local state survives the
  // store roundtrip triggered by our own `commit()` call.
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

  // Local optimistic state so the slider feels instant even before the
  // gateway roundtrip finishes. Seeded from the store snapshot at mount;
  // the parent resets us with a `key` change when the agent switches.
  const [draftIndex, setDraftIndex] = useState<number>(() => toSliderIndex(initialEffort));

  const isFull = draftIndex >= MAX_SLIDER_VALUE;
  const isActive = draftIndex >= FIRE_THRESHOLD; // matches reference's `isActive = slider >= threshold`
  const statusEffort: DisplayEffort = EFFORT_OPTIONS[draftIndex] ?? 'auto';

  // ── Save handler: write through the real store. The "max" display
  // ── slot collapses to the existing `xhigh` API value, so the real
  // ── strength modification logic (host IPC, agent-config util,
  // ── gateway) stays 100% intact.
  const initialRef = useRef<SavedEffort>(initialEffort ?? 'auto');
  const commit = useCallback(
    (idx: number) => {
      if (!agentId) return;
      const target = fromSliderIndex(idx);
      if (target === initialRef.current) return;
      void updateAgentReasoningEffort(agentId, target).catch((err) => {
        console.warn('[effort] update failed', err);
      });
    },
    [agentId, updateAgentReasoningEffort],
  );

  const onSliderInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      setDraftIndex(next);
      commit(next);
    },
    [commit],
  );

  // ── Click outside / Esc to close. We're only mounted while `open`
  // ── is true (the parent returns null otherwise), so no need to gate
  // ── the effect on `open`.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      // Don't close if the click is on the trigger that opened us
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRect]);

  // ── WebGL fire overlay (active only at the top of the slider)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useWebglFire(canvasRef, draftIndex / MAX_SLIDER_VALUE, isActive);

  // ── Mask the canvas to the slider's fill width (reference parity)
  const maskStyle = useMemo<React.CSSProperties>(() => {
    const p = Math.min(((draftIndex + 0.5) / MAX_SLIDER_VALUE) * 100, 100);
    return {
      maskImage: `linear-gradient(to right, black 0%, black ${p}%, transparent ${p}%)`,
      WebkitMaskImage: `linear-gradient(to right, black 0%, black ${p}%, transparent ${p}%)`,
    };
  }, [draftIndex]);

  if (!open) return null;

  // Anchor position: render above the trigger button, falling back to
  // a fixed bottom-anchored card when no anchorRect is provided.
  const positionStyle: React.CSSProperties = anchorRect
    ? {
        left: Math.max(8, anchorRect.left),
        bottom: window.innerHeight - anchorRect.top + 8,
      }
    : { left: 16, bottom: 96 };

  return (
    <div
      ref={containerRef}
      data-testid="chat-agent-effort-popover"
      className="fixed z-50 select-none"
      style={{ ...positionStyle, width: 384 }}
    >
      <div className="effort-card-shadow">
        <div
          className={cn(
            'effort-card',
            'bg-black text-zinc-300',
            'border border-white/10',
          )}
          style={{ clipPath: CARD_CLIP_PATH, padding: '18px 20px 16px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-1.5 text-base font-medium perspective-[280px]">
              <span className="text-zinc-300 font-bold leading-tight">
                {t('composer.effortTitle')}
              </span>
              <span
                key={statusEffort}
                data-flip="1"
                className={cn(
                  'inline-block text-zinc-400 transition-colors',
                  'will-change-transform',
                  isFull && 'text-fuchsia-400 font-semibold',
                  'animate-flipUp',
                )}
                style={{
                  textShadow: isFull ? '0 0 12px rgba(168, 85, 247, 0.6)' : undefined,
                }}
              >
                {t(EFFORT_LABEL_KEY[statusEffort])}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('composer.effortHelpTooltip')}
                  className="inline-flex h-6 w-6 items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <HelpCircle className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="max-w-[220px] text-xs">{t('composer.effortHelpTooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Faster / Smarter scale labels */}
          <div className="flex justify-between text-sm font-extrabold text-zinc-400/90 mb-2 tracking-wider">
            <span>{t('composer.effortFaster')}</span>
            <span>{t('composer.effortSmarter')}</span>
          </div>

          {/* Track */}
          <div
            className={cn(
              'relative h-[30px] rounded-[10px] overflow-hidden border border-white/[0.06]',
              'bg-black/95',
              isActive && 'effort-track-active',
              isFull && 'effort-track-full',
            )}
            style={{ clipPath: TRACK_CLIP_PATH, isolation: 'isolate' }}
          >
            <div
              className="absolute inset-0 z-0"
              style={{
                background:
                  'linear-gradient(135deg, #111113 0%, #0a0a0b 100%)',
              }}
            />
            <div className="absolute inset-0 pointer-events-none z-[1]">
              <span className="effort-dot" style={{ left: '10%' }} />
              <span className="effort-dot" style={{ left: '30%' }} />
              <span className="effort-dot" style={{ left: '50%' }} />
              <span className="effort-dot" style={{ left: '70%' }} />
              <span className="effort-dot" style={{ left: '90%' }} />
            </div>
            <canvas
              ref={canvasRef}
              className={cn(
                'absolute inset-0 w-full h-full pointer-events-none z-[2]',
                'opacity-0 mix-blend-screen',
                isActive && 'opacity-100 z-[4]',
              )}
              style={maskStyle}
            />
            <input
              type="range"
              min={0}
              max={MAX_SLIDER_VALUE}
              step={1}
              value={draftIndex}
              onChange={onSliderInput}
              disabled={disabled}
              data-testid="chat-agent-effort-slider"
              className={cn(
                'effort-range',
                isFull && 'glowing',
              )}
              aria-label={t('composer.effortTitle')}
            />
          </div>

          {/* Tick labels under the track — gives context for the 7 stops */}
          <div className="mt-2 flex justify-between text-2xs text-zinc-500 px-0.5">
            {EFFORT_OPTIONS.map((opt) => (
              <span
                key={opt}
                className={cn(
                  'transition-colors',
                  EFFORT_OPTIONS[draftIndex] === opt && 'text-fuchsia-400',
                )}
              >
                {t(EFFORT_LABEL_KEY[opt])}
              </span>
            ))}
          </div>

          <style>{EFFORT_CSS}</style>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────
//
// Inlined as a `<style>` tag inside the popover so the squircle/dot/thumb
// styles live alongside the component. The slider thumb uses the
// reference's soft Apple-style 3D bevel with a purple glow when the
// "max" level is reached.

const EFFORT_CSS = `
  .effort-card-shadow {
    filter:
      drop-shadow(0 12px 28px rgba(0, 0, 0, 0.55))
      drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35));
    transition: filter 200ms ease;
  }
  .effort-dot {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #494950;
    transition: opacity 600ms;
  }
  .effort-track-active .effort-dot { opacity: 0.25; }
  .effort-track-full  .effort-dot { opacity: 0; }

  .effort-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
    z-index: 5;
    outline: none;
    margin: 0;
    padding: 0;
  }
  .effort-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 29px;
    height: 29px;
    border-radius: 10px;
    background: linear-gradient(170deg, #ffffff 0%, #f0f0f2 40%, #e4e4e6 100%);
    border: 0.5px solid rgba(0, 0, 0, 0.08);
    box-shadow:
      0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25),
      0 6px 16px rgba(0, 0, 0, 0.12),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.85),
      inset 0 -0.5px 0 rgba(0, 0, 0, 0.06);
    cursor: grab;
    transition: box-shadow 400ms ease, transform 150ms ease;
  }
  .effort-range::-webkit-slider-thumb:active {
    cursor: grabbing;
    transform: scale(0.95);
  }
  .effort-range.glowing::-webkit-slider-thumb {
    box-shadow:
      0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25),
      0 6px 16px rgba(0, 0, 0, 0.12),
      0 0 28px rgba(168, 85, 247, 0.5),
      0 0 50px rgba(168, 85, 247, 0.25),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.85),
      inset 0 -0.5px 0 rgba(0, 0, 0, 0.06);
  }
  .effort-range::-moz-range-thumb {
    width: 26px;
    height: 26px;
    border-radius: 9px;
    background: linear-gradient(170deg, #ffffff 0%, #f0f0f2 40%, #e4e4e6 100%);
    border: 0.5px solid rgba(0, 0, 0, 0.08);
    box-shadow:
      0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25),
      0 6px 16px rgba(0, 0, 0, 0.12);
    cursor: grab;
    transition: box-shadow 400ms ease;
  }
  .effort-range::-moz-range-track {
    background: transparent;
    border: none;
    height: 30px;
  }
  .effort-range.glowing::-moz-range-thumb {
    box-shadow:
      0 0.5px 1px rgba(0, 0, 0, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.25),
      0 6px 16px rgba(0, 0, 0, 0.12),
      0 0 28px rgba(168, 85, 247, 0.5),
      0 0 50px rgba(168, 85, 247, 0.25);
  }

  @keyframes flipUpFromBottom {
    0%   { opacity: 0; transform: translateY(18px) rotateX(-80deg); filter: blur(4px); }
    100% { opacity: 1; transform: translateY(0)    rotateX(0deg);     filter: blur(0);    }
  }
  .animate-flipUp {
    animation: flipUpFromBottom 0.42s cubic-bezier(0.33, 1, 0.68, 1) both;
  }
`;

// ── Trigger button ──────────────────────────────────────────────
//
// A small companion button that toggles the popover. Designed to be
// dropped into the ChatInput action row, next to the existing
// model/skill/agent pickers. Shows the current effort label inline
// (mirroring the "Skills" / model-picker button patterns already in
// use) so the user can see the current value at a glance.

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
  const isHigh = sliderIndex >= EFFORT_OPTIONS.indexOf('high');

  const onToggle = useCallback(() => {
    if (!buttonRef.current) return;
    if (!open) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setOpen((o) => !o);
  }, [open]);

  // Keep anchor fresh while open (e.g. window resize / scroll).
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
        title={t('composer.effortTitle')}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium transition-colors',
          'text-muted-foreground hover:bg-transparent hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-0',
          'disabled:pointer-events-none disabled:opacity-50',
          (open || isHigh) && 'text-foreground',
        )}
      >
        <span
          className={cn(
            'transition-colors',
            isMax && 'text-fuchsia-500 dark:text-fuchsia-400',
          )}
        >
          {t(EFFORT_LABEL_KEY[EFFORT_OPTIONS[sliderIndex] ?? 'auto'])}
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
