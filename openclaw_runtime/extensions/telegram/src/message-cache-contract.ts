import { createHash } from "node:crypto";

export const TELEGRAM_MESSAGE_CACHE_PERSISTENT_MAX_MESSAGES = 3000;
export const TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE = "telegram.message-cache";

export function resolveTelegramMessageCachePath(storePath: string): string {
  return `${storePath}.telegram-messages.json`;
}

export function resolveTelegramMessageCachePersistentScopeKey(scope: string): string {
  return createHash("sha256").update(scope).digest("hex").slice(0, 24);
}
