import { createContext, useContext, type ReactNode } from 'react';
import type { UiVersion } from '@/lib/ui-version';

type UiOverlayContextValue = {
  settingsOpen: boolean;
  backgroundLocation: string;
  openSettings: (path?: string) => void;
  requestCloseSettings: (destination?: string) => void;
};

const UiVersionContext = createContext<UiVersion>('v2');

const UiOverlayContext = createContext<UiOverlayContextValue>({
  settingsOpen: false,
  backgroundLocation: '/',
  openSettings: () => undefined,
  requestCloseSettings: () => undefined,
});

export function UiOverlayProvider({
  uiVersion,
  value,
  children,
}: {
  uiVersion: UiVersion;
  value: UiOverlayContextValue;
  children: ReactNode;
}) {
  return (
    <UiVersionContext.Provider value={uiVersion}>
      <UiOverlayContext.Provider value={value}>{children}</UiOverlayContext.Provider>
    </UiVersionContext.Provider>
  );
}

export function useUiOverlay() {
  return useContext(UiOverlayContext);
}

export function useUiVersion() {
  return useContext(UiVersionContext);
}
