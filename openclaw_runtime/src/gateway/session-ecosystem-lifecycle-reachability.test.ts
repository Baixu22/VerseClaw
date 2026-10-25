// TF-0084 owner path 2: production reachability census for the whole lifecycle
// method surface.
//
// TF-0079 proved one method (`sessions.stop`) reachable. That single-method probe
// did not stop the same defect recurring: TF-0082 shipped `sessions.yieldState`
// with a handler and a core descriptor spec but never listed it in the lazy
// `loadSessionsHandlers` map, and `createCoreGatewayMethodDescriptors` silently
// skips any spec whose handler is absent — so the Gateway answered "unknown
// method" while the focused unit tests, which call the handler module directly,
// stayed green.
//
// This census closes that gap for every lifecycle-governance method at once: a
// declared method must have a real handler, an advertised core descriptor with
// the intended scope, and must dispatch through the production registry far
// enough to reach its own parameter validation.
import { describe, expect, it } from "vitest";

import { ErrorCodes } from "../../packages/gateway-protocol/src/index.js";
import {
  createCoreGatewayMethodDescriptors,
  createGatewayMethodRegistry,
} from "./methods/registry.js";
import { coreGatewayHandlers, handleGatewayRequest } from "./server-methods.js";

/**
 * The lifecycle surface TF-0078 declares. Scopes are the intended policy, not a
 * copy of whatever the descriptor happens to say: a widened scope must fail here.
 * TF-0089 extended the census to every chain-touched method: `sessions.steer` is
 * deliberately unadvertised (internal companion of `sessions.send`), so its
 * expectation pins `advertised: false` instead.
 */
const LIFECYCLE_METHODS: ReadonlyArray<{
  name: string;
  scope: string;
  advertised?: boolean;
  /** Substring of the method's own parameter-validation error, proving dispatch
   *  resolved a real handler rather than answering "unknown method". */
  validationContains: string;
  /** Params that force the method's own validator to reject. Defaults to `{}`;
   *  `sessions.cleanup` accepts empty params (all-optional schema), so it gets
   *  an unknown property instead, which its `additionalProperties: false`
   *  schema rejects before any cleanup work can start. */
  dispatchParams?: Record<string, unknown>;
}> = [
  {
    name: "session.activitySnapshot",
    scope: "operator.read",
    validationContains: "session.activitySnapshot requires sessionKey",
  },
  {
    name: "sessions.yieldState",
    scope: "operator.read",
    validationContains: "invalid sessions.yieldState params",
  },
  {
    name: "sessions.lifecycleLedger",
    scope: "operator.read",
    validationContains: "invalid sessions.lifecycleLedger params",
  },
  {
    name: "sessions.queueDrain",
    scope: "operator.write",
    validationContains: "invalid sessions.queueDrain params",
  },
  {
    name: "sessions.send",
    scope: "operator.write",
    validationContains: "invalid sessions.send params",
  },
  {
    name: "sessions.steer",
    scope: "operator.write",
    advertised: false,
    validationContains: "invalid sessions.steer params",
  },
  {
    name: "sessions.stop",
    scope: "operator.admin",
    validationContains: "invalid sessions.stop params",
  },
  {
    name: "sessions.archive",
    scope: "operator.admin",
    validationContains: "invalid sessions.archive params",
  },
  {
    name: "sessions.restore",
    scope: "operator.admin",
    validationContains: "invalid sessions.restore params",
  },
  {
    name: "sessions.reset",
    scope: "operator.admin",
    validationContains: "invalid sessions.reset params",
  },
  {
    name: "sessions.delete",
    scope: "operator.admin",
    validationContains: "invalid sessions.delete params",
  },
  {
    name: "sessions.cleanup",
    scope: "operator.admin",
    validationContains: "invalid sessions.cleanup params",
    dispatchParams: { __reachability_probe__: true },
  },
  {
    name: "mission.cancel",
    scope: "operator.write",
    validationContains: 'mission.cancel requires a "missionId"',
  },
  {
    name: "mission.resume",
    scope: "operator.write",
    validationContains: 'mission.resume requires a "missionId"',
  },
];

function buildRegistry() {
  return createGatewayMethodRegistry(createCoreGatewayMethodDescriptors(coreGatewayHandlers));
}

