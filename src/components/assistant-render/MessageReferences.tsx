import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Element, Root, Text } from 'hast';
import type { ChatSession } from '@shared/chat/types';
import { maskChatSecrets } from '@/lib/chat-display-text';
import { collectDraftReferences } from '@/lib/composer-references';

type Reference = { key: string; label: string };
const emptyIndex = new Map<string, Reference | null>();
const ReferenceContext = createContext<{ index: typeof emptyIndex; open?: (key: string) => void }>({ index: emptyIndex });

export function MessageReferenceProvider({ sessions, labels, open, children }: {
  sessions: ChatSession[]; labels: Record<string, string>; open: (key: string) => void; children: ReactNode;
}) {
  const index = useMemo(() => {
    const entries = new Map<string, Reference | null>();
    for (const session of sessions) {
      const ref = { key: session.key, label: maskChatSecrets(labels[session.key] || session.label || session.derivedTitle || session.displayName || session.key) };
      for (const id of new Set([session.key, session.sessionId])) {
        if (id) entries.set(id, entries.has(id) ? null : ref);
      }
    }
    return entries;
  }, [sessions, labels]);
  const value = useMemo(() => ({ index, open }), [index, open]);
  return <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>;
}

export function SessionReference({ id }: { id: string }) {
  const { index, open } = useContext(ReferenceContext);
  const { t } = useTranslation('chat');
  const ref = index.get(id);
  if (!ref || !open) return <>{id}</>;
  const title = ref.label === id ? ref.label : `${ref.label}\n${maskChatSecrets(id)}`;
  return <button type="button" className="chat-session-reference" title={title}
    aria-label={t('markdown.openSession', { name: ref.label })} onClick={() => open(ref.key)}>
    <MessagesSquare aria-hidden="true" size={14} /><span>{ref.label}</span>
  </button>;
}

export function useDraftSessions() {
  return useContext(ReferenceContext);
}

// Transform prose after Markdown parsing so link targets, literal code and math keep their meaning.
function referenceNodes(value: string, index: typeof emptyIndex): (Element | Text)[] {
  const nodes: (Element | Text)[] = [];
  let end = 0;
  for (const match of value.matchAll(/[\w-]+(?:[.:/@#][\w-]+)*/g)) {
    const id = match[0];
    let element: Element;
    if (index.get(id)) {
      element = { type: 'element', tagName: 'button', properties: { dataSessionRef: id }, children: [] };
    } else {
      const explicitRepo = /^(?:github|repo):([\w-]+\/[\w.-]+)(?:#([1-9]\d*)|@([\da-f]{7,40}))?$/i.exec(id);
      const github = /^([\w-]+\/[\w.-]+)(?:#([1-9]\d*)|@([\da-f]{7,40}))$/i.exec(id);
      const bare = /^github\.com\/[\w-]+\/[\w.-]+(?:\/[\w./-]+)?$/i.test(id);
      const arxiv = /^arXiv:(\d{4}\.\d{4,5}(?:v\d+)?)$/i.exec(id);
      const cve = /^CVE-\d{4}-\d{4,7}$/i.test(id);
      if (!explicitRepo && !github && !bare && !arxiv && !cve) continue;
      const href = explicitRepo
        ? `https://github.com/${explicitRepo[1]}${explicitRepo[2] ? '/issues/' + explicitRepo[2] : explicitRepo[3] ? '/commit/' + explicitRepo[3] : ''}`
        : github
          ? `https://github.com/${github[1]}/${github[2] ? 'issues/' + github[2] : 'commit/' + github[3]}`
          : arxiv
            ? `https://arxiv.org/abs/${arxiv[1]}`
            : cve
              ? `https://nvd.nist.gov/vuln/detail/${id.toUpperCase()}`
              : 'https://' + id;
      element = { type: 'element', tagName: 'a', properties: { href }, children: [{ type: 'text', value: id }] };
    }
    if (end < match.index) nodes.push({ type: 'text', value: value.slice(end, match.index) });
    nodes.push(element);
    end = match.index + id.length;
  }
  if (end < value.length) nodes.push({ type: 'text', value: value.slice(end) });
  return nodes;
}

export function useMessageReferences() {
  const { index } = useContext(ReferenceContext);
  return useMemo(() => () => (tree: Root) => {
    function visit(parent: Root | Element) {
      for (let i = parent.children.length - 1; i >= 0; i--) {
        const child = parent.children[i];
        if (child.type === 'text') {
          if (parent.type === 'element' && parent.tagName === 'p' && parent.children.length === 1
            && /^\s*[\w-]+\/[\w.-]+\s*$/.test(child.value)) {
            const [reference] = collectDraftReferences(child.value, index);
            if (reference?.kind === 'repo') {
              parent.children[i] = { type: 'element', tagName: 'a', properties: { href: reference.target }, children: [child] };
              continue;
            }
          }
          const parts = referenceNodes(child.value, index);
          if (parts.some(part => part.type === 'element')) parent.children.splice(i, 1, ...parts);
        } else if (child.type === 'element' && child.tagName === 'code') {
          const literal = child.children[0];
          if (child.children.length === 1 && literal?.type === 'text' && index.get(literal.value)) {
            parent.children[i] = { type: 'element', tagName: 'button', properties: { dataSessionRef: literal.value }, children: [literal] };
          }
        } else if (child.type === 'element' && !['a', 'pre', 'math', 'svg'].includes(child.tagName)
          && !String(child.properties.className).includes('katex')) {
          visit(child);
        }
      }
    }
    visit(tree);
  }, [index]);
}
