/**
 * #180: `sessions.fork` gains an optional in-transcript fork point. The payload
 * stays backward compatible (whole-session fork when omitted) and rejects
 * malformed/unknown input, because the schema is `additionalProperties: false`.
 */
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { SessionsForkParamsSchema } from "./sessions.js";

describe("#180 sessions.fork params", () => {
  it("accepts the original whole-session fork payload", () => {
    expect(Value.Check(SessionsForkParamsSchema, { key: "agent:main:main" })).toBe(true);
    expect(
      Value.Check(SessionsForkParamsSchema, {
        key: "agent:main:main",
        agentId: "main",
        label: "child",
      }),
    ).toBe(true);
  });

  it("accepts an optional fromLeafId fork point", () => {
    expect(
      Value.Check(SessionsForkParamsSchema, { key: "agent:main:main", fromLeafId: "entry-a1" }),
    ).toBe(true);
  });

  it("rejects an empty fromLeafId and unknown properties", () => {
    expect(
      Value.Check(SessionsForkParamsSchema, { key: "agent:main:main", fromLeafId: "" }),
    ).toBe(false);
    expect(Value.Check(SessionsForkParamsSchema, { key: "agent:main:main", nope: 1 })).toBe(false);
  });
});