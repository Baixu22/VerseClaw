import { describe, expect, it, vi } from "vitest";
import type { RespondFn } from "./types.js";
import { readExplicitWorkers } from "./role-orchestration-methods.js";

function config() {
  return { roles: {} } as never;
}

describe("orchestrator explicit workers", () => {
  it("preserves an explicit empty writeSet for observer classification", () => {
    const respond = vi.fn() as unknown as RespondFn;
    const workers = readExplicitWorkers({
      workers: [{ roleName: "reviewer", task: "Read the transcript", writeSet: [] }],
    }, respond, config());
    expect(respond).not.toHaveBeenCalled();
    expect(workers?.[0]).toMatchObject({ roleName: "reviewer", writeSet: [] });
  });

  it("omits writeSet when the caller did not provide it", () => {
    const respond = vi.fn() as unknown as RespondFn;
    const workers = readExplicitWorkers({
      workers: [{ roleName: "reviewer", task: "Read the transcript" }],
    }, respond, config());
    expect(respond).not.toHaveBeenCalled();
    expect(workers?.[0]).not.toHaveProperty("writeSet");
  });
});