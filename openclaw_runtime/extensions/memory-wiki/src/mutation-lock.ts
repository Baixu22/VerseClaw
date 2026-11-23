import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "openclaw/plugin-sdk/file-lock";

const pending = new Map<string, Promise<unknown>>();

/** Vault mutations also rebuild shared indexes; hold one owner lock through commit. */
export async function withWikiMutationLock<T>(vaultPath: string, action: () => Promise<T>): Promise<T> {
  await mkdir(vaultPath, { recursive: true });
  const canonical = await realpath(vaultPath);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const previous = pending.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(() => withFileLock(
    path.join(canonical, ".wiki-mutation"),
    { stale: 300_000, retries: { retries: 100, factor: 1, minTimeout: 50, maxTimeout: 50 } },
    action,
  ));
  pending.set(key, operation);
  try { return await operation; }
  finally { if (pending.get(key) === operation) pending.delete(key); }
}
