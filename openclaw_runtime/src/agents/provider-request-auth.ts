/**
 * Single-source auth resolution for provider requests.
 *
 * The runtime transport (provider-request-config.ts) and the Electron
 * save-time validator (provider-validation.ts) both derive outbound auth from
 * this resolver, so a credential that passes validation can never be sent in a
 * different format by the real transport. Keep this module dependency-free:
 * it is imported from both the runtime and the Electron main bundle.
 */

export type ProviderRequestAuthOverride =
  | { mode: "provider-default" }
  | { mode: "authorization-bearer"; token: string }
  | { mode: "header"; headerName: string; value: string; prefix?: string }
  | { mode: "query"; parameterName: string; value: string };

export type ResolvedProviderRequestAuth =
  | {
      configured: false;
      mode: "provider-default" | "authorization-bearer";
      injectAuthorizationHeader: boolean;
    }
  | {
      configured: true;
      mode: "authorization-bearer";
      headerName: "Authorization";
      value: string;
      injectAuthorizationHeader: true;
    }
  | {
      configured: true;
      mode: "header";
      headerName: string;
      value: string;
      prefix?: string;
      injectAuthorizationHeader: false;
    }
  | {
      configured: true;
      mode: "query";
      parameterName: string;
      value: string;
      injectAuthorizationHeader: false;
    };

export function resolveProviderRequestAuth(params: {
  authHeader?: boolean;
  auth?: ProviderRequestAuthOverride;
}): ResolvedProviderRequestAuth {
  const auth = params.auth;
  if (auth?.mode === "authorization-bearer") {
    const value = auth.token.trim();
    if (value) {
      return {
        configured: true,
        mode: "authorization-bearer",
        headerName: "Authorization",
        value,
        injectAuthorizationHeader: true,
      };
    }
  }
  if (auth?.mode === "header") {
    const headerName = auth.headerName.trim();
    const value = auth.value.trim();
    // Keep the user's exact prefix (a trailing space like "Bearer " is part of
    // the separator); only reject blank prefixes.
    const prefix = auth.prefix && auth.prefix.trim() ? auth.prefix : undefined;
    if (headerName && value) {
      return {
        configured: true,
        mode: "header",
        headerName,
        value,
        ...(prefix ? { prefix } : {}),
        injectAuthorizationHeader: false,
      };
    }
  }
  if (auth?.mode === "query") {
    const parameterName = auth.parameterName.trim();
    const value = auth.value.trim();
    if (parameterName && value) {
      return {
        configured: true,
        mode: "query",
        parameterName,
        value,
        injectAuthorizationHeader: false,
      };
    }
  }
  return {
    configured: false,
    mode: params.authHeader ? "authorization-bearer" : "provider-default",
    injectAuthorizationHeader: params.authHeader === true,
  };
}

/** Concrete outbound header entries for a resolved auth (query auth yields none). */
export function providerRequestAuthHeaders(
  auth: ResolvedProviderRequestAuth,
): Record<string, string> | undefined {
  if (!auth.configured || auth.mode === "query") {
    return undefined;
  }
  const value =
    auth.mode === "authorization-bearer"
      ? `Bearer ${auth.value}`
      : `${auth.prefix ?? ""}${auth.value}`;
  return { [auth.headerName]: value };
}

/** Concrete outbound URL query entries for a resolved query auth (non-query yields none). */
export function providerRequestAuthQuery(
  auth: ResolvedProviderRequestAuth,
): Record<string, string> | undefined {
  if (!auth.configured || auth.mode !== "query") {
    return undefined;
  }
  return { [auth.parameterName]: auth.value };
}

/** Append resolved auth query parameters to a URL string, returning the updated URL. */
export function appendProviderRequestAuthQuery(
  url: string,
  auth: ResolvedProviderRequestAuth,
): string {
  const query = providerRequestAuthQuery(auth);
  if (!query) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  const params = Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${url}${separator}${params}`;
}
