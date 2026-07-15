import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  __resetWorkspaceFactServiceRegistry,
  invalidateWorkspaceFactService,
  invalidateWorkspaceFactServiceByFingerprint,
  resolveWorkspaceFactService,
  workspaceFactServiceRegistrySize,
} from "./workspace-fact-service.js";
import { closeAllFactStores } from "./store.js";
import { computeWorkspaceFingerprint } from "../workspace-fingerprint.js";

describe("WorkspaceFactService (C0-3)", () => {
  let rootA: string;
  let rootB: string;

  beforeEach(() => {
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    rootA = mkdtempSync(path.join(tmpdir(), "wfs-a-"));
    rootB = mkdtempSync(path.join(tmpdir(), "wfs-b-"));
  });

  afterEach(() => {
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  it("returns the same instance for the same workspace", () => {
    const first = resolveWorkspaceFactService(rootA);
    const second = resolveWorkspaceFactService(rootA);
    expect(second).toBe(first);
    expect(second.store).toBe(first.store);
    expect(second.materializer).toBe(first.materializer);
    expect(workspaceFactServiceRegistrySize()).toBe(1);
    expect(first.fingerprint).toBe(computeWorkspaceFingerprint(rootA));
  });

  it("returns different instances for different workspaces", () => {
    const a = resolveWorkspaceFactService(rootA);
    const b = resolveWorkspaceFactService(rootB);
    expect(a).not.toBe(b);
    expect(a.store).not.toBe(b.store);
    expect(workspaceFactServiceRegistrySize()).toBe(2);
  });

  it("reconstructs after invalidate / reset", () => {
    const first = resolveWorkspaceFactService(rootA);
    expect(invalidateWorkspaceFactService(rootA)).toBe(true);
    expect(workspaceFactServiceRegistrySize()).toBe(0);
    const second = resolveWorkspaceFactService(rootA);
    expect(second).not.toBe(first);
    // openFactStore still caches by db path — store handle is shared.
    expect(second.store).toBe(first.store);
  });

  it("invalidates by fingerprint (session workspace switch)", () => {
    const service = resolveWorkspaceFactService(rootA);
    const removed = invalidateWorkspaceFactServiceByFingerprint(service.fingerprint);
    expect(removed).toBe(1);
    expect(workspaceFactServiceRegistrySize()).toBe(0);
  });

  it("shares touch queue across resolvers for the same workspace", () => {
    mkdirSync(path.join(rootA, "src"), { recursive: true });
    writeFileSync(path.join(rootA, "src", "a.ts"), "export function a() { return 1; }\n");
    const first = resolveWorkspaceFactService(rootA);
    first.materializer.onFileTouched("src/a.ts");
    const second = resolveWorkspaceFactService(rootA);
    expect(second.materializer.pendingTouchedCount()).toBe(1);
  });
});