/** Reasoning control with a spring-following text preview and release-time persistence. */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Flame, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { EffortPreviewSlider } from './EffortPreviewSlider';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialRef = useRef<SavedEffort>(initialEffort ?? 'auto');
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clipId = `effort-squircle-${rawId}`;
  const draftIndex = Math.round(draftValue);
  const statusEffort: DisplayEffort = EFFORT_OPTIONS[draftIndex] ?? 'auto';
  const isHighZone = draftIndex >= HIGH_INDEX;

  useEffect(() => {
    initialRef.current = initialEffort ?? 'auto';
    setDraftValue(toSliderIndex(initialEffort));
  }, [initialEffort]);

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
      onEffortChange?.(fromSliderIndex(nextIndex));
      commit(nextIndex);
    },
    [commit, onEffortChange],
  );

  const onSliderInput = useCallback(
    (value: number) => {
      const nextValue = Math.max(0, Math.min(MAX_SLIDER_VALUE, value));
      setDraftValue(nextValue);
      onEffortChange?.(fromSliderIndex(Math.round(nextValue)));
    },
    [onEffortChange],
  );

  useEffect(() => {
    if (inline) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (anchorRect) {
        const x = event.clientX;
        const y = event.clientY;
        if (x >= anchorRect.left && x <= anchorRect.right && y >= anchorRect.top && y <= anchorRect.bottom) return;
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

  const popoverWidth = Math.min(300, window.innerWidth - 24);
  const left = anchorRect
    ? Math.max(8, Math.min(anchorRect.right - popoverWidth, window.innerWidth - popoverWidth - 8))
    : 16;
  const positionStyle: CSSProperties = anchorRect
    ? { left, bottom: window.innerHeight - anchorRect.top + 8 }
    : { left: 16, bottom: 96 };

  return (
    <div
      ref={containerRef}
      data-testid="chat-agent-effort-popover"
      className={cn(!inline && 'fixed z-50 w-[min(300px,calc(100vw-24px))]', inline && 'w-full', 'select-none')}
      style={inline ? undefined : positionStyle}
    >
      <svg className="pointer-events-none absolute h-0 w-0" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d="M 0.053,0 C 0.029,0 0.012,0.008 0.005,0.02 C 0.002,0.028 0,0.038 0,0.053 L 0,0.947 C 0,0.962 0.002,0.972 0.005,0.98 C 0.012,0.992 0.029,1 0.053,1 L 0.947,1 C 0.971,1 0.988,0.992 0.995,0.98 C 0.998,0.972 1,0.962 1,0.947 L 1,0.053 C 1,0.038 0.998,0.028 0.995,0.02 C 0.988,0.008 0.971,0 0.947,0 Z" />
          </clipPath>
        </defs>
      </svg>
      <div className="effort-card-shadow motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:zoom-in-95 motion-safe:duration-150">
        <div
          className={cn('effort-card px-4 pb-3.5 pt-4', inline ? 'effort-card--inline' : 'effort-card--dropdown')}
          style={inline ? undefined : { clipPath: `url(#${clipId})` }}
        >
          {!inline && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[7px] text-[15px] font-medium">
                <Flame className={cn('h-4 w-4 opacity-50', isHighZone && 'text-orange-600 opacity-100 dark:text-orange-300')} aria-hidden="true" />
                <span className="font-bold leading-[1.3] opacity-70">{t('composer.effortTitle')}</span>
                <span className="opacity-55">{t(EFFORT_LABEL_KEY[statusEffort])}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label={t('composer.effortHelpTooltip')} className="flex items-center justify-center p-0 leading-none opacity-50 transition-opacity hover:opacity-100">
                    <HelpCircle className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left"><p className="max-w-[220px] text-xs">{t('composer.effortHelpTooltip')}</p></TooltipContent>
              </Tooltip>
            </div>
          )}
          <EffortPreviewSlider
            value={draftValue}
            labels={EFFORT_OPTIONS.map((effort) => t(EFFORT_LABEL_KEY[effort]))}
            ariaLabel={t('composer.effortTitle')}
            disabled={disabled}
            onValueChange={onSliderInput}
            onValueCommit={finishInteraction}
          />
        </div>
      </div>
      <style>{EFFORT_CSS}</style>
    </div>
  );
}

const EFFORT_CSS = `
  .effort-card-shadow { filter: none; }
  .effort-card {
    border: 1px solid var(--color-border);
    border-radius: 20px;
  }
  .effort-card--dropdown {
    background: var(--color-background-control-panel);
    color: var(--color-text-foreground);
    border: none;
    border-radius: 15px;
    box-shadow: var(--shadow-xl-spread);
  }
  .effort-card--inline {
    background: transparent;
    color: var(--color-text-foreground);
    border: 0;
    border-radius: 0;
    box-shadow: none;
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
