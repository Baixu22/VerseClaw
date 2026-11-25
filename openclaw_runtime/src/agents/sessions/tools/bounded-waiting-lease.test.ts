import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeWorkspaceLeaseKey, withWorkspaceResourceLease, resetResourceLeasesForTest } from "../../resource-leases.js";
import { closeOpenClawStateDatabaseForTest } from "../../../state/openclaw-state-db.js";
import { createLocalBashOperations } from "./bash.js";
import { createFindToolDefinition } from "./find.js";
import { createGrepToolDefinition } from "./grep.js";
import { createWriteToolDefinition } from "./write.js";
import { createEditToolDefinition } from "./edit.js";
import type { ExtensionContext } from "../extensions/types.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn(), ensure: vi.fn(async () => "tool-fixture") }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn: mocks.spawn }));
vi.mock("../../shell-utils.js", () => ({ getBashShellConfig: () => ({ shell: "fixture", args: [] }), getShellEnv: () => ({}), killProcessTree: mocks.kill }));
vi.mock("../../utils/tools-manager.js", () => ({ ensureTool: mocks.ensure }));
vi.mock("../../utils/child-process.js", () => ({ waitForChildProcess: (child: EventEmitter) => new Promise(resolve => child.once("close", resolve)) }));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const cwd = process.cwd();
const key = normalizeWorkspaceLeaseKey(cwd);
function child() {
  return Object.assign(new EventEmitter(), { pid: 123, killed: false, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); vi.clearAllMocks(); mocks.ensure.mockResolvedValue("tool-fixture"); });
afterEach(() => { resetResourceLeasesForTest(); closeOpenClawStateDatabaseForTest(); vi.useRealTimers(); });
async function hold(kind: "workspaceExec" | "workspaceSearch" | "fileMutation", leaseKey = key) {
  const gate = deferred();
  const runs = Array.from({ length: kind === "fileMutation" ? 1 : 2 }, () => withWorkspaceResourceLease(kind, leaseKey, () => gate.promise));
  await flush(); return { release: async () => { gate.resolve(); await Promise.all(runs); } };
}

describe("direct resource wait consumers", () => {
  it.each(["write", "edit"])("preserves %s owner-confirmed completion after cancellation", async name => {
    const c = new AbortController(); let content = "before";
    const operations = {
      access: async () => {}, mkdir: async () => {},
      statFile: async () => ({ type: 'file' as const, size: content.length, mtimeMs: 1 }),
      readFile: async () => Buffer.from(content),
      writeFile: vi.fn(async (_path: string, value: string | Buffer) => {
        content = value.toString(); c.abort(); throw new DOMException("interrupted after write", "AbortError");
      }),
    };
    const ctx = {} as ExtensionContext;
    const run = name === "write"
      ? createWriteToolDefinition(cwd, { operations }).execute("test", { path: "confirmed.txt", content: "after" }, c.signal, undefined, ctx)
      : createEditToolDefinition(cwd, { operations }).execute("test", { path: "confirmed.txt", edits: [{ oldText: "before", newText: "after" }] }, c.signal, undefined, ctx);
    await expect(run).resolves.toMatchObject({ content: [expect.objectContaining({ text: expect.stringContaining("Successfully") })] });
    expect(content).toBe("after"); expect(operations.writeFile).toHaveBeenCalledOnce();
    expect(getEventListeners(c.signal, "abort")).toHaveLength(0);
  });
  it.each(["bash", "find", "grep", "write", "edit"])("cancels %s while queued without starting the operation", async name => {
    const isMutation = name === "write" || name === "edit";
    const held = await hold(name === "bash" ? "workspaceExec" : isMutation ? "fileMutation" : "workspaceSearch",
      isMutation ? normalizeWorkspaceLeaseKey("bounded-waiting-fixture.txt") : key);
    const baselineTimers = vi.getTimerCount();
    const c = new AbortController();
    const operations = { writeFile: vi.fn(), mkdir: vi.fn(), readFile: vi.fn(), access: vi.fn() };
    const ctx = {} as ExtensionContext;
    const call = name === "bash" ? createLocalBashOperations().exec("fixture", cwd, { onData() {}, signal: c.signal })
      : name === "find" ? createFindToolDefinition(cwd).execute("test", { pattern: "*" }, c.signal, undefined, ctx)
      : name === "grep" ? createGrepToolDefinition(cwd).execute("test", { pattern: "x" }, c.signal, undefined, ctx)
      : name === "write" ? createWriteToolDefinition(cwd, { operations }).execute("test", { path: "bounded-waiting-fixture.txt", content: "x" }, c.signal, undefined, ctx)
      : createEditToolDefinition(cwd, { operations }).execute("test", { path: "bounded-waiting-fixture.txt", edits: [{ oldText: "x", newText: "y" }] }, c.signal, undefined, ctx);
    const result = call.catch(e => e);
    c.abort(); await flush();
    expect(await result).toBeInstanceOf(Error);
    expect(getEventListeners(c.signal, "abort")).toHaveLength(0);
    await held.release();
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.ensure).not.toHaveBeenCalled();
    expect(operations.writeFile).not.toHaveBeenCalled(); expect(operations.readFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(baselineTimers);
  });
  it("uses remaining bash time and retains the lease until observed child close", async () => {
    const held = await hold("workspaceExec"); const proc = child(); mocks.spawn.mockReturnValue(proc);
    let settled = false;
    const run = createLocalBashOperations().exec("fixture", cwd, { onData() {}, timeout: 0.1 }).finally(() => { settled = true; }).catch(e => e);
    await vi.advanceTimersByTimeAsync(40); await held.release(); await flush();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59); expect(mocks.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.kill).toHaveBeenCalledOnce(); expect(settled).toBe(false);
    proc.emit("close", 0); expect(await run).toBeInstanceOf(Error); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["find", "grep"])("keeps running %s ownership through cancellation until close", async name => {
    const proc = child(); mocks.spawn.mockReturnValue(proc); const c = new AbortController();
    const tool = name === "find" ? createFindToolDefinition(cwd) : createGrepToolDefinition(cwd);
    let settled = false;
    const run = tool.execute("test", { pattern: "x" }, c.signal, undefined, {} as ExtensionContext)
      .finally(() => { settled = true; }).catch(e => e);
    await flush(); expect(mocks.spawn).toHaveBeenCalledOnce(); c.abort(); await flush();
    expect(proc.kill).toHaveBeenCalledOnce(); expect(settled).toBe(false);
    proc.emit("error", new Error("kill outcome unknown")); await flush(); expect(settled).toBe(false);
    proc.emit("close", null); expect(await run).toBeInstanceOf(Error);
    expect(getEventListeners(c.signal, "abort")).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not spawn grep after cancellation during asynchronous preparation", async () => {
    const gate = deferred(); mocks.ensure.mockImplementationOnce(async () => { await gate.promise; return "tool-fixture"; });
    const c = new AbortController();
    const run = createGrepToolDefinition(cwd).execute("test", { pattern: "x" }, c.signal, undefined, {} as ExtensionContext).catch(e => e);
    await flush(); c.abort(); gate.resolve(); await run;
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
