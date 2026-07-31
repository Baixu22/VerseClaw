export const MOTION_DURATION = {
  fast: 0.12,
  control: 0.18,
  surface: 0.24,
  drawer: 0.18,
} as const;

export const MOTION_EASE = {
  out: [0.23, 1, 0.32, 1] as const,
  move: [0.77, 0, 0.175, 1] as const,
  drawer: [0.32, 0.72, 0, 1] as const,
} as const;

export const MOTION_SPRING = {
  control: { type: 'spring' as const, duration: 0.32, bounce: 0.18 },
  surface: { type: 'spring' as const, duration: 0.42, bounce: 0.16 },
  drag: { type: 'spring' as const, duration: 0.46, bounce: 0.22 },
} as const;