describe("session ecosystem lifecycle method reachability census", () => {
  it("resolves every declared lifecycle method to a handler and an advertised descriptor", () => {
    const registry = buildRegistry();
    const advertised = new Set(registry.listAdvertisedMethods());
    const descriptors = new Map(registry.descriptors().map((entry) => [entry.name, entry]));

    // One assertion over the whole surface: a failure names the exact method and
    // which of the three registration points is missing, rather than stopping at
    // the first one.
    const census = LIFECYCLE_METHODS.map(({ name, scope }) => ({
      name,
      handler: typeof coreGatewayHandlers[name],
      descriptorScope: descriptors.get(name)?.scope ?? null,
      advertised: advertised.has(name),
      resolvedHandler: typeof registry.getHandler(name),
      expectedScope: scope,
    }));

    expect(census).toEqual(
      LIFECYCLE_METHODS.map(({ name, scope, advertised: expectAdvertised }) => ({
        name,
        handler: "function",
        descriptorScope: scope,
        advertised: expectAdvertised !== false,
        resolvedHandler: "function",
        expectedScope: scope,
      })),
    );
  });

  it("owns a core descriptor for every registered core handler", () => {
    // `createCoreGatewayMethodDescriptors` throws on an unclassified handler, so
    // building the registry is itself the assertion for the reverse direction.
    expect(() => buildRegistry()).not.toThrow();
  });

  it("dispatches every declared lifecycle method through the production registry into its own validation", async () => {
    // TF-0090: closes the gap with the ledger-acceptance spec wording
    // ("proven by dispatching through the production registry") for all twelve
    // methods, not just the two read surfaces tested individually below.
    const methodRegistry = buildRegistry();

    for (const { name, validationContains, dispatchParams } of LIFECYCLE_METHODS) {
      const responses: Array<{
        ok: boolean;
        error?: { code?: string; message?: string };
      }> = [];

      await handleGatewayRequest({
        req: {
          type: "req",
          id: `lifecycle-reachability-${name}`,
          method: name,
          params: dispatchParams ?? {},
        },
        client: null,
        isWebchatConnect: () => false,
        context: { unavailableGatewayMethods: new Set() } as never,
        methodRegistry,
        respond: (ok, _payload, error) => responses.push({ ok, error }),
      });

      expect(responses, name).toHaveLength(1);
      expect(responses[0], name).toMatchObject({
        ok: false,
        error: { code: ErrorCodes.INVALID_REQUEST },
      });
      // Reaching the method's own validator is the proof that dispatch resolved
      // a real handler; "unknown method" would mean the registration is
      // incomplete.
      expect(responses[0]?.error?.message, name).toContain(validationContains);
      expect(responses[0]?.error?.message, name).not.toContain("unknown method");
    }
  });

  it("dispatches the read-only ledger through the production registry into validation", async () => {
    const methodRegistry = buildRegistry();
    const responses: Array<{
      ok: boolean;
      payload?: unknown;
      error?: { code?: string; message?: string };
    }> = [];

    await handleGatewayRequest({
      req: {
        type: "req",
        id: "sessions-lifecycle-ledger-reachability",
        method: "sessions.lifecycleLedger",
        params: {},
      },
      client: null,
      isWebchatConnect: () => false,
      context: { unavailableGatewayMethods: new Set() } as never,
      methodRegistry,
      respond: (ok, payload, error) => responses.push({ ok, payload, error }),
    });

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ ok: false, error: { code: ErrorCodes.INVALID_REQUEST } });
    // Reaching the method's own validator is the proof that dispatch resolved a
    // real handler; "unknown method" would mean the registration is incomplete.
    expect(responses[0]?.error?.message).toContain("invalid sessions.lifecycleLedger params");
    expect(responses[0]?.error?.message).not.toContain("unknown method");
  });

  it("dispatches the yield-state read surface through the production registry", async () => {
    const methodRegistry = buildRegistry();
    const responses: Array<{ ok: boolean; error?: { code?: string; message?: string } }> = [];

    await handleGatewayRequest({
      req: {
        type: "req",
        id: "sessions-yield-state-reachability",
        method: "sessions.yieldState",
        params: {},
      },
      client: null,
      isWebchatConnect: () => false,
      context: { unavailableGatewayMethods: new Set() } as never,
      methodRegistry,
      respond: (ok, _payload, error) => responses.push({ ok, error }),
    });

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ ok: false, error: { code: ErrorCodes.INVALID_REQUEST } });
    expect(responses[0]?.error?.message).toContain("invalid sessions.yieldState params");
    expect(responses[0]?.error?.message).not.toContain("unknown method");
  });
});
