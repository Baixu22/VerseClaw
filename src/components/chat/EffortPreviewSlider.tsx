/**
 * Adapted from the owner's Aceternity Preview Slider offline runtime:
 * https://ui.aceternity.com/interactions/preview-slider
 * The image bubble becomes a localized text tooltip; the native range keeps
 * keyboard access and the composer's preview/commit contract.
 */
import { useEffect, useId, useRef, useState } from 'react';
import {
  AnimatePresence, animate, motion, useAnimationFrame, useMotionValue,
  useReducedMotion, useSpring, useTransform, useVelocity,
} from 'framer-motion';
import { cn } from '@/lib/utils';

const EASE = [0.22, 1, 0.36, 1] as const;
const FOLLOW_SPRING = { stiffness: 300, damping: 30, mass: 0.35 };
const TILT_SPRING = { stiffness: 300, damping: 10, mass: 0.35 };

interface Props {
  value: number;
  labels: readonly string[];
  ariaLabel: string;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
}

export function EffortPreviewSlider({ value, labels, ariaLabel, disabled = false, onValueChange, onValueCommit }: Props) {
  const reducedMotion = useReducedMotion();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gooId = `effort-preview-goo-${id}`;
  const shiverId = `${gooId}-shiver`;
  const tooltipId = `${gooId}-tooltip`;
  const trackRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const widthRef = useRef(1);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = labels.length;
  const max = Math.max(0, count - 1);
  const index = Math.max(0, Math.min(max, Math.round(value)));
  const label = labels[index] ?? '';
  const position = useMotionValue((value + 0.5) / count);
  const follow = useSpring(position, reducedMotion ? { duration: 0 } : FOLLOW_SPRING);
  const velocity = useVelocity(follow);
  const tilt = useSpring(useTransform(velocity, (speed) => reducedMotion ? 0 : 55 * Math.tanh(-speed * 24 / 55)), TILT_SPRING);
  const left = useTransform(follow, (fraction) => `${fraction * 100}%`);
  const tooltipX = useTransform(follow, (fraction) => `${-fraction * 100}%`);
  const overflow = useMotionValue(0);
  const scaleX = useTransform(overflow, (distance) => 1 + Math.abs(distance) / widthRef.current);
  const scaleY = useTransform(overflow, (distance) => 1 - Math.min(0.18, Math.abs(distance) / 120));
  const originX = useTransform(overflow, (distance) => Number(distance < 0));
  const bubbleScale = useTransform(overflow, (distance) => 1 + Math.abs(distance) / 28 * 0.3);
  const edgeGlow = useSpring(useTransform(position, (fraction) => Number(fraction >= 0.985)), reducedMotion ? { duration: 0 } : { stiffness: 260, damping: 30 });
  const showPreview = !disabled && (hovered || dragging || focused);

  useEffect(() => {
    if (!draggingRef.current) position.set((value + 0.5) / count);
  }, [count, position, value]);

  useEffect(() => {
    if (reducedMotion) overflow.jump(0);
  }, [overflow, reducedMotion]);

  const shiverRef = useRef<HTMLDivElement>(null);
  const turbulenceRef = useRef<SVGFETurbulenceElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const shiverAmount = useRef(0);
  const interactingRef = useRef(false);
  useEffect(() => { interactingRef.current = !disabled && (dragging || hovered); }, [disabled, dragging, hovered]);

  useAnimationFrame((time, delta) => {
    const track = shiverRef.current;
    if (!track) return;
    if (reducedMotion) {
      track.style.filter = '';
      shiverAmount.current = 0;
      return;
    }
    if (!interactingRef.current && shiverAmount.current === 0) return;
    const target = interactingRef.current && position.get() >= 0.985 ? 1 + Math.max(0, overflow.get()) / 14 : 0;
    shiverAmount.current += (target - shiverAmount.current) * Math.min(1, delta / 120);
    if (shiverAmount.current < 0.02) {
      track.style.filter = '';
      shiverAmount.current = 0;
      return;
    }
    turbulenceRef.current?.setAttribute('seed', String(Math.floor(time / 50) % 100));
    turbulenceRef.current?.setAttribute('baseFrequency', `0.015 ${(0.28 + Math.sin(time / 90) * 0.06).toFixed(3)}`);
    displacementRef.current?.setAttribute('scale', (shiverAmount.current * 1.6).toFixed(2));
    track.style.filter = `url(#${shiverId})`;
  });

  const movePointer = (clientX: number) => {
    const track = trackRef.current;
    const rect = track?.getBoundingClientRect();
    if (!track || !rect || rect.width <= 0) return;
    const width = track.offsetWidth || rect.width;
    const x = (clientX - rect.left) * width / rect.width;
    const fraction = Math.max(0, Math.min(1, x / width));
    widthRef.current = width;
    position.set(fraction);
    const outside = x < 0 ? x : x > width ? x - width : 0;
    const rubberBand = 28 * (1 - 1 / (Math.abs(outside) * 0.55 / 28 + 1));
    overflow.set(reducedMotion ? 0 : Math.sign(outside) * rubberBand);
    onValueChange(Math.max(0, Math.min(max, fraction * count - 0.5)));
  };

  const endPointer = () => {
    draggingRef.current = false;
    setDragging(false);
    animate(overflow, 0, reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 22 });
    if (!disabled) onValueCommit(Number(inputRef.current?.value ?? value));
  };

  return (
    <div className={cn('effort-preview relative w-full select-none pb-6 pt-6', disabled && 'opacity-50')} data-testid="chat-agent-effort-preview">
      <div ref={trackRef} className="relative h-8 w-full" data-testid="chat-agent-effort-track">
        <svg aria-hidden="true" className="pointer-events-none absolute h-0 w-0">
          <defs>
            <filter id={gooId}>
              <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
              <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" result="shape" />
              <feMorphology in="goo" operator="dilate" radius="1" result="grown" />
              <feFlood style={{ floodColor: 'var(--effort-preview-ring)' }} result="ink" />
              <feComposite in="ink" in2="grown" operator="in" result="ring" />
              <feMerge><feMergeNode in="ring" /><feMergeNode in="shape" /></feMerge>
            </filter>
            <filter id={shiverId} x="-2%" y="-20%" width="104%" height="140%">
              <feTurbulence ref={turbulenceRef} type="turbulence" baseFrequency="0.015 0.28" numOctaves="1" seed="0" result="noise" />
              <feDisplacementMap ref={displacementRef} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>

        <div className="pointer-events-none absolute bottom-0" style={{ top: -124, left: -24, right: -24, filter: `url(#${gooId}) var(--effort-preview-shadow)` }}>
          <motion.div className="absolute bottom-0 h-8" style={{ left: 24, right: 24, x: overflow }}>
            <AnimatePresence>
              {showPreview && (
                <motion.div
                  key="tooltip"
                  className="absolute bottom-1/2 origin-bottom"
                  style={{ left, x: '-50%', rotate: tilt, scale: bubbleScale, width: 0, height: 84 }}
                  initial="hidden" animate="shown" exit="hidden"
                >
                  <motion.div
                    id={tooltipId} role="tooltip" aria-label={label}
                    data-testid="chat-agent-effort-tooltip"
                    className="effort-preview-tooltip absolute bottom-0 flex h-8 min-w-12 items-center justify-center overflow-hidden rounded-lg px-3 text-xs font-medium text-foreground"
                    style={{ x: tooltipX }}
                    variants={reducedMotion ? {
                      hidden: { opacity: 0, y: -36, transition: { duration: 0.1 } },
                      shown: { opacity: 1, y: -36, transition: { duration: 0.1 } },
                    } : {
                      hidden: { y: 16, scaleX: 0.6, scaleY: 0.6, transition: { duration: 0.28, ease: [0.55, 0, 0.75, 0.2] } },
                      shown: {
                        y: -36, scaleX: [0.6, 0.82, 1], scaleY: [0.6, 1.18, 1],
                        transition: {
                          y: { type: 'spring', duration: 0.8, bounce: 0.25 },
                          scaleX: { duration: 0.6, times: [0, 0.45, 1], ease: 'easeOut' },
                          scaleY: { duration: 0.6, times: [0, 0.45, 1], ease: 'easeOut' },
                        },
                      },
                    }}
                  >
                    <AnimatedEffortLabel label={label} index={index} reducedMotion={Boolean(reducedMotion)} />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          <motion.div ref={shiverRef} data-testid="chat-agent-effort-track-shiver" className="absolute bottom-0 h-8" style={{ left: 24, right: 24, scaleX, scaleY, originX }} aria-hidden="true">
            <div className="effort-track-surface absolute inset-0 rounded-md" />
            <motion.div className="absolute inset-y-0 left-0 overflow-hidden rounded-l-md" style={{ width: left }}>
              <div className="effort-preview-progress absolute inset-0" />
              <motion.div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-sky-400 dark:to-sky-500" style={{ opacity: edgeGlow }} />
            </motion.div>
            <div className="absolute inset-x-2 inset-y-0 grid grid-cols-9 items-center" data-testid="chat-agent-effort-ticks">
              {Array.from({ length: 9 }, (_, tick) => (
                <motion.span key={tick} className="effort-preview-tick mx-auto h-3 w-px rounded-full" initial={{ opacity: 0 }} animate={{ opacity: 0.22 }} transition={reducedMotion ? { duration: 0 } : { delay: tick * 0.04, duration: 0.22, ease: EASE }} />
              ))}
            </div>
          </motion.div>
        </div>

        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ x: overflow }} data-testid="chat-agent-effort-thumb-offset">
          <motion.div
            className={cn('effort-preview-thumb absolute top-1/2 z-10 h-5 w-3 rounded-sm shadow-md', focused && 'effort-preview-thumb--focused')}
            data-testid="chat-agent-effort-thumb"
            style={{ left, x: '-50%', y: '-50%' }}
            initial={false} animate={{ scale: showPreview && !reducedMotion ? 1.08 : 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </motion.div>

        <input
          ref={inputRef} type="range" min={0} max={max} step={0.05} value={value} disabled={disabled}
          data-testid="chat-agent-effort-slider"
          className="effort-preview-input absolute inset-0 z-20 m-0 h-full w-full touch-none cursor-grab opacity-0 active:cursor-grabbing disabled:cursor-not-allowed"
          aria-label={ariaLabel} aria-valuetext={label} aria-describedby={showPreview ? tooltipId : undefined}
          onChange={(event) => { if (!disabled) onValueChange(Number(event.currentTarget.value)); }}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus({ preventScroll: true });
            setFocused(false);
            draggingRef.current = true;
            setDragging(true);
            movePointer(event.clientX);
          }}
          onPointerMove={(event) => { if (draggingRef.current) movePointer(event.clientX); }}
          onPointerUp={endPointer} onPointerCancel={endPointer}
          onLostPointerCapture={() => { if (draggingRef.current) endPointer(); }}
          onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
          onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
          onBlur={(event) => { setFocused(false); if (!disabled) onValueCommit(Number(event.currentTarget.value)); }}
          onKeyDown={(event) => {
            const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? index - 1
              : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? index + 1
                : event.key === 'Home' ? 0 : event.key === 'End' ? max : null;
            if (next === null || disabled) return;
            event.preventDefault();
            setFocused(true);
            onValueChange(Math.max(0, Math.min(max, next)));
          }}
          onKeyUp={(event) => {
            if (!disabled && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) onValueCommit(Number(event.currentTarget.value));
          }}
        />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center text-xs font-medium text-muted-foreground" data-testid="chat-agent-effort-label">
        <AnimatedEffortLabel label={label} index={index} reducedMotion={Boolean(reducedMotion)} />
      </div>
      <style>{PREVIEW_CSS}</style>
    </div>
  );
}

function AnimatedEffortLabel({ label, index, reducedMotion }: { label: string; index: number; reducedMotion: boolean }) {
  const [direction, setDirection] = useState({ index, sign: 1 });
  if (direction.index !== index) setDirection({ index, sign: index >= direction.index ? 1 : -1 });
  return (
    <span className="relative inline-flex justify-center py-1.5 leading-none whitespace-nowrap" style={{ maskImage: 'linear-gradient(to bottom, transparent, black 35%, black 65%, transparent)' }}>
      <AnimatePresence mode="popLayout" initial={false} custom={direction.sign}>
        <motion.span key={label} custom={direction.sign} variants={{
          enter: (sign: number) => reducedMotion ? { opacity: 0 } : { y: `${sign * 100}%`, opacity: 0, filter: 'blur(2px)' },
          center: { y: 0, opacity: 1, filter: 'blur(0px)' },
          exit: (sign: number) => reducedMotion ? { opacity: 0 } : { y: `${-sign * 100}%`, opacity: 0, filter: 'blur(2px)' },
        }} initial="enter" animate="center" exit="exit" transition={{ duration: reducedMotion ? 0.1 : 0.22, ease: EASE }}>
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const PREVIEW_CSS = `
  .effort-preview {
    --effort-preview-ring: hsl(var(--border));
    --effort-preview-shadow: drop-shadow(0 1px 3px color-mix(in oklab, hsl(var(--foreground)) 10%, transparent)) drop-shadow(0 1px 1px color-mix(in oklab, hsl(var(--foreground)) 10%, transparent));
  }
  .dark .effort-preview { --effort-preview-ring: transparent; }
  .effort-preview .effort-track-surface { background: hsl(var(--muted)); }
  .effort-preview-progress { background: linear-gradient(to right, color-mix(in oklab, hsl(var(--foreground)) 16%, hsl(var(--muted))), color-mix(in oklab, hsl(var(--foreground)) 10%, hsl(var(--muted)))); }
  .dark .effort-preview-progress { background: linear-gradient(to right, color-mix(in oklab, hsl(var(--foreground)) 28%, hsl(var(--muted))), color-mix(in oklab, hsl(var(--foreground)) 18%, hsl(var(--muted)))); }
  .effort-preview-tick { background: hsl(var(--foreground)); }
  .effort-preview-tooltip { width: max-content; background: hsl(var(--surface-modal)); }
  .effort-preview-thumb { background: hsl(var(--surface-modal)); box-shadow: 0 1px 4px hsl(var(--foreground) / 0.12), 0 0 0 1px hsl(var(--border)); }
  .dark .effort-preview-thumb { background: hsl(var(--foreground)); }
  .effort-preview-thumb--focused { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
  .effort-preview-input { appearance: none; -webkit-appearance: none; }
`;
