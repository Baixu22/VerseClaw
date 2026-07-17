import { shell } from 'electron';
import { assertAllowedExternalNavigationUrl } from '../../shared/security/url-policy';

/**
 * Open a URL in the system browser after enforcing the shared http/https allowlist.
 */
export async function openExternalSafe(url: unknown): Promise<string> {
  const href = assertAllowedExternalNavigationUrl(url);
  await shell.openExternal(href);
  return href;
}