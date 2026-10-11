// @vitest-environment node
// Guards the PID-reuse boundary of process-tree capture: a same-tick child
// (equal token) must be captured, but a stale child whose token predates the
// parent (PID reuse) must never be attributed to the tree.

import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ readdir: [] as Array<{ name: string; isDirectory: () => boolean }>, stats: new Map<string, string>() }));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    default: {
      ...actual,
      readdirSync: () => hoisted.readdir,
      readFileSync: (p: string) => {
        const value = hoisted.stats.get(String(p));
        if (value === undefined) throw new Error("ENOENT " + p);
        return value;
      },
    },
  };
});

function procRow(pid: number, parentPid: number, token: number, state = "S"): { name: string; isDirectory: () => boolean } {
  // After "comm", the field list starts at state: [0]=state, [1]=ppid,
  // [2..18]=filler, [19]=starttime(token).
  const filler = Array.from({ length: 17 }, () => "0").join(" ");
  hoisted.stats.set(`/proc/${pid}/stat`, `${pid} (node) ${state} ${parentPid} ${filler} ${token} 0`);
  return { name: String(pid), isDirectory: () => true };
}

const originalPlatform = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
});

describe("os-containment process tree capture", () => {
  it("captures a same-tick child but excludes a stale PID-reuse child", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    hoisted.readdir = [procRow(100, 1, 5000), procRow(101, 100, 5000), procRow(102, 100, 4999)];
    const { captureProcessTrees } = await import("./os-containment.js");
    const capture = await captureProcessTrees([100]);
    expect(capture.status).toBe("ok");
    expect(capture.capturedPids.has(100)).toBe(true);
    expect(capture.capturedPids.has(101)).toBe(true);
    expect(capture.capturedPids.has(102)).toBe(false);
  });
});
