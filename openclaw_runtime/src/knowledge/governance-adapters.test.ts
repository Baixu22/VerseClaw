import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryWikiGovernedAdapter,
  createRoleMemoryGovernedAdapter,
  createSekbGovernedAdapter,
  governedAdapterRegistry,
} from "./governance-adapters.js";

afterEach(() => {
  governedAdapterRegistry.clearForTests();
});

describe("KS-03 governed target adapter registry", () => {
  it("registers memory-wiki, active memory slot (Role Memory), and SEKB", () => {
    governedAdapterRegistry.register(createMemoryWikiGovernedAdapter());
    governedAdapterRegistry.register(createRoleMemoryGovernedAdapter({ activeMemorySlot: "role-memory" }));
    governedAdapterRegistry.register(createSekbGovernedAdapter());
    expect(governedAdapterRegistry.owners()).toEqual(["memory-slot", "memory-wiki", "sekb"]);
    expect(governedAdapterRegistry.activeMemorySlot()).toBe("role-memory");
    expect(governedAdapterRegistry.get("memory-wiki")?.descriptor().owner).toBe("memory-wiki");
  });

  it("rejects a second active memory writer", () => {
    governedAdapterRegistry.register(createRoleMemoryGovernedAdapter({ activeMemorySlot: "role-memory" }));
    expect(() =>
      governedAdapterRegistry.register(createRoleMemoryGovernedAdapter({ activeMemorySlot: "runtime-memory" })),
    ).toThrow(/active memory writer already registered/);
  });

  it("allows role-memory re-registration as the same active slot after test reset only", () => {
    governedAdapterRegistry.register(createRoleMemoryGovernedAdapter({ activeMemorySlot: "role-memory" }));
    governedAdapterRegistry.clearForTests();
    expect(() => governedAdapterRegistry.register(createRoleMemoryGovernedAdapter({ activeMemorySlot: "role-memory" }))).not.toThrow();
  });

  it("rejects duplicate registrations for the same non-memory owner", () => {
    governedAdapterRegistry.register(createMemoryWikiGovernedAdapter());
    expect(() => governedAdapterRegistry.register(createMemoryWikiGovernedAdapter())).toThrow(/already registered/);
  });

  it("adapters satisfy prepare/commit/compensate/enumerate contract without durable side effects", async () => {
    const wiki = createMemoryWikiGovernedAdapter();
    const plan = await wiki.prepare({ proposalId: "p1", operation: "create", subjectId: "wiki-1", contentDigest: "d1", idempotencyKey: "k1", sourceRefs: [] });
    const result = await wiki.commit(plan);
    expect(result).toEqual({ success: true });
    expect(await wiki.enumerateBySource("source-1")).toEqual([]);
  });
});
