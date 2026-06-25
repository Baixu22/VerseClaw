import type { ComponentProps, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

const GRID = 5;
const CENTER = (GRID - 1) / 2;
const DOT_INDEXES = Array.from({ length: GRID * GRID }, (_, index) => index);

const hash = (value: number, salt: number, range: number) => {
  let hashed = (Math.imul(value, 374761393) + Math.imul(salt, 668265263)) >>> 0;
  hashed = Math.imul(hashed ^ (hashed >>> 13), 1274126177) >>> 0;
  return ((hashed ^ (hashed >>> 16)) % range) / 1000;
};

const glyph = (dots: [number, number][]) => new Set(dots.map(([row, col]) => row * GRID + col));

const CHECK = glyph([
  [1, 4],
  [2, 3],
  [3, 0],
  [3, 2],
  [4, 1],
]);

const CROSS = glyph([
  [0, 0],
  [0, 4],
  [1, 1],
  [1, 3],
  [2, 2],
  [3, 1],
  [3, 3],
  [4, 0],
  [4, 4],
]);

const BANG = glyph([
  [0, 2],
  [1, 2],
  [2, 2],
  [4, 2],
]);

const INFO = glyph([
  [0, 2],
  [2, 2],
  [3, 2],
  [4, 2],
]);

const PAUSE = glyph([
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
]);

const STOP = glyph([
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 1],
  [3, 2],
  [3, 3],
]);

const ELLIPSIS = glyph([
  [2, 1],
  [2, 2],
  [2, 3],
]);

const RECORD = glyph([
  [1, 2],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 2],
]);

type Blink = {
  duration: number;
  delay: number;
  lo: number;
};

type DotRole = 'matrix' | 'glyph' | 'field';

type StateConfig = {
  color?: string;
  glyph?: Set<number>;
  base?: number;
  fieldBase?: number;
  fieldLo?: number;
  blink?: (index: number, row: number, col: number, role: DotRole) => Blink;
};

const distanceFromCenter = (row: number, col: number) => Math.hypot(row - CENTER, col - CENTER);
const ringFromCenter = (row: number, col: number) => Math.max(Math.abs(row - CENTER), Math.abs(col - CENTER));
const ambientBlink = (row: number, col: number, lo = 0.12): Blink => ({
  duration: 2.2,
  delay: -(row * GRID + col) * 0.025,
  lo,
});

const STATES = {
  idle: {
    color: 'text-muted-foreground',
    base: 0.42,
    blink: (_index, row, col) => ({
      duration: 2.8,
      delay: -(row + col) * 0.07,
      lo: 0.2,
    }),
  },
  loading: {
    base: 0.95,
    blink: (index) => ({
      duration: 0.75 + hash(index, 2, 650),
      delay: -hash(index, 1, 1200),
      lo: 0.16,
    }),
  },
  thinking: {
    base: 0.95,
    blink: (_index, row, col) => ({
      duration: 1.35,
      delay: -(row + col) * 0.1,
      lo: 0.18,
    }),
  },
  streaming: {
    base: 0.95,
    blink: (_index, row, col) => ({
      duration: 0.8,
      delay: -(row * 0.16 + col * 0.035),
      lo: 0.14,
    }),
  },
  searching: {
    base: 0.95,
    blink: (_index, row, col) => ({
      duration: 1.15,
      delay: -(Math.abs(col - CENTER) * 0.11 + row * 0.035),
      lo: 0.18,
    }),
  },
  syncing: {
    base: 0.95,
    blink: (_index, row, col) => {
      const turn = (Math.atan2(row - CENTER, col - CENTER) + Math.PI) / (2 * Math.PI);
      return { duration: 1.25, delay: -turn * 1.25, lo: 0.18 };
    },
  },
  connecting: {
    base: 0.95,
    blink: (_index, row, col) => ({
      duration: 1.45,
      delay: -ringFromCenter(row, col) * 0.18,
      lo: 0.15,
    }),
  },
  waiting: {
    glyph: ELLIPSIS,
    fieldBase: 0.28,
    fieldLo: 0.1,
    blink: (_index, row, col, role) => ({
      duration: role === 'glyph' ? 1.1 : 2,
      delay: role === 'glyph' ? -(col - 1) * 0.16 : -(row + col) * 0.045,
      lo: role === 'glyph' ? 0.24 : 0.1,
    }),
  },
  uploading: {
    base: 0.95,
    blink: (_index, row) => ({
      duration: 1,
      delay: -(GRID - 1 - row) * 0.14,
      lo: 0.18,
    }),
  },
  downloading: {
    base: 0.95,
    blink: (_index, row) => ({ duration: 1, delay: -row * 0.14, lo: 0.18 }),
  },
  listening: {
    base: 0.95,
    blink: (_index, _row, col) => ({
      duration: 0.7 + hash(col, 4, 500),
      delay: -hash(col, 5, 900),
      lo: 0.25,
    }),
  },
  speaking: {
    base: 0.95,
    blink: (_index, _row, col) => ({
      duration: 0.4 + hash(col, 6, 350),
      delay: -hash(col, 7, 700),
      lo: 0.2,
    }),
  },
  recording: {
    color: 'text-red-500',
    glyph: RECORD,
    fieldBase: 0.24,
    fieldLo: 0.08,
    blink: (_index, row, col, role) => ({
      duration: 1.25,
      delay: role === 'glyph' ? 0 : -distanceFromCenter(row, col) * 0.09,
      lo: role === 'glyph' ? 0.3 : 0.08,
    }),
  },
  success: {
    color: 'text-emerald-500',
    glyph: CHECK,
    fieldBase: 0.26,
    fieldLo: 0.1,
    blink: (_index, row, col, role) => ({
      duration: role === 'glyph' ? 1.8 : 2.3,
      delay: role === 'glyph' ? -(row + col) * 0.035 : -(row * 0.035 + col * 0.02),
      lo: role === 'glyph' ? 0.58 : 0.1,
    }),
  },
  error: {
    color: 'text-red-500',
    glyph: CROSS,
    fieldBase: 0.3,
    fieldLo: 0.08,
    blink: (index, row, col, role) => ({
      duration: role === 'glyph' ? 0.85 : 1.15,
      delay: role === 'glyph' ? -hash(index, 8, 260) : -((row + col) * 0.035 + hash(index, 9, 300)),
      lo: role === 'glyph' ? 0.34 : 0.08,
    }),
  },
  warning: {
    color: 'text-amber-500',
    glyph: BANG,
    fieldBase: 0.3,
    fieldLo: 0.1,
    blink: (_index, row, col, role) => ({
      duration: role === 'glyph' ? 1.25 : 1.8,
      delay: role === 'glyph' ? -row * 0.09 : -(Math.abs(col - CENTER) * 0.08 + row * 0.03),
      lo: role === 'glyph' ? 0.42 : 0.1,
    }),
  },
  info: {
    color: 'text-blue-500',
    glyph: INFO,
    fieldBase: 0.26,
    fieldLo: 0.1,
    blink: (_index, row, col, role) => ({
      duration: role === 'glyph' ? 1.7 : 2.1,
      delay: role === 'glyph' ? -row * 0.06 : -ringFromCenter(row, col) * 0.08,
      lo: role === 'glyph' ? 0.56 : 0.1,
    }),
  },
  paused: {
    color: 'text-muted-foreground',
    glyph: PAUSE,
    fieldBase: 0.24,
    fieldLo: 0.08,
    blink: (_index, row, col, role) => ({
      duration: role === 'glyph' ? 1.6 : 2.4,
      delay: role === 'glyph' ? -(col === 1 ? 0 : 0.28) : -(row + col) * 0.025,
      lo: role === 'glyph' ? 0.5 : 0.08,
    }),
  },
  stopped: {
    color: 'text-muted-foreground',
    glyph: STOP,
    fieldBase: 0.22,
    fieldLo: 0.08,
    blink: (_index, row, col, role) => role === 'glyph'
      ? { duration: 2.4, delay: -ringFromCenter(row, col) * 0.04, lo: 0.72 }
      : ambientBlink(row, col, 0.08),
  },
  offline: {
    color: 'text-muted-foreground',
    base: 0.24,
    blink: (_index, row, col) => ({
      duration: 3,
      delay: -(row * GRID + col) * 0.02,
      lo: 0.1,
    }),
  },
} satisfies Record<string, StateConfig>;

