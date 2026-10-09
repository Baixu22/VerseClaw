/**
 * Single source of truth for the local OpenClaw Gateway loopback endpoint.
 *
 * The port used to be duplicated as a literal in Main config defaults, the
 * renderer stores, the mock host bridge, the Gateway Control-UI URL filter, the
 * project-rules detector (both regexes and user-facing copy) and the localized
 * settings descriptions. Changing the port silently broke the detector instead
 * of failing loudly, so every one of those sites now derives from here.
 *
 * Rules for new code:
 * - never write the port as a literal outside this module (tests excepted);
 * - build host/port strings, regexes and URL filters from these values;
 * - do not put the port into user-facing copy or localized JSON — describe the
 *   endpoint generically ("the local Gateway endpoint") instead.
 */

/** Default OpenClaw Gateway port. Overridable per-process by `VERSE_CLAW_PORT_OPENCLAW_GATEWAY`. */
export const OPENCLAW_GATEWAY_PORT = 18789;

/** Loopback hosts that may serve the Gateway Control UI. */
export const GATEWAY_LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `['127.0.0.1:18789', 'localhost:18789']` */
export const GATEWAY_HOST_PORT_PAIRS: readonly string[] = GATEWAY_LOOPBACK_HOSTS.map(
  (host) => `${host}:${OPENCLAW_GATEWAY_PORT}`,
);

/** `['http://127.0.0.1:18789', 'http://localhost:18789']` */
export const GATEWAY_HTTP_ORIGINS: readonly string[] = GATEWAY_LOOPBACK_HOSTS.map(
  (host) => `http://${host}:${OPENCLAW_GATEWAY_PORT}`,
);

/** `http://127.0.0.1:18789/*` and `http://localhost:18789/*`, for webRequest filters. */
export const GATEWAY_WEB_REQUEST_URL_FILTERS: readonly string[] = GATEWAY_HTTP_ORIGINS.map(
  (origin) => `${origin}/*`,
);

/** Regex-escaped alternation of the host:port pairs, e.g. `127\.0\.0\.1:18789|localhost:18789`. */
export const GATEWAY_HOST_PORT_REGEX_SOURCE: string = GATEWAY_HOST_PORT_PAIRS.map(escapeRegExp).join('|');

/** Backticked, human-readable endpoint list, e.g. `` `http://127.0.0.1:18789` or `http://localhost:18789` ``. */
export function formatGatewayHttpOrigins(separator = ' or '): string {
  return GATEWAY_HTTP_ORIGINS.map((origin) => `\`${origin}\``).join(separator);
}
