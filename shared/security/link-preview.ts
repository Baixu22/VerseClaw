import { classifyBrowserAddress } from '../agent-browser/private-network-policy';
import { evaluateExternalNavigationUrl } from './url-policy';

export const SENSITIVE_URL_QUERY_KEY = /token|key|secret|sig|password|passwd|pwd|auth|credential|session|code|access/i;

/** Cheap admission for both surfaces. Main checks the resolved network before reading. */
export function linkPreviewRequestUrl(input: unknown): URL | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  const navigation = evaluateExternalNavigationUrl(input);
  if (!navigation.ok || classifyBrowserAddress(navigation.href) !== 'public') return null;
  const url = new URL(navigation.href);
  if (url.port || !/[.:]/.test(url.hostname) || [...url.searchParams.keys()].some(key => SENSITIVE_URL_QUERY_KEY.test(key))) return null;
  url.hash = '';
  return url;
}
