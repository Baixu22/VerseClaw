/**
 * Proxy-aware Main fetch boundary.
 *
 * Electron keeps net.fetch when a fixed proxy is configured so Chromium owns
 * proxy bypass rules and certificate handling. Direct Electron requests use the
 * cooperative keep-alive NetworkPool. Node-only tests and tooling retain the
 * global fetch implementation they already stub.
 */
import { pooledFetch } from './network-pool';

let electronProxyEnabled = false;

/** Called by the Main proxy owner after session.defaultSession.setProxy(). */
export function setElectronProxyEnabled(enabled: boolean): void {
  electronProxyEnabled = enabled === true;
}

export function isElectronProxyEnabled(): boolean {
  return electronProxyEnabled;
}

export async function proxyAwareFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestUrl = input instanceof URL ? input.toString() : input;

  if (process.versions.electron) {
    if (electronProxyEnabled) {
      try {
        const { net } = await import('electron');
        return await net.fetch(requestUrl, init);
      } catch (error) {
        if (error instanceof Error && /Cannot find module ['"]electron['"]/u.test(error.message)) {
          return (await pooledFetch(requestUrl, init as never)) as unknown as Response;
        }
        throw error;
      }
    }
    return (await pooledFetch(requestUrl, init as never)) as unknown as Response;
  }

  return init === undefined ? await fetch(requestUrl) : await fetch(requestUrl, init);
}
