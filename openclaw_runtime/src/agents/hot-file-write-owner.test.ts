// @vitest-environment node
// L06: one verified write owner for a hot file (serialize + CAS + release).
import { describe, expect, it, afterEach } from "vitest";

import {
  claimWriteOwner,
  getActiveWriteOwner,
  getWriteOwnerConflicts,
  releaseWriteOwner,
  resetHotFileWriteOwnersForTests,
  withVerifiedWriteOwner,
} from "./hot-file-write-owner.js";

const FILE = "/workspace/hot.txt";

afterEach(() => resetHotFileWriteOwnersForTests());

describe("L06 hot-file write owner", () => {
  it("grants the first owner and reports a second owner as an explicit conflict (no silent concurrent write)", () => {
    const first = claimWriteOwner(FILE, "owner-a", 100);
    expect(first.ok).toBe(true);
    const second = claimWriteOwner(FILE, "owner-b", 101);
    expect(second).toMatchObject({ ok: false, reason: "owned-by-another-owner", holder: "owner-a" });
    expect(getWriteOwnerConflicts(FILE)).toBe(1);
    expect(getActiveWriteOwner(FILE)?.owner).toBe("owner-a");
  });

  it("treats a same-owner re-claim as idempotent (reentrant), not a conflict", () => {
    const first = claimWriteOwner(FILE, "owner-a", 100);
    const again = claimWriteOwner(FILE, "owner-a", 101);
    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) expect(again.reentrant).toBe(true);
    expect(getWriteOwnerConflicts(FILE)).toBe(0);
  });

  it("releases only on the matching token and clears the owner for recovery", () => {
    const claim = claimWriteOwner(FILE, "owner-a", 100);
    if (!claim.ok) throw new Error("expected claim");
    expect(releaseWriteOwner(FILE, "wrong-token")).toBe(false);
    expect(getActiveWriteOwner(FILE)?.owner).toBe("owner-a");
    expect(releaseWriteOwner(FILE, claim.token)).toBe(true);
    expect(getActiveWriteOwner(FILE)).toBeUndefined();
    // After release another owner can claim (conflict recovered).
    expect(claimWriteOwner(FILE, "owner-b").ok).toBe(true);
  });

  it("serializes concurrent same-file writes under a single owner and releases on completion", async () => {
    const order: string[] = [];
    const run = (id: string, delayMs: number) =>
      withVerifiedWriteOwner(FILE, "owner-a", async () => {
        order.push(`${id}:start`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(`${id}:end`);
      });
    await Promise.all([run("w1", 30), run("w2", 1)]);
    // Same-file writes never interleave: start,end,start,end.
    expect(order).toEqual(["w1:start", "w1:end", "w2:start", "w2:end"]);
    expect(getActiveWriteOwner(FILE)).toBeUndefined();
  });

  it("rolls back the owner claim when the write throws", async () => {
    await expect(
      withVerifiedWriteOwner(FILE, "owner-a", async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
    expect(getActiveWriteOwner(FILE)).toBeUndefined();
  });
});