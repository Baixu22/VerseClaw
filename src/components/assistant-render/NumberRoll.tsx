import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Animated number counter that rolls from the previous value to the target.
 * Inspired by Claude Desktop's token count animation.
 *
 * Uses requestAnimationFrame with an ease-out cubic curve for smooth
 * deceleration. When the target changes mid-animation, it rolls from the
 * current displayed value — no jarring resets.
 */
export function NumberRoll({
  value,
  duration = 600,
  className,
  format = true,
}: {
  value: number;
  duration?: number;
  className?: string;
  /** When true, formats with locale thousands separators. */
  format?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      setDisplayValue(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current = to;
        startRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = displayValue;
      startRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const text = format ? displayValue.toLocaleString() : String(displayValue);
  return <span className={cn('tabular-nums', className)}>{text}</span>;
}
