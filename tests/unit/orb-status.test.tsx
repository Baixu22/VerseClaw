/**
 * OrbStatus dual-engine contract (the "orb never settles" regression).
 *
 * Terminal / semantic states MUST render the colored DotMatrix glyph — a
 * completed run that keeps breathing reads as still-running, which is the
 * exact bug this locks out. Motion states keep the thinking-orbs canvas.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrbStatus, SETTLED_MATRIX } from '@/components/assistant-ui/orb-status';

function renderOrb(state: Parameters<typeof OrbStatus>[0]['state']) {
  const { container } = render(<OrbStatus state={state} data-testid="orb" />);
  const root = container.querySelector('[data-testid="orb"]');
  return {
    root,
    matrix: container.querySelector('[data-slot="dot-matrix"]'),
    canvas: container.querySelector('canvas'),
  };
}

describe('OrbStatus settled states', () => {
  it.each([
    ['success', 'text-emerald-500'],
    ['error', 'text-red-500'],
    ['stopped', 'text-muted-foreground'],
    ['warning', 'text-amber-500'],
  ] as const)('%s renders a %s dot-matrix glyph, not a canvas orb', (state, colorClass) => {
    const { root, matrix, canvas } = renderOrb(state);
    expect(root?.getAttribute('data-state')).toBe(state);
    expect(matrix).not.toBeNull();
    expect(matrix?.getAttribute('data-state')).toBe(state);
    expect(matrix?.className).toContain(colorClass);
    expect(canvas).toBeNull();
  });

  it('an idle session row stays quiet — matrix, no breathing canvas', () => {
    const { matrix, canvas } = renderOrb('idle');
    expect(matrix).not.toBeNull();
    expect(canvas).toBeNull();
  });
});

describe('OrbStatus motion states', () => {
  it.each(['loading', 'streaming', 'working', 'connecting', 'syncing'] as const)(
    '%s renders the thinking-orbs canvas',
    (state) => {
      const { root, matrix, canvas } = renderOrb(state);
      expect(root?.getAttribute('data-state')).toBe(['loading', 'streaming', 'working'].includes(state) ? 'running' : state);
      expect(canvas).not.toBeNull();
      expect(matrix).toBeNull();
    },
  );

  it('no motion state is accidentally classified as settled', () => {
    for (const state of ['loading', 'thinking', 'streaming', 'searching', 'syncing', 'working', 'connecting', 'waiting', 'uploading', 'downloading', 'listening', 'speaking'] as const) {
      expect(SETTLED_MATRIX[state]).toBeUndefined();
    }
  });
});
