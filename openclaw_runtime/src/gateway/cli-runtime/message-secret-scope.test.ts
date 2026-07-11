import { describe, expect, it } from "vitest";
import { resolveMessageSecretScope } from "./message-secret-scope.js";

describe("resolveMessageSecretScope", () => {
  it("normalizes an explicit deliverable channel and account", () => {
    expect(resolveMessageSecretScope({
      channel: " Telegram ",
      accountId: " Team Primary ",
    })).toEqual({
      channel: "telegram",
      accountId: "team-primary",
    });
  });

  it("infers the channel from a prefixed target", () => {
    expect(resolveMessageSecretScope({
      target: "discord:channel:123",
    })).toEqual({ channel: "discord" });
  });

  it("infers a channel only when all targets agree", () => {
    expect(resolveMessageSecretScope({
      targets: ["slack:C01", "slack:C02"],
    })).toEqual({ channel: "slack" });
    expect(resolveMessageSecretScope({
      targets: ["slack:C01", "discord:123"],
    })).toEqual({});
  });

  it("rejects internal and unknown channels", () => {
    expect(resolveMessageSecretScope({ channel: "webchat" })).toEqual({});
    expect(resolveMessageSecretScope({ channel: "not-a-channel" })).toEqual({});
  });

  it("uses valid fallbacks without inventing a default scope", () => {
    expect(resolveMessageSecretScope({
      fallbackChannel: "signal",
      fallbackAccountId: " Alerts ",
    })).toEqual({
      channel: "signal",
      accountId: "alerts",
    });
    expect(resolveMessageSecretScope({})).toEqual({});
  });

  it("narrows untrusted tool arguments at the scope boundary", () => {
    expect(resolveMessageSecretScope({
      channel: { value: "telegram" },
      target: 42,
      targets: ["slack:C01", null, { channel: "slack" }],
      accountId: ["primary"],
      fallbackChannel: "discord",
    })).toEqual({ channel: "slack" });
  });
});
