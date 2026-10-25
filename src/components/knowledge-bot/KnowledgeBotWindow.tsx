import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { KnowledgeChatContext } from '@/pages/Chat/KnowledgeChat';
import type { KnowledgeLibrarianCitation } from '@/pages/Knowledge/knowledge-view-utils';

const KnowledgeChat = lazy(() => import('@/pages/Chat/KnowledgeChat').then((module) => ({ default: module.KnowledgeChat })));

/** Keep the thread mounted on close so a pending request can finish/checkpoint. */
export function KnowledgeBotWindow({ open, context, onClose, onAfterClose, onOpenCitation }: {
  open: boolean;
  context: KnowledgeChatContext;
  onClose: () => void;
  onAfterClose: () => void;
  onOpenCitation: (citation: KnowledgeLibrarianCitation) => void;
}) {
  const { t } = useTranslation('knowledge');
  const panel = useRef<HTMLElement>(null);
  const motion = useRef<Animation | null>(null);
  const transition = useRef(0);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const ticket = ++transition.current;
    const wasClosed = node.dataset.phase === 'closed';
    const current = getComputedStyle(node);
    const from = { opacity: wasClosed ? '0' : current.opacity, transform: wasClosed ? 'translate(12px, 16px)' : current.transform };
    motion.current?.cancel();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    node.inert = !open;
    if (!open && wasClosed) { node.hidden = true; return; }
    node.hidden = false;
    node.dataset.phase = open ? 'opening' : 'closing';
    if (open) node.focus();
    const finish = () => {
      if (ticket !== transition.current) return;
      node.dataset.phase = open ? 'open' : 'closed';
      node.hidden = !open;
      motion.current = null;
      if (!open) onAfterClose();
    };
    if (!node.animate) { finish(); return; }
    const animation = node.animate([
      { ...from, transform: reduced ? 'none' : from.transform },
      { opacity: open ? '1' : '0', transform: reduced || open ? 'none' : 'translate(12px, 16px)' },
    ], { duration: reduced ? 80 : open ? 180 : 140, easing: 'cubic-bezier(.22,.8,.3,1)' });
    motion.current = animation;
    void animation.finished.then(finish).catch(() => { /* A newer transition owns visibility. */ });
  }, [open, onAfterClose]);
  useEffect(() => () => { ++transition.current; motion.current?.cancel(); }, []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onClose]);
  return createPortal(
    <section ref={panel} className="knowledge-bot-window" role="dialog" aria-modal="false" aria-hidden={!open}
      aria-label={t('librarian.chatTitle')} tabIndex={-1} data-testid="knowledge-bot-window" data-phase="closed">
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">{t('librarian.searching')}</p>}>
        <KnowledgeChat embedded context={context} onClose={onClose} onOpenCitation={onOpenCitation} />
      </Suspense>
    </section>, document.body,
  );
}
