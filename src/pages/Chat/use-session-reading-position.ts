import { useLayoutEffect, type RefObject } from 'react';
import { useWorkspacesStore } from '@/stores/workspaces';

/** Reading position belongs to the same workspace, logical session and generation. */
export function useSessionReadingPosition(input: {
  workspaceId?: string | null;
  sessionKey: string;
  generation?: string;
  loading: boolean;
  element: RefObject<HTMLElement | null>;
}) {
  const { workspaceId, sessionKey, generation, loading, element } = input;
  useLayoutEffect(() => {
    const scroller = element.current;
    if (!workspaceId || loading || !scroller) return;
    const workspace = useWorkspacesStore.getState().profiles.find((profile) => profile.id === workspaceId);
    const saved = workspace?.sessionStates?.[sessionKey]?.readingPosition;
    let lastTop = scroller.scrollTop;
    let restored = false;
    const capture = () => { if (restored) lastTop = scroller.scrollTop; };
    const frame = requestAnimationFrame(() => {
      if (saved && saved.generation === generation && Number.isFinite(saved.scrollTop)) {
        scroller.scrollTop = saved.scrollTop;
      }
      lastTop = scroller.scrollTop;
      restored = true;
    });
    scroller.addEventListener('scroll', capture, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', capture);
      if (restored) void useWorkspacesStore.getState().saveWorkspaceState({ id: workspaceId, sessionKey,
        state: { readingPosition: { generation, scrollTop: lastTop } },
      }).catch((error) => console.warn('Could not save session reading position', error));
    };
  }, [workspaceId, sessionKey, generation, loading, element]);
}
