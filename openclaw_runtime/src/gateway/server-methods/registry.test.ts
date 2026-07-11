import { describe, expect, it, vi } from "vitest";
import { coreGatewayHandlers } from "../server-methods.js";

describe("DCS gateway handler registry", () => {
  it.each(["sessions.compressionArtifact", "sessions.recoveryContext"])(
    "dispatches %s through the exported core handler registry",
    async (method) => {
      const handler = coreGatewayHandlers[method];
      expect(handler).toBeTypeOf("function");

      const respond = vi.fn();
      await expect(
        Promise.resolve(
          handler?.({
            req: { type: "req", id: `registry-${method}`, method } as never,
            params: {},
            client: null,
            isWebchatConnect: () => false,
            respond,
            context: {} as never,
          }),
        ),
      ).resolves.toBeUndefined();
      expect(respond).toHaveBeenCalledOnce();
      expect(respond).toHaveBeenCalledWith(false, undefined, expect.any(Object));
    },
  );
});
