// TF-0089: startup-time reachability guard for core gateway method descriptors.
//
// `createCoreGatewayMethodDescriptors` used to silently skip any spec whose
// handler was absent from the lazy core handler map - the exact failure mode
// that shipped `sessions.yieldState` with a descriptor and a handler module
// while production answered "unknown method" (TF-0082, caught by the TF-0084
// census). The builder now throws for any unhandled spec unless the method is
// served through the auxiliary handler surface or is a documented pre-existing
// exception. These tests fence that behavior: a yieldState-style regression
// must fail registry construction, and the exception list must never grow
// silently.
import { describe, expect, it } from "vitest";

import {
  CORE_GATEWAY_METHOD_SPECS,
  createCoreGatewayMethodDescriptors,
  listKnownUnregisteredCoreMethodSpecs,
} from "./methods/core-descriptors.js";
import { GATEWAY_AUX_METHODS } from "./server-aux-methods.js";
import { coreGatewayHandlers } from "./server-methods.js";

describe("core gateway descriptor reachability guard", () => {
  it("builds descriptors from the real core handler map without throwing", () => {
    // Every spec either resolves to a core handler, is served through the aux
    // surface, or is one of the two documented pre-existing exceptions.
    expect(() => createCoreGatewayMethodDescriptors(coreGatewayHandlers)).not.toThrow();
  });

  it("fails registry construction when a classified method loses its core handler", () => {
    // Simulates the sessions.yieldState regression: descriptor spec present,
    // lazy handler map entry missing.
    const handlers = { ...coreGatewayHandlers };
    delete handlers["sessions.stop"];

    expect(() => createCoreGatewayMethodDescriptors(handlers)).toThrowError(
      /gateway method descriptor has no core handler: sessions\.stop/,
    );
  });

  it("keeps aux-served specs exempt from the core handler requirement", () => {
    const handlers = { ...coreGatewayHandlers };
    for (const method of GATEWAY_AUX_METHODS) {
      delete handlers[method];
    }
    expect(() => createCoreGatewayMethodDescriptors(handlers)).not.toThrow();
  });

  it("pins the documented exception list to the two pre-existing unreachable methods", () => {
    // The exception list is a reviewed allowlist, not a suppression knob:
    // growing it must be a deliberate, reviewed change that fails this test
    // until the entry is justified.
    expect(listKnownUnregisteredCoreMethodSpecs().map((entry) => entry.name).sort()).toEqual([
      "sessions.compressionArtifact",
      "sessions.recoveryContext",
    ]);
    for (const entry of listKnownUnregisteredCoreMethodSpecs()) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(CORE_GATEWAY_METHOD_SPECS.some((spec) => spec.name === entry.name)).toBe(true);
    }
  });
});
