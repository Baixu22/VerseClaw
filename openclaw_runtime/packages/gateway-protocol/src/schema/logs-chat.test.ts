import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ChatSendParamsSchema } from "./logs-chat.js";

/**
 * D3 closeout: Gateway chat.send schema must accept `workspaceFingerprint` so
 * Main can forward the trusted authority fingerprint produced from the
 * workspace's normalized rootPath. Without this field, `additionalProperties:
 * false` would reject any Main-produced fingerprint at the Gateway boundary.
 */
describe("ChatSendParamsSchema (D3 closeout)", () => {
  const minimalValid = {
    sessionKey: "agent:main:main",
    message: "Continue work",
    idempotencyKey: "idem-ws-fp",
  };

  it("accepts workspaceFingerprint alongside workspaceId", () => {
    const params = {
      ...minimalValid,
      workspaceId: "ws-app",
      workspaceFingerprint: "0123456789abcdef",
    };
    expect(Value.Check(ChatSendParamsSchema, params)).toBe(true);
  });

  it("accepts the trusted backend workspace directory", () => {
    const params = {
      ...minimalValid,
      workspaceDir: "C:/projects/verse-claw",
    };
    expect(Value.Check(ChatSendParamsSchema, params)).toBe(true);
  });

  it("accepts workspaceFingerprint without workspaceId", () => {
    const params = {
      ...minimalValid,
      workspaceFingerprint: "abcdef0123456789",
    };
    expect(Value.Check(ChatSendParamsSchema, params)).toBe(true);
  });

  it("accepts params without workspaceFingerprint (optional field)", () => {
    const params = {
      ...minimalValid,
      workspaceId: "ws-app",
    };
    expect(Value.Check(ChatSendParamsSchema, params)).toBe(true);
  });

  it("accepts the logical deadline propagated by Main (NET-E)", () => {
    const params = {
      ...minimalValid,
      deadlineAtMs: 1_800_000_000_000,
    };
    expect(Value.Check(ChatSendParamsSchema, params)).toBe(true);
  });

  it("rejects a non-integer or non-positive logical deadline", () => {
    expect(Value.Check(ChatSendParamsSchema, { ...minimalValid, deadlineAtMs: 1_800_000_000_000.5 })).toBe(false);
    expect(Value.Check(ChatSendParamsSchema, { ...minimalValid, deadlineAtMs: 0 })).toBe(false);
    expect(Value.Check(ChatSendParamsSchema, { ...minimalValid, deadlineAtMs: "soon" })).toBe(false);
  });

  it("rejects unknown fields (additionalProperties: false still enforced)", () => {
    const params = {
      ...minimalValid,
      workspaceFingerprint: "0123456789abcdef",
      rogueField: "should-be-rejected",
    };
    expect(Value.Check(ChatSendParamsSchema, params)).toBe(false);
  });
});
