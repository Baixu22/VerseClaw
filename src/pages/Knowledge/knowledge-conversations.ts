import type { KnowledgeChatContext } from '../Chat/KnowledgeChat';
import { KNOWLEDGE_LIBRARIAN_STORAGE_KEY, parseLibrarianCheckpoint, type KnowledgeLibrarianCheckpoint } from './knowledge-view-utils';

const prefix = KNOWLEDGE_LIBRARIAN_STORAGE_KEY + '.';
const changed = 'knowledge-conversation-changed';
const unsaved = new Map<string, string>();
let version = 0;
export function conversationVersion() { return version; }
export function notifyConversations() {
  version++;
  window.dispatchEvent(new Event(changed));
}

export function conversationKey(workspaceId: string | null, context: KnowledgeChatContext) {
  const members = (context.sourceRefs ?? []).map(ref =>
    JSON.stringify([ref.id, ref.kind, ref.path, ref.revision, ref.contentDigest, ref.sourceRef])).sort();
  return prefix + JSON.stringify([workspaceId, context.sourceSetId ?? null, members]);
}

export function readConversation(key: string) {
  return unsaved.get(key) ?? localStorage.getItem(key);
}

export function conversationUnsaved(key: string) { return unsaved.has(key); }

export function updateConversation(key: string, edit: (previous: KnowledgeLibrarianCheckpoint | null) => KnowledgeLibrarianCheckpoint | null) {
  const previous = parseLibrarianCheckpoint(readConversation(key));
  const next = edit(previous);
  if (next === previous) return;
  if (next) {
    const raw = JSON.stringify({ ...next, updatedAt: new Date().toISOString() });
    try { localStorage.setItem(key, raw); unsaved.delete(key); }
    catch { unsaved.set(key, raw); }
  } else {
    localStorage.removeItem(key);
    unsaved.delete(key);
  }
  notifyConversations();
}

export function subscribeConversations(notify: () => void) {
  const onStorage = () => { version++; notify(); };
  window.addEventListener(changed, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changed, notify);
    window.removeEventListener('storage', onStorage);
  };
}

export function knowledgeHistory(workspaceId: string | null) {
  const rows: Array<{ key: string; context: KnowledgeChatContext; title: string; updatedAt: string; mainSessionKey?: string }> = [];
  for (const key of new Set([...Object.keys(localStorage), ...unsaved.keys()])) {
    if (!key.startsWith(prefix)) continue;
    try {
      const [owner, setId, members] = JSON.parse(key.slice(prefix.length));
      if (owner !== workspaceId || !Array.isArray(members)) continue;
      const record = parseLibrarianCheckpoint(readConversation(key));
      if (!record?.messages.length) continue;
      const sourceRefs = record.sourceRefs ?? members.map((member: string) => {
        const [id, kind, path, revision, contentDigest, sourceRef] = JSON.parse(member);
        return { id, kind: kind ?? undefined, path: path ?? undefined, revision: revision ?? undefined,
          contentDigest: contentDigest ?? undefined, sourceRef: sourceRef ?? undefined };
      });
      const context = { workspaceId, sourceSetId: setId, sourceSetTitle: record.sourceSetTitle, sourceRefs };
      if (conversationKey(workspaceId, context) !== key) continue;
      const title = record.messages.findLast(message => message.role === 'user')?.content || record.messages[0].content;
      rows.push({ key, context, title, updatedAt: record.updatedAt, mainSessionKey: record.mainSessionKey });
    } catch { /* Skip an unreadable entry without losing the other threads. */ }
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