export type DotMatrixState = keyof typeof STATES;

const dotMatrixStates = Object.keys(STATES) as readonly DotMatrixState[];

export type DotMatrixProps = Omit<ComponentProps<'span'>, 'children'> & {
  state?: DotMatrixState;
  label?: string;
};

const DOT_MATRIX_CSS =
  '@property --aui-dot-matrix-hi{syntax:"<number>";inherits:false;initial-value:1}@property --aui-dot-matrix-lo{syntax:"<number>";inherits:false;initial-value:0.15}@keyframes aui-dot-matrix-blink{0%,100%{opacity:var(--aui-dot-matrix-hi,1)}50%{opacity:var(--aui-dot-matrix-lo,0.15)}}';

function DotMatrix({
  className,
  state = 'loading',
  label,
  ...props
}: DotMatrixProps) {
  const config: StateConfig = STATES[state];
  return (
    <span
      data-slot="dot-matrix"
      data-state={state}
      role="status"
      className={cn('inline-block size-4 shrink-0', config.color, className)}
      {...props}
    >
      <span className="sr-only">{label ?? state}</span>
      <style href="aui-dot-matrix" precedence="low">
        {DOT_MATRIX_CSS}
      </style>
      <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-full">
        {DOT_INDEXES.map((index) => {
          const row = Math.floor(index / GRID);
          const col = index % GRID;
          const role: DotRole = config.glyph
            ? config.glyph.has(index) ? 'glyph' : 'field'
            : 'matrix';
          const hi = role === 'field' ? (config.fieldBase ?? 0.24) : (config.base ?? 1);
          const blink = config.blink?.(index, row, col, role)
            ?? (role === 'field' ? ambientBlink(row, col, config.fieldLo ?? 0.1) : undefined);
          const duration = blink?.duration ?? 1;
          const delay = blink?.delay ?? 0;
          const lo = blink?.lo ?? (role === 'field' ? config.fieldLo ?? hi : hi);
          return (
            <circle
              key={index}
              data-slot="dot-matrix-dot"
              data-role={role}
              data-phase={`${duration}:${delay}:${lo}:${hi}`}
              cx={2 + col * 4}
              cy={2 + row * 4}
              r={1.3}
              className="[transition-property:--aui-dot-matrix-hi,--aui-dot-matrix-lo,opacity] duration-300 [animation-iteration-count:infinite] [animation-name:aui-dot-matrix-blink] [animation-timing-function:ease-in-out] motion-reduce:[animation-name:none]"
              style={
                {
                  opacity: hi,
                  animationDuration: `${duration}s`,
                  animationDelay: `${delay}s`,
                  '--aui-dot-matrix-hi': hi,
                  '--aui-dot-matrix-lo': lo,
                } as CSSProperties
              }
            />
          );
        })}
      </svg>
    </span>
  );
}

export { DotMatrix, dotMatrixStates };
