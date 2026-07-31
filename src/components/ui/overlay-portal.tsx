import { createContext, useContext, type ReactNode, type RefObject } from 'react';

type OverlayPortalTarget = HTMLElement | RefObject<HTMLElement | null> | null;

const OverlayPortalContext = createContext<OverlayPortalTarget>(null);

export function OverlayPortalProvider({
  container,
  children,
}: {
  container: OverlayPortalTarget;
  children: ReactNode;
}) {
  return (
    <OverlayPortalContext.Provider value={container}>
      {children}
    </OverlayPortalContext.Provider>
  );
}

export function useOverlayPortalContainer() {
  const target = useContext(OverlayPortalContext);
  if (target && 'current' in target) return target.current;
  return target;
}

