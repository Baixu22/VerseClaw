/**
 * SetupCompleteMark — the wizard's closing image, replacing a 🎉 emoji.
 *
 * A brand logo inside a ring that draws itself once, clockwise from twelve
 * o'clock, then holds. The stroke is the same ink and the same near-invisible
 * weight as the backdrop grid in codex-setup-motion.css, so the mark reads as
 * part of the surface rather than as clip art dropped onto it.
 *
 * SVG stroke-dashoffset rather than a rotating element: the ring draws *into*
 * existence instead of spinning, which is the same "arrives and settles" idea
 * the step transition uses, and it leaves nothing moving once it lands.
 */
import { motion } from 'framer-motion';
import { BrandLogo } from '@/components/brand/BrandLogo';

const SIZE = 132;
const STROKE = 1.25;
/** Inset by the stroke so the ring is not clipped by the viewBox edge. */
const RADIUS = SIZE / 2 - STROKE;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const EXPO_OUT = [0.19, 1, 0.22, 1] as const;

export function SetupCompleteMark() {
  return (
    <div
      data-testid="setup-complete-mark"
      className="setup-complete-mark relative mx-auto mb-2"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg
        className="setup-complete-mark__ring absolute inset-0"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        fill="none"
        aria-hidden="true"
      >
        {/* Resting track: always closed, so the ring never looks broken if the
          * draw is skipped under reduced motion. */}
        <circle
          className="setup-complete-mark__track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
        />
        {/* -90° start puts the pen at twelve o'clock rather than three. */}
        <motion.circle
          className="setup-complete-mark__sweep"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          initial={{ strokeDashoffset: CIRCUMFERENCE }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 1.15, ease: EXPO_OUT, delay: 0.1 }}
        />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: EXPO_OUT, delay: 0.18 }}
        >
          <BrandLogo size="setup" />
        </motion.div>
      </div>
    </div>
  );
}
