import type { ChatSession } from '@shared/chat/types';

/** A saved conversation wins; only a new draft inherits the last explicit pick. */
export function resolveChatModelRef({ session, hasMessages, lastModelRef, modelOptions, agentModelRef, defaultModelRef }: {
  session?: ChatSession;
  hasMessages: boolean;
  lastModelRef?: string | null;
  modelOptions: ReadonlyArray<{ modelRef: string }>;
  agentModelRef?: string | null;
  defaultModelRef?: string | null;
}): string | null {
  if (session?.modelRefOverride) return session.modelRefOverride;
  const hasHistory = hasMessages || Boolean(session?.updatedAt || session?.messageCount || session?.model);
  if (!hasHistory && lastModelRef && modelOptions.some((option) => option.modelRef === lastModelRef)) return lastModelRef;
  return agentModelRef || defaultModelRef || modelOptions[0]?.modelRef || null;
}
