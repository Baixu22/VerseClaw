import { describe, expect, it } from "vitest";
import { resolveSessionWorkspaceDir } from "./spawned-context.js";

describe("resolveSessionWorkspaceDir", () => {
  it("prioritizes spawned, request, then persisted workspace", () => {
    expect(
      resolveSessionWorkspaceDir({
        spawnedWorkspaceDir: "C:/spawned",
        requestWorkspaceDir: "C:/request",
        persistedWorkspaceDir: "C:/persisted",
      }),
    ).toBe("C:/spawned");
    expect(
      resolveSessionWorkspaceDir({
        requestWorkspaceDir: "C:/request",
        persistedWorkspaceDir: "C:/persisted",
      }),
    ).toBe("C:/request");
    expect(resolveSessionWorkspaceDir({ persistedWorkspaceDir: "C:/persisted" })).toBe(
      "C:/persisted",
    );
  });

  it("ignores empty and whitespace-only workspace values", () => {
    expect(
      resolveSessionWorkspaceDir({
        spawnedWorkspaceDir: "  ",
        requestWorkspaceDir: "",
        persistedWorkspaceDir: "C:/persisted",
      }),
    ).toBe("C:/persisted");
    expect(
      resolveSessionWorkspaceDir({
        spawnedWorkspaceDir: " ",
        requestWorkspaceDir: "\t",
        persistedWorkspaceDir: null,
      }),
    ).toBeUndefined();
  });
});
