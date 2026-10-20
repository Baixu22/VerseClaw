import { useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

type SketchVars = CSSProperties & {
  '--sketch-delay'?: string;
  '--sketch-duration'?: string;
};

type SketchBlockProps = ComponentProps<'span'> & {
  /** Override the automatic reading-order delay derived from neighbouring sketches. */
  delay?: number;
  duration?: number;
};

type Box = { width: number; height: number; radius: number };

/**
 * A waiting placeholder that draws its own outline instead of sweeping a shimmer.
 *
 * It measures the slot it was given so the stroke keeps the slot's real radius,
 * then derives its delay from the diagonal distance to the sketch root's
 * top-left corner, so a skeleton grows outward instead of appearing at once.
 */
export function SketchBlock({ className, delay, duration = 380, style, ...props }: SketchBlockProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [autoDelay, setAutoDelay] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;

        if (delay === undefined) {
          const origin = element.closest<HTMLElement>('[data-structural-sketch-root], [data-structural-surface]');
          const originRect = origin?.getBoundingClientRect();
          const dx = Math.max(0, rect.left - (originRect?.left ?? rect.left));
          const dy = Math.max(0, rect.top - (originRect?.top ?? rect.top));
          // Radiate from the sketch root's top-left corner instead of starting every block at once.
          setAutoDelay(Math.round(Math.min(300, (dx + dy) * 0.45)));
        }

        const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
        setBox({
          width: rect.width,
          height: rect.height,
          radius: Math.min(radius, rect.width / 2, rect.height / 2),
        });
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [delay]);

  return (
    <span
      {...props}
      ref={ref}
      data-structural-sketch
      aria-hidden="true"
      className={cn('structural-sketch', className)}
      style={{
        ...style,
        '--sketch-delay': `${delay ?? autoDelay}ms`,
        '--sketch-duration': `${duration}ms`,
      } as SketchVars}
    >
      {box ? (
        <svg
          className="structural-sketch__outline"
          viewBox={`0 0 ${box.width} ${box.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            x="0.5"
            y="0.5"
            width={Math.max(1, box.width - 1)}
            height={Math.max(1, box.height - 1)}
            rx={box.radius}
            pathLength={1}
          />
        </svg>
      ) : null}
    </span>
  );
}
