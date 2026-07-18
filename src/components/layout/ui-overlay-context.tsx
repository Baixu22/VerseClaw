import { createContext, useContext, type ReactNode } from 'react';
import type { UiVersion } from '@/lib/ui-version';

type UiOverlayContextValue = {
  uiVersion: UiVersion;
  settingsOpen: boolean;
  backgroundLocation: string;
  openSettings: (path?: string) => void;
  requestCloseSettings: (destination?: string) => void;
};

const UiOverlayContext = createContext<UiOverlayContextValue>({
  uiVersion: 'legacy',
  settingsOpen: false,
  backgroundLocation: '/',
  openSettings: () => undefined,
  requestCloseSettings: () => undefined,
});

export function UiOverlayProvider({
  value,
  children,
}: {
  value: UiOverlayContextValue;
  children: ReactNode;
}) {
  return <UiOverlayContext.Provider value={value}>{children}</UiOverlayContext.Provider>;
}

export function useUiOverlay() {
  return useContext(UiOverlayContext);
}
