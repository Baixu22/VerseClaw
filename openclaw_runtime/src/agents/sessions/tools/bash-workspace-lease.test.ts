/**
 * Proves the production bash exec path acquires the workspace `workspaceExec`
 * lease before spawning a shell (issue #167).
 *
 * The test holds both shared slots for the current workspace, so `exec` must
 * stay queued instead of starting a process; once the slots free it settles
 * (running the command, or failing only because this host has no shell).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeWorkspaceLeaseKey,
  resetResourceLeasesForTest,
  withWorkspaceResourceLease,
} from "../../resource-leases.js";
import { createLocalBashOperations } from "./bash.js";

afterEach(() => {
  resetResourceLeasesForTest();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("bash workspaceExec admission", () => {
  it('settles cancellation while both slots remain held and never starts the shell', async () => {
    const cwd = process.cwd(), key = normalizeWorkspaceLeaseKey(cwd);
    const gate = deferred();
    const held = [
      withWorkspaceResourceLease('workspaceExec', key, () => gate.promise),
      withWorkspaceResourceLease('workspaceExec', key, () => gate.promise),
    ];
    await flush();
    const controller = new AbortController();
    let output = '';
    const queued = createLocalBashOperations().exec('echo unexpected-effect', cwd,
      { signal: controller.signal, onData: data => { output += data.toString(); } }).then(() => 'executed', () => 'aborted');
    controller.abort();
    const outcome = await Promise.race([queued, new Promise(resolve => setTimeout(() => resolve('still-waiting'), 25))]);
    gate.resolve();
    await Promise.all([...held, queued]);
    expect(outcome).toBe('aborted');
    expect(output).toBe('');
  });

  it("queues behind the workspace budget before spawning the shell", async () => {
    const cwd = process.cwd();
    const key = normalizeWorkspaceLeaseKey(cwd);
    const gate = deferred();
    const held = [
      withWorkspaceResourceLease("workspaceExec", key, () => gate.promise),
      withWorkspaceResourceLease("workspaceExec", key, () => gate.promise),
    ];
    await flush();

    let settled = false;
    const execPromise = createLocalBashOperations()
      .exec("echo workspace-lease-ok", cwd, { onData: () => {} })
      .finally(() => {
        settled = true;
      })
      .catch((error: unknown) => error);

    await flush();
    expect(settled).toBe(false);

    gate.resolve();
    await Promise.all(held);
    const outcome = await execPromise;
    expect(settled).toBe(true);
    // Either the echo ran ({ exitCode: 0 }) or this host lacks a shell; both
    // prove the call passed the workspace lease gate.
    expect(outcome).toBeDefined();
  });
});
