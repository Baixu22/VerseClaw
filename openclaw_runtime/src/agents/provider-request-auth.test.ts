// R4: provider request auth 单一事实源 — bearer/header/query 解析与 URL query 追加。
import { describe, expect, it } from "vitest";
import {
  appendProviderRequestAuthQuery,
  providerRequestAuthHeaders,
  providerRequestAuthQuery,
  resolveProviderRequestAuth,
} from "./provider-request-auth.js";

describe("provider request auth resolution (single source for runtime + validator)", () => {
  it("resolves authorization-bearer into an Authorization header", () => {
    const auth = resolveProviderRequestAuth({
      auth: { mode: "authorization-bearer", token: "sk-test" },
    });
    expect(auth).toEqual({
      configured: true,
      mode: "authorization-bearer",
      headerName: "Authorization",
      value: "sk-test",
      injectAuthorizationHeader: true,
    });
    expect(providerRequestAuthHeaders(auth)).toEqual({ Authorization: "Bearer sk-test" });
    expect(providerRequestAuthQuery(auth)).toBeUndefined();
  });

  it("resolves custom header auth with and without prefix", () => {
    const withPrefix = resolveProviderRequestAuth({
      auth: { mode: "header", headerName: "X-API-Key", value: "key-1", prefix: "ApiKey " },
    });
    expect(providerRequestAuthHeaders(withPrefix)).toEqual({ "X-API-Key": "ApiKey key-1" });

    const bare = resolveProviderRequestAuth({
      auth: { mode: "header", headerName: "X-API-Key", value: "key-1" },
    });
    expect(providerRequestAuthHeaders(bare)).toEqual({ "X-API-Key": "key-1" });
    expect(providerRequestAuthQuery(bare)).toBeUndefined();
  });

  it("resolves query auth into URL query entries, not headers", () => {
    const auth = resolveProviderRequestAuth({
      auth: { mode: "query", parameterName: "key", value: "sk-query" },
    });
    expect(auth).toEqual({
      configured: true,
      mode: "query",
      parameterName: "key",
      value: "sk-query",
      injectAuthorizationHeader: false,
    });
    expect(providerRequestAuthHeaders(auth)).toBeUndefined();
    expect(providerRequestAuthQuery(auth)).toEqual({ key: "sk-query" });
  });

  it("falls back to provider-default (or bearer via authHeader) when auth is absent", () => {
    expect(resolveProviderRequestAuth({})).toEqual({
      configured: false,
      mode: "provider-default",
      injectAuthorizationHeader: false,
    });
    expect(resolveProviderRequestAuth({ authHeader: true })).toEqual({
      configured: false,
      mode: "authorization-bearer",
      injectAuthorizationHeader: true,
    });
  });

  it("treats blank credentials as unconfigured (fail-closed)", () => {
    expect(
      resolveProviderRequestAuth({ auth: { mode: "authorization-bearer", token: "  " } }),
    ).toEqual({ configured: false, mode: "provider-default", injectAuthorizationHeader: false });
    expect(
      resolveProviderRequestAuth({ auth: { mode: "header", headerName: "X-Key", value: " " } }),
    ).toEqual({ configured: false, mode: "provider-default", injectAuthorizationHeader: false });
    expect(
      resolveProviderRequestAuth({ auth: { mode: "query", parameterName: " ", value: "v" } }),
    ).toEqual({ configured: false, mode: "provider-default", injectAuthorizationHeader: false });
  });
});

describe("appendProviderRequestAuthQuery", () => {
  const queryAuth = resolveProviderRequestAuth({
    auth: { mode: "query", parameterName: "key", value: "sk q?&" },
  });
  const headerAuth = resolveProviderRequestAuth({
    auth: { mode: "header", headerName: "X-Key", value: "v" },
  });

  it("appends query auth to URLs and encodes names/values", () => {
    expect(appendProviderRequestAuthQuery("https://example.com/v1/models", queryAuth)).toBe(
      "https://example.com/v1/models?key=sk%20q%3F%26",
    );
  });

  it("preserves existing query strings", () => {
    expect(
      appendProviderRequestAuthQuery("https://example.com/v1/models?page=1", queryAuth),
    ).toBe("https://example.com/v1/models?page=1&key=sk%20q%3F%26");
  });

  it("leaves URLs untouched for non-query auth", () => {
    expect(appendProviderRequestAuthQuery("https://example.com/v1/models", headerAuth)).toBe(
      "https://example.com/v1/models",
    );
  });
});
