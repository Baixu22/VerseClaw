import { act, render, screen } from '@testing-library/react';
import type { AnimationEvent as ReactAnimationEvent, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppleDrawer } from '@/components/ui/apple-drawer';
import { toRoutePath } from '@/lib/settings-overlay-routing';

const drawerState = vi.hoisted(() => ({
  onAnimationEnd: undefined as ((open: boolean) => void) | undefined,
  onContentAnimationEnd: undefined as ((event: ReactAnimationEvent<HTMLDivElement>) => void) | undefined,
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
}));

vi.mock('vaul', () => ({
  Drawer: {
    Root: ({ children, onAnimationEnd }: { children: ReactNode; onAnimationEnd?: (open: boolean) => void }) => {
      drawerState.onAnimationEnd = onAnimationEnd;
      return <>{children}</>;
    },
    Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
    Overlay: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
    Content: ({ onAnimationEnd, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
      drawerState.onContentAnimationEnd = onAnimationEnd;
      return <div {...props} />;
    },
    Title: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Description: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Handle: ({ preventCycle: _preventCycle, ...props }: React.HTMLAttributes<HTMLDivElement> & { preventCycle?: boolean }) => (
      <div {...props} />
    ),
  },
}));

function dispatchContentAnimationEnd(
  currentTarget: HTMLDivElement,
  target: EventTarget,
  animationName: string,
) {
  drawerState.onContentAnimationEnd?.({
    animationName,
    currentTarget,
    target,
  } as ReactAnimationEvent<HTMLDivElement>);
}

function getDrawerContent(): HTMLDivElement {
  const content = screen.getByTestId('settings-drawer');
  expect(content).toBeInstanceOf(HTMLDivElement);
  return content as HTMLDivElement;
}

describe('settings drawer routing contract', () => {
  it('preserves the full background route when settings is opened', () => {
    expect(toRoutePath({ pathname: '/knowledge', search: '?tab=drafts', hash: '#proposal' }))
      .toBe('/knowledge?tab=drafts#proposal');
  });

  it('uses chat as the direct deep-link fallback', () => {
    expect(toRoutePath({ pathname: '/' })).toBe('/');
  });
});

describe('AppleDrawer animation lifecycle', () => {
  beforeEach(() => {
    drawerState.onAnimationEnd = undefined;
    drawerState.onContentAnimationEnd = undefined;
  });

  it('notifies opened once only for its own slide-in animation', () => {
    const onOpened = vi.fn();

    render(
      <AppleDrawer
        open
        onOpenChange={() => undefined}
        onOpened={onOpened}
        title="Settings"
        testId="settings-drawer"
      >
        <div data-testid="drawer-child" />
      </AppleDrawer>,
    );

    const content = getDrawerContent();
    dispatchContentAnimationEnd(
      content,
      screen.getByTestId('drawer-child'),
      'apple-drawer-slide-from-right',
    );
    dispatchContentAnimationEnd(
      content,
      content,
      'unrelated-animation',
    );
    expect(onOpened).not.toHaveBeenCalled();

    dispatchContentAnimationEnd(
      content,
      content,
      'apple-drawer-slide-from-right',
    );
    dispatchContentAnimationEnd(
      content,
      content,
      'apple-drawer-slide-from-right',
    );
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('keeps close completion separate from opened notification', () => {
    const onOpened = vi.fn();
    const onClosed = vi.fn();
    const { rerender } = render(
      <AppleDrawer
        open
        onOpenChange={() => undefined}
        onOpened={onOpened}
        onClosed={onClosed}
        title="Settings"
        testId="settings-drawer"
      >
        <div />
      </AppleDrawer>,
    );

    rerender(
      <AppleDrawer
        open={false}
        onOpenChange={() => undefined}
        onOpened={onOpened}
        onClosed={onClosed}
        title="Settings"
        testId="settings-drawer"
      >
        <div />
      </AppleDrawer>,
    );
    act(() => drawerState.onAnimationEnd?.(false));

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onOpened).not.toHaveBeenCalled();
  });
});
