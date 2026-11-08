// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalPath,
  resolveTaskDomain,
  type TaskAuthorityAccess,
  type TaskDomain,
} from "../../shared/task-system/identity";
import { TaskSystemStore } from "../../shared/task-system/store";
import type { TaskContractInput } from "../../shared/task-system/types";

const roots: string[] = [];
const stores: TaskSystemStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0).toReversed()) store.close();
  for (const root of roots.splice(0).toReversed()) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "task-authority-access-"));
  roots.push(root);
  return root;
}

function openStore(domain: TaskDomain, access?: TaskAuthorityAccess): TaskSystemStore {
  const store = new TaskSystemStore(domain, () => 1_000_000, access);
  stores.push(store);
  return store;
}

function contract(path: string, sha256: string): TaskContractInput {
  return {
    objective: "Write through the current task authority",
    target: path,
    constraints: [],
    acceptance: [
      {
        id: "artifact",
        description: "Read the artifact from the execution checkout",
        verification: { kind: "file-sha256", path, sha256 },
      },
    ],
  };
}

describe("TaskSystemStore authority access", () => {
  it("rejects stale authority on construction, reads, and writes without changing the ledger", () => {
    const root = tempRoot();
    const domain = resolveTaskDomain(root);
    let current = true;
    let checks = 0;
    const access: TaskAuthorityAccess = {
      domain,
      assertCurrent() {
        checks++;
        if (!current) throw new Error("TASK_AUTHORITY_STALE");
      },
      resolveRelated(workspaceRoot) {
        return resolveTaskDomain(workspaceRoot);
      },
    };
    const store = openStore(domain, access);
    const created = store.create(contract("artifact.txt", "a".repeat(64)), "create");

    expect(checks).toBe(2);
    const beforeRead = checks;
    expect(store.list()).toHaveLength(1);
    expect(checks).toBe(beforeRead + 1);

    current = false;
    expect(() => store.get(created.task.contract.taskNodeId)).toThrow("TASK_AUTHORITY_STALE");
    expect(() =>
      store.create(contract("other.txt", "b".repeat(64)), "stale-write"),
    ).toThrow("TASK_AUTHORITY_STALE");
    current = true;
    expect(store.list()).toHaveLength(1);

    const staleRoot = tempRoot();
    const staleDomain = resolveTaskDomain(staleRoot);
    expect(
      () =>
        new TaskSystemStore(staleDomain, undefined, {
          domain: staleDomain,
          assertCurrent() {
            throw new Error("TASK_AUTHORITY_STALE");
          },
          resolveRelated: resolveTaskDomain,
        }),
    ).toThrow("TASK_AUTHORITY_STALE");
    expect(existsSync(staleDomain.database)).toBe(false);
  });

  it("rejects an access domain mismatch before opening the database", () => {
    const root = tempRoot();
    const domain = resolveTaskDomain(root);
    let checked = false;
    expect(
      () =>
        new TaskSystemStore(domain, () => 1_000_000, {
          domain: { ...domain, id: "another-authority" },
          assertCurrent() {
            checked = true;
          },
          resolveRelated: resolveTaskDomain,
        }),
    ).toThrow("TASK_AUTHORITY_DOMAIN_MISMATCH");
    expect(checked).toBe(false);
    expect(existsSync(domain.database)).toBe(false);
  });

  it("rejects an execution worktree mismatch before opening the database", () => {
    const root = tempRoot();
    const checkout = join(root, "checkout");
    mkdirSync(checkout);
    const domain = resolveTaskDomain(root);
    let checked = false;
    expect(
      () =>
        new TaskSystemStore(domain, undefined, {
          domain: { ...domain, worktree: canonicalPath(checkout) },
          assertCurrent() {
            checked = true;
          },
          resolveRelated: resolveTaskDomain,
        }),
    ).toThrow("TASK_AUTHORITY_DOMAIN_MISMATCH");
    expect(checked).toBe(false);
    expect(existsSync(domain.database)).toBe(false);
  });

  it("rejects other authorities and allows one authority across physical checkouts", () => {
    const root = tempRoot();
    const authorityRoot = join(root, "authority");
    const checkoutA = join(root, "checkout-a");
    const checkoutB = join(root, "checkout-b");
    const foreignRoot = join(root, "foreign");
    for (const directory of [authorityRoot, checkoutA, checkoutB, foreignRoot])
      mkdirSync(directory, { recursive: true });

    const authority = resolveTaskDomain(authorityRoot);
    const domainA = { ...authority, worktree: canonicalPath(checkoutA) };
    const domainB = { ...authority, worktree: canonicalPath(checkoutB) };
    const accessFor = (domain: TaskDomain): TaskAuthorityAccess => ({
      domain,
      assertCurrent() {},
      resolveRelated(workspaceRoot) {
        const target = canonicalPath(workspaceRoot);
        if (target === domainA.worktree) return domainA;
        if (target === domainB.worktree) return domainB;
        return resolveTaskDomain(target);
      },
    });
    const storeA = openStore(domainA, accessFor(domainA));
    const artifactB = "checkout-b artifact";
    const artifactSha = createHash("sha256").update(artifactB).digest("hex");
    const task = storeA.create(contract("artifact.txt", artifactSha), "shared").task;
    const claimA = storeA.claim(task.contract.taskNodeId, "session-a", "generation-a", "claim").claim!;

    expect(domainA.id).toBe(domainB.id);
    expect(domainA.database).toBe(domainB.database);
    expect(() =>
      storeA.prepareWriterDelegation(claimA, {
        delegationId: "foreign-writer",
        childSessionKey: "foreign-child",
        childGeneration: "foreign-generation",
        childWorktree: foreignRoot,
        childRunId: "foreign-run",
        mode: "writer",
      }),
    ).toThrow("TASK_DELEGATION_DOMAIN_MISMATCH");
    expect(() => storeA.handoff(claimA, "foreign", "foreign", foreignRoot)).toThrow(
      "TASK_HANDOFF_DOMAIN_MISMATCH",
    );

    const handedOff = storeA.handoff(claimA, "session-b", "generation-b", checkoutB);
    expect(handedOff.claim?.worktree).toBe(domainB.worktree);
    expect(() => storeA.assertOwner(handedOff.claim!)).toThrow("TASK_STALE_OWNER");

    writeFileSync(join(checkoutA, "artifact.txt"), "wrong checkout artifact");
    writeFileSync(join(checkoutB, "artifact.txt"), artifactB);
    const storeB = openStore(domainB, accessFor(domainB));
    const claimB = storeB.get(task.contract.taskNodeId).claim!;
    const artifactPath = canonicalPath(join(checkoutB, "artifact.txt"));
    expect(storeB.candidateArtifacts(claimB)).toEqual([
      { path: artifactPath, sha256: artifactSha },
    ]);
    expect(
      storeB.verifyFile(claimB, "artifact", "artifact.txt", artifactSha, "candidate"),
    ).toMatchObject({ path: artifactPath, sha256: artifactSha });
  });
});
