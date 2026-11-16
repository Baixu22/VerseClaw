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
    const readPosition = () => {
      const top = scroller.getBoundingClientRect().top;
      const row = [...scroller.querySelectorAll<HTMLElement>('[data-viewport-key]')]
        .find(node => node.getBoundingClientRect().bottom > top);
      return { generation, scrollTop: scroller.scrollTop, messageKey: row?.dataset.viewportKey,
        offset: row ? row.getBoundingClientRect().top - top : undefined,
        pinned: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 8 };
    };
    let lastPosition = readPosition();
    let restored = false;
    const capture = () => { if (restored) lastPosition = readPosition(); };
    const frame = requestAnimationFrame(() => {
      lastPosition = readPosition();
      restored = true;
    });
    scroller.addEventListener('scroll', capture, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', capture);
      if (restored) void useWorkspacesStore.getState().saveWorkspaceState({ id: workspaceId, sessionKey,
        state: { readingPosition: lastPosition },
      }).catch((error) => console.warn('Could not save session reading position', error));
    };
  }, [workspaceId, sessionKey, generation, loading, element]);
}
