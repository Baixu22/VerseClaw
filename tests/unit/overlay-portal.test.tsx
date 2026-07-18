import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayPortalProvider, useOverlayPortalContainer } from '@/components/ui/overlay-portal';

function PortalProbe({ testId }: { testId: string }) {
  const container = useOverlayPortalContainer();
  return <div data-testid={testId}>{container?.dataset.portalName ?? 'default'}</div>;
}

describe('OverlayPortalProvider', () => {
  it('inherits the application host and allows a drawer host override', () => {
    const appHost = document.createElement('div');
    appHost.dataset.portalName = 'app';
    const drawerHost = document.createElement('div');
    drawerHost.dataset.portalName = 'drawer';

    render(
      <OverlayPortalProvider container={appHost}>
        <PortalProbe testId="app-probe" />
        <OverlayPortalProvider container={drawerHost}>
          <PortalProbe testId="drawer-probe" />
        </OverlayPortalProvider>
      </OverlayPortalProvider>,
    );

    expect(screen.getByTestId('app-probe')).toHaveTextContent('app');
    expect(screen.getByTestId('drawer-probe')).toHaveTextContent('drawer');
  });
});
