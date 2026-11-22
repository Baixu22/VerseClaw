/**
 * OrbStatus active animation and settled semantic-icon contract.
 *
 * Terminal states use compact Lucide glyphs; active states keep the
 * thinking-orbs canvas so a completed run never reads as still running.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrbStatus, SETTLED_STATUS_ICONS } from '@/components/assistant-ui/orb-status';

function renderOrb(state: Parameters<typeof OrbStatus>[0]['state']) {
  const { container } = render(<OrbStatus state={state} data-testid="orb" />);
  const root = container.querySelector('[data-testid="orb"]');
  return {
    root,
    icon: root?.querySelector('svg'),
    matrix: container.querySelector('[data-slot="dot-matrix"]'),
    canvas: container.querySelector('canvas'),
  };
}

describe('OrbStatus settled states', () => {
  it.each([
    ['success', 'text-emerald-700'],
    ['error', 'text-red-700'],
    ['stopped', 'text-muted-foreground'],
    ['warning', 'text-amber-700'],
  ] as const)('%s renders a %s semantic icon, not a matrix or canvas', (state, colorClass) => {
    const { root, icon, matrix, canvas } = renderOrb(state);
    expect(root?.getAttribute('data-state')).toBe(state);
    expect(root?.getAttribute('role')).toBe('img');
    expect(icon).not.toBeNull();
    expect(root?.className).toContain(colorClass);
    expect(matrix).toBeNull();
    expect(canvas).toBeNull();
  });

  it('an idle session row stays quiet with a static icon', () => {
    const { icon, matrix, canvas } = renderOrb('idle');
    expect(icon).not.toBeNull();
    expect(matrix).toBeNull();
    expect(canvas).toBeNull();
  });
});

describe('OrbStatus motion states', () => {
  it.each(['loading', 'streaming', 'working', 'connecting', 'syncing'] as const)(
    '%s renders the thinking-orbs canvas',
    (state) => {
      const { root, matrix, canvas } = renderOrb(state);
      expect(root?.getAttribute('data-state')).toBe(state);
      expect(canvas).not.toBeNull();
      expect(matrix).toBeNull();
    },
  );

  it('no motion state is accidentally classified as settled', () => {
    for (const state of ['loading', 'thinking', 'streaming', 'searching', 'syncing', 'working', 'connecting', 'waiting', 'uploading', 'downloading', 'listening', 'speaking', 'recording'] as const) {
      expect(SETTLED_STATUS_ICONS[state]).toBeUndefined();
    }
  });
});
