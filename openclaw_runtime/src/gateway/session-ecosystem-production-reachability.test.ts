import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../../packages/gateway-protocol/src/index.js";
import {
  createGatewayMethodRegistry,
  createCoreGatewayMethodDescriptors,
} from "./methods/registry.js";
import { coreGatewayHandlers, handleGatewayRequest } from "./server-methods.js";

describe("sessions.stop production Gateway reachability", () => {
  it("registers the existing handler as an advertised operator-admin core method", () => {
    const descriptors = createCoreGatewayMethodDescriptors(coreGatewayHandlers);
    const registry = createGatewayMethodRegistry(descriptors);
    const descriptor = registry.descriptors().find(({ name }) => name === "sessions.stop");

    expect(coreGatewayHandlers["sessions.stop"]).toBeTypeOf("function");
    expect(descriptor).toMatchObject({
      name: "sessions.stop",
      scope: "operator.admin",
      owner: { kind: "core", area: "gateway" },
    });
    expect(registry.listAdvertisedMethods()).toContain("sessions.stop");
    expect(registry.getHandler("sessions.stop")).toBeTypeOf("function");
  });

  it("dispatches into the real lazy handler and reaches validation", async () => {
    const methodRegistry = createGatewayMethodRegistry(
      createCoreGatewayMethodDescriptors(coreGatewayHandlers),
    );
    const responses: Array<{
      ok: boolean;
      payload?: unknown;
      error?: { code?: string; message?: string };
    }> = [];

    await handleGatewayRequest({
      req: {
        type: "req",
        id: "sessions-stop-reachability",
        method: "sessions.stop",
        params: {},
      },
      client: null,
      isWebchatConnect: () => false,
      context: { unavailableGatewayMethods: new Set() } as never,
      methodRegistry,
      respond: (ok, payload, error) => responses.push({ ok, payload, error }),
    });

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      ok: false,
      error: { code: ErrorCodes.INVALID_REQUEST },
    });
    expect(responses[0]?.error?.message).toContain("invalid sessions.stop params");
    expect(responses[0]?.error?.message).not.toContain("unknown method");
  });
});
