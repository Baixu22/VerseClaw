// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from 'node:child_process';
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
import { createExecutionTaskAccess } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

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

    expect(checks).toBe(3);
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

// 子进程持有真实 SQLite 写锁，收到父进程的 SQLITE_BUSY 证明后才改变专用检出。
const lockOwnerScript = `
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const input=JSON.parse(process.env.TASK_TX_LOCK_FIXTURE),db=new DatabaseSync(input.database);
const events=[];let changed=false;
const event=(phase,extra={})=>events.push({phase,pid:process.pid,at:Date.now(),transaction:db.isTransaction,...extra});
const git=(...args)=>execFileSync('git',['-c','core.hooksPath=NUL',...args],{cwd:input.repository,stdio:'pipe',windowsHide:true});
try {
 db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');event('lock-held');
 writeFileSync(input.ready,JSON.stringify({pid:process.pid,transaction:db.isTransaction}));
 const wait=new Int32Array(new SharedArrayBuffer(4)),deadline=Date.now()+15000;
 while(!existsSync(input.proceed)){if(Date.now()>deadline)throw Error('parent did not prove lock contention');Atomics.wait(wait,0,0,10);}
 const proof=JSON.parse(readFileSync(input.proceed,'utf8'));event('parent-busy-proved',proof);
 if(!proof.sqliteBusy||!db.isTransaction)throw Error('real SQLite writer lock was not held');
 if(input.mode!=='unchanged'){git('worktree','remove','--',input.checkout);changed=true;event('checkout-removed');}
 if(input.mode==='replaced'){git('clone','--no-hardlinks',input.repository,input.checkout);event('checkout-replaced');}
 db.exec('COMMIT');event('own-lock-released');
}catch(error){event('error',{error:String(error)});if(db.isTransaction)db.exec('ROLLBACK');process.exitCode=1;}
finally{writeFileSync(input.result,JSON.stringify({driven_by:'agent',pid:process.pid,mode:input.mode,changed,events,transaction:db.isTransaction}));db.close();}
`;

for (const mode of ['unchanged', 'removed', 'replaced'] as const) {
  it(`rechecks real authority after another process releases SQLite (${mode})`, async () => {
    const root = tempRoot(), repository = join(root, 'repository'), checkout = join(root, 'checkout');
    const ready = join(root, 'lock-ready.json'), proceed = join(root, 'parent-busy.json'), resultFile = join(root, 'lock-result.json');
    const oldExecutionState = process.env.CLAWX_EXECUTION_STATE_PATH;
    process.env.CLAWX_EXECUTION_STATE_PATH = join(root, 'execution.sqlite');
    let store: TaskSystemStore | undefined, current: TaskSystemStore | undefined;
    let child: ReturnType<typeof spawn> | undefined, ended: Promise<number | null> | undefined;
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=NUL', ...args], { cwd: repository, windowsHide: true, stdio: 'pipe' });
    const evidence: Record<string, unknown> = { driven_by: 'agent', mode, parentPid: process.pid, status: 'running' };
    try {
      mkdirSync(repository); git('init', '-b', 'fixture');
      git('-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture');
      git('worktree', 'add', '--detach', checkout, 'HEAD');
      const domain = resolveTaskDomain(repository), seed = new TaskSystemStore(domain);
      let taskId: string;
      try { taskId = seed.create(contract('artifact.txt', 'a'.repeat(64)), 'seed').task.contract.taskNodeId; } finally { seed.close(); }
      const access = createExecutionTaskAccess(checkout);
      store = new TaskSystemStore(access.domain, undefined, access);
      const exec = store.db.exec.bind(store.db); let busyProved = false;
      store.db.exec = (sql: string) => {
        if (sql === 'BEGIN IMMEDIATE' && !busyProved) {
          // 使用真实 SQLite 拒锁证明；随后原 BEGIN 在正常 busy_timeout 下等待。
          exec('PRAGMA busy_timeout=0');
          let lockError: unknown;
          try { exec(sql); } catch (error) { lockError = error; }
          finally { exec('PRAGMA busy_timeout=3000'); }
          if (!lockError || !/locked|busy/i.test(String(lockError))) throw new Error(`Expected real SQLite contention: ${String(lockError)}`);
          busyProved = true;
          writeFileSync(proceed, JSON.stringify({ sqliteBusy: true, parentPid: process.pid, error: String(lockError) }));
        }
        return exec(sql);
      };
      child = spawn(process.execPath, ['--input-type=module', '-e', lockOwnerScript], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TASK_TX_LOCK_FIXTURE: JSON.stringify({ database: domain.database, repository, checkout, ready, proceed, result: resultFile, mode }) } });
      ended = new Promise((resolveExit, reject) => { child!.once('error', reject); child!.once('exit', resolveExit); });
      let stderr = ''; child.stderr!.on('data', chunk => { stderr += String(chunk); });
      await expect.poll(() => existsSync(ready), { timeout: 15000 }).toBe(true);
      const lock = JSON.parse(readFileSync(ready, 'utf8'));
      expect(lock).toEqual({ pid: child.pid, transaction: true }); expect(child.pid).not.toBe(process.pid);
      let rejected: unknown;
      try { store.claim(taskId, 'session-racing', 'generation-1', 'racing-claim'); } catch (error) { rejected = error; }
      expect(await ended, stderr).toBe(0); expect(busyProved).toBe(true);
      const worker = JSON.parse(readFileSync(resultFile, 'utf8'));
      evidence.worker = worker; evidence.rejected = rejected ? String(rejected) : null;
      expect(worker.events.map((entry: { phase: string }) => entry.phase)).toEqual(mode === 'unchanged'
        ? ['lock-held', 'parent-busy-proved', 'own-lock-released'] : mode === 'removed'
          ? ['lock-held', 'parent-busy-proved', 'checkout-removed', 'own-lock-released']
          : ['lock-held', 'parent-busy-proved', 'checkout-removed', 'checkout-replaced', 'own-lock-released']);
      expect(worker.transaction).toBe(false); expect(store.db.isTransaction).toBe(false);
      const currentAccess = createExecutionTaskAccess(repository);
      current = new TaskSystemStore(currentAccess.domain, undefined, currentAccess);
      if (mode === 'unchanged') {
        expect(rejected).toBeUndefined(); expect(current.get(taskId).claim?.sessionKey).toBe('session-racing');
      } else {
        expect(String(rejected)).toMatch(/TASK_AUTHORITY_STALE|ENOENT/);
        expect(current.get(taskId).claim).toBeNull(); expect(current.get(taskId).contract.state).toBe('ready');
        expect(current.db.prepare("SELECT id FROM task_requests WHERE id='claim:racing-claim'").get()).toBeUndefined();
        // 新连接可正常领取，证明失败事务没有悬挂或占用原数据库写锁。
        expect(current.claim(taskId, 'session-valid', 'generation-valid', 'valid-claim').claim?.sessionKey).toBe('session-valid');
      }
      evidence.status = 'passed';
    } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
    finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (ended) await ended.catch(() => undefined);
      try { current?.close(); store?.close(); } finally {
        closeOpenClawStateDatabaseForTest();
        if (oldExecutionState === undefined) delete process.env.CLAWX_EXECUTION_STATE_PATH; else process.env.CLAWX_EXECUTION_STATE_PATH = oldExecutionState;
      }
      const output = process.env.TASK_TX_IDENTITY_EVIDENCE_DIR;
      if (output) { mkdirSync(output, { recursive: true }); writeFileSync(join(output, `${mode}.json`), JSON.stringify(evidence, null, 2)); }
    }
  }, 30000);
}
