import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchiveHandle } from "../../../../shared/types/context-family.js";
import { cleanupContextArchiveArtifacts } from "../../context-engine/registry/context-item-registry.js";
import {
  CapabilityResultPointerService,
  type CapabilityResultArchiveOwner,
} from "./result-pointer.js";

const budget = {
  maxActivePointers: 8,
  maxSummaryCharacters: 128,
  maxTtlMs: 60_000,
  maxReadCharacters: 40,
  maxSliceCharacters: 20,
  maxSearchScanCharacters: 200,
  maxSearchOutputCharacters: 100,
  maxSearchMatches: 3,
  maxQueryCharacters: 32,
} as const;

const archiveRoots: string[] = [];
const originalArchiveRoot = process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR;

afterEach(async () => {
  if (originalArchiveRoot === undefined) {
    delete process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR;
  } else {
    process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR = originalArchiveRoot;
  }
  await Promise.all(archiveRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function useTempArchiveRoot(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "capability-v3-pointer-"));
  archiveRoots.push(root);
  process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR = root;
}

function requirePointer<T>(result: { ok: true; value: T } | { ok: false; failure: { message: string } }): T {
  if (!result.ok) {
    throw new Error(result.failure.message);
  }
  return result.value;
}

function fakeArchiveHandle(checksumCharacter: string): ArchiveHandle {
  return {
    uri: "context-archive://session-a/result.context-archive.json",
    checksum: `sha256:${checksumCharacter.repeat(64)}` as ArchiveHandle["checksum"],
    byteLength: 10,
    source: { type: "tool_call", sessionId: "session-a" },
  };
}

describe("Capability Registry V3 Result Pointer", () => {
  it("is inert while disabled and does not call the archive owner", async () => {
    const create = vi.fn<CapabilityResultArchiveOwner["create"]>(async () => {
      throw new Error("disabled pointer must not create an archive");
    });
    const verify = vi.fn<CapabilityResultArchiveOwner["verify"]>(async () => {
      throw new Error("disabled pointer must not verify an archive");
    });
    const archiveOwner = { create, verify } satisfies CapabilityResultArchiveOwner;
    const service = new CapabilityResultPointerService({
      enabled: false,
      archiveOwner,
      budget,
    });

    expect(
      await service.create({
        sessionId: "session-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "result",
        result: "raw",
        ttlMs: 1_000,
      }),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "pointer-disabled" }),
    });
    expect(create).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("uses the existing context archive owner and exposes only bounded pointer metadata", async () => {
    await useTempArchiveRoot();
    const service = new CapabilityResultPointerService({
      enabled: true,
      budget,
      now: () => Date.parse("2026-08-14T00:00:00.000Z"),
    });
    const raw = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    const pointer = requirePointer(
      await service.create({
        sessionId: "session-a",
        taskId: "task-a",
        capabilityId: "tool:fixture:workspace-read",
        toolCallId: "call-a",
        summary: "Workspace read result archived.",
        result: raw,
        ttlMs: 10_000,
        permissions: ["workspace.read"],
      }),
    );

    expect(pointer.pointerId).toMatch(/^resultptr_[a-f0-9]{64}$/);
    expect(pointer.archiveHandle.uri).toMatch(/^context-archive:\/\/session-a\//);
    expect(pointer.archiveHandle.checksum).toMatch(/^sha256:/);
    expect(JSON.stringify(pointer)).not.toContain(raw);

    const read = requirePointer(
      await service.read({
        pointer,
        sessionId: "session-a",
        taskId: "task-a",
        grantedPermissions: ["workspace.read"],
      }),
    );
    expect(read.text).toBe(raw.slice(0, budget.maxReadCharacters));
    expect(read.truncated).toBe(true);
    expect(read.nextOffset).toBe(budget.maxReadCharacters);

    const slice = requirePointer(
      await service.slice({
        pointer,
        sessionId: "session-a",
        taskId: "task-a",
        grantedPermissions: ["workspace.read"],
        offset: 6,
        length: 100,
      }),
    );
    expect(slice.text).toBe(raw.slice(6, 6 + budget.maxSliceCharacters));
    expect(slice.returnedCharacters).toBeLessThanOrEqual(budget.maxSliceCharacters);

    const search = requirePointer(
      await service.search({
        pointer,
        sessionId: "session-a",
        taskId: "task-a",
        grantedPermissions: ["workspace.read"],
        query: "gamma",
      }),
    );
    expect(search.matches).toEqual([
      expect.objectContaining({ index: raw.indexOf("gamma"), excerpt: expect.stringContaining("gamma") }),
    ]);
    expect(search.scannedCharacters).toBeLessThanOrEqual(budget.maxSearchScanCharacters);
    expect(search.outputCharacterCount).toBeLessThanOrEqual(budget.maxSearchOutputCharacters);
  });

  it("reports a real hard-deleted archive as missing", async () => {
    await useTempArchiveRoot();
    const service = new CapabilityResultPointerService({
      enabled: true,
      budget,
      now: () => 1_000,
    });
    const pointer = requirePointer(
      await service.create({
        sessionId: "session-cleanup",
        capabilityId: "tool:fixture:workspace-read",
        summary: "result",
        result: "payload to delete",
        ttlMs: 1_000,
      }),
    );

    await cleanupContextArchiveArtifacts({ sessionIds: ["session-cleanup"] });
    expect(await service.read({ pointer, sessionId: "session-cleanup" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "archive-missing" }),
    });
  });

  it("checks scope, expiry, and permissions before archive access", async () => {
    let now = 1_000;
    const handle = fakeArchiveHandle("a");
    const create = vi.fn<CapabilityResultArchiveOwner["create"]>(async () => handle);
    const verify = vi.fn<CapabilityResultArchiveOwner["verify"]>(async () => ({
      ok: true,
      payload: "0123456789",
    }));
    const archiveOwner = { create, verify } satisfies CapabilityResultArchiveOwner;
    const service = new CapabilityResultPointerService({
      enabled: true,
      archiveOwner,
      budget,
      now: () => now,
    });
    const pointer = requirePointer(
      await service.create({
        sessionId: "session-a",
        taskId: "task-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "result",
        result: "0123456789",
        ttlMs: 1_000,
        permissions: ["workspace.read"],
      }),
    );

    for (const [expectedCode, params] of [
      ["session-mismatch", { sessionId: "session-b", taskId: "task-a", grantedPermissions: ["workspace.read"] }],
      ["task-mismatch", { sessionId: "session-a", taskId: "task-b", grantedPermissions: ["workspace.read"] }],
      ["permission-denied", { sessionId: "session-a", taskId: "task-a", grantedPermissions: [] }],
    ] as const) {
      expect(await service.read({ pointer, ...params })).toEqual({
        ok: false,
        failure: expect.objectContaining({ code: expectedCode }),
      });
    }
    expect(verify).not.toHaveBeenCalled();

    now = 2_001;
    expect(
      await service.read({
        pointer,
        sessionId: "session-a",
        taskId: "task-a",
        grantedPermissions: ["workspace.read"],
      }),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "pointer-expired" }),
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails read, slice, and search at the exact expiry boundary before archive access", async () => {
    let now = 1_000;
    const handle = fakeArchiveHandle("e");
    const create = vi.fn<CapabilityResultArchiveOwner["create"]>(async () => handle);
    const verify = vi.fn<CapabilityResultArchiveOwner["verify"]>(async () => ({
      ok: true,
      payload: "0123456789",
    }));
    const service = new CapabilityResultPointerService({
      enabled: true,
      archiveOwner: { create, verify },
      budget,
      now: () => now,
    });
    const pointers = await Promise.all(
      ["read", "slice", "search"].map(async (operation) =>
        requirePointer(
          await service.create({
            sessionId: "session-a",
            capabilityId: "tool:fixture:workspace-read",
            summary: `${operation} result`,
            result: "0123456789",
            ttlMs: 1_000,
          }),
        ),
      ),
    );
    now = 2_000;

    await expect(service.read({ pointer: pointers[0], sessionId: "session-a" })).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "pointer-expired" }),
    });
    await expect(
      service.slice({ pointer: pointers[1], sessionId: "session-a", offset: 0, length: 1 }),
    ).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "pointer-expired" }),
    });
    await expect(
      service.search({ pointer: pointers[2], sessionId: "session-a", query: "0" }),
    ).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "pointer-expired" }),
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it("accepts only runtime-issued pointers and bounds active pointer state", async () => {
    const handle = fakeArchiveHandle("d");
    const create = vi.fn<CapabilityResultArchiveOwner["create"]>(async () => handle);
    const verify = vi.fn<CapabilityResultArchiveOwner["verify"]>(async () => ({
      ok: true,
      payload: "0123456789",
    }));
    const archiveOwner = { create, verify } satisfies CapabilityResultArchiveOwner;
    const origin = new CapabilityResultPointerService({
      enabled: true,
      archiveOwner,
      budget: { ...budget, maxActivePointers: 1 },
      now: () => 1_000,
    });
    const pointer = requirePointer(
      await origin.create({
        sessionId: "session-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "result",
        result: "0123456789",
        ttlMs: 1_000,
      }),
    );
    const otherRuntime = new CapabilityResultPointerService({
      enabled: true,
      archiveOwner,
      budget,
      now: () => 1_000,
    });

    expect(await otherRuntime.read({ pointer, sessionId: "session-a" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "pointer-not-issued" }),
    });
    expect(verify).not.toHaveBeenCalled();
    expect(
      await origin.create({
        sessionId: "session-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "second result",
        result: "0123456789",
        ttlMs: 1_000,
      }),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "pointer-capacity-exhausted" }),
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["checksum_mismatch", "archive-checksum-mismatch"],
    ["missing", "archive-missing"],
    ["invalid_uri", "archive-invalid"],
    ["read_error", "archive-read-failed"],
  ] as const)("fails closed for archive verification result %s", async (reason, expectedCode) => {
    const handle = fakeArchiveHandle("b");
    const create = vi.fn<CapabilityResultArchiveOwner["create"]>(async () => handle);
    const verify = vi.fn<CapabilityResultArchiveOwner["verify"]>(async () => ({ ok: false, reason }));
    const archiveOwner = { create, verify } satisfies CapabilityResultArchiveOwner;
    const service = new CapabilityResultPointerService({
      enabled: true,
      archiveOwner,
      budget,
      now: () => 1_000,
    });
    const pointer = requirePointer(
      await service.create({
        sessionId: "session-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "result",
        result: "0123456789",
        ttlMs: 1_000,
      }),
    );

    expect(await service.read({ pointer, sessionId: "session-a" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: expectedCode }),
    });
  });

  it("rejects oversized summaries, TTLs, invalid slices, and forged pointer metadata", async () => {
    const handle = fakeArchiveHandle("c");
    const create = vi.fn<CapabilityResultArchiveOwner["create"]>(async () => handle);
    const verify = vi.fn<CapabilityResultArchiveOwner["verify"]>(async () => ({
      ok: true,
      payload: "0123456789",
    }));
    const service = new CapabilityResultPointerService({
      enabled: true,
      archiveOwner: { create, verify },
      budget,
      now: () => 1_000,
    });

    expect(
      await service.create({
        sessionId: "session-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "x".repeat(budget.maxSummaryCharacters + 1),
        result: "raw",
        ttlMs: 1_000,
      }),
    ).toEqual({ ok: false, failure: expect.objectContaining({ code: "invalid-summary" }) });
    expect(
      await service.create({
        sessionId: "session-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "result",
        result: "raw",
        ttlMs: budget.maxTtlMs + 1,
      }),
    ).toEqual({ ok: false, failure: expect.objectContaining({ code: "invalid-ttl" }) });

    const pointer = requirePointer(
      await service.create({
        sessionId: "session-a",
        capabilityId: "tool:fixture:workspace-read",
        summary: "result",
        result: "0123456789",
        ttlMs: 1_000,
      }),
    );
    expect(
      await service.slice({ pointer, sessionId: "session-a", offset: -1, length: 1 }),
    ).toEqual({ ok: false, failure: expect.objectContaining({ code: "invalid-slice" }) });
    expect(
      await service.read({ pointer: { ...pointer, summary: "forged" }, sessionId: "session-a" }),
    ).toEqual({ ok: false, failure: expect.objectContaining({ code: "pointer-mismatch" }) });
  });
});
