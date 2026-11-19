// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import { TaskSystemStore } from "../../shared/task-system/store";
import {
  createTaskRuntimeGuard,
  executeTaskGuarded,
  readPersistentTaskContext,
  restoreTaskModelContext,
  finishPersistentTaskRun,
} from "../../shared/task-system/runtime";
import { createSessionsYieldTool } from "../../openclaw_runtime/src/agents/tools/sessions-yield-tool";
import { createReadTool, type ReadToolDetails } from '../../openclaw_runtime/src/agents/sessions/tools/read';
import { wrapReviewerReadConfirmation } from '../../openclaw_runtime/src/agents/execution-task-guard';
import { createAssistantMessageEventStream } from '../../openclaw_runtime/src/llm/utils/event-stream';
import type { AssistantMessage } from '../../openclaw_runtime/src/llm/types';
import { truncateToolResultMessage } from '../../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation';

describe("production task runtime guard", () => {
  it('credits read coverage only after an untruncated provider request returns successfully', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-visible-'));
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      writeFileSync(join(root, 'result.txt'), 'a'.repeat(40_000));
      const task = store.start({ contract: { objective: 'Review full file', target: 'result.txt', constraints: [], maxRepairAttempts: 0,
        acceptance: [{ id: 'review', description: 'Read', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files: ['result.txt'] } }],
      } }, 'parent', 'parent-g', 'start');
      store.submit(task.claim!, 'candidate');
      const delegation = store.prepareWriterDelegation(task.claim!, { delegationId: 'review-run', childSessionKey: 'reviewer', childGeneration: 'review-g',
        childRunId: 'review-run', childWorktree: root, mode: 'observer', verifier: true });
      const guard = createTaskRuntimeGuard(root, 'reviewer', 'review-g');
      const tool = createReadTool(root);
      const result = await executeTaskGuarded(guard, 'read-call', 'read', () => tool.execute('read-call', { path: 'result.txt' }), { path: 'result.txt' });
      const message = { role: 'toolResult' as const, toolCallId: 'read-call', toolName: 'read', content: result.content, isError: false, timestamp: Date.now() };
      const success = { role: 'assistant', content: [], stopReason: 'stop' } as unknown as AssistantMessage;
      const streamFn: Parameters<typeof wrapReviewerReadConfirmation>[0] = async (model, context, options) => {
        await options?.onPayload?.({ messages: context.messages }, model);
        const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: success }); stream.end(success); return stream;
      };
      const wrapped = wrapReviewerReadConfirmation(streamFn, guard);
      await (await wrapped({} as never, { messages: [truncateToolResultMessage(message, 32_000) as never] }, {})).result();
      expect(() => store.assertReviewerReadCandidate(delegation)).toThrow('TASK_VERIFIER_READ_REQUIRED');
      for (let offset = 0; offset < 40_000; offset += 8000) {
        const id = `chars-${offset}`;
        const page = await executeTaskGuarded(guard, id, 'read', () => tool.execute(id, { path: 'result.txt', charOffset: offset, charLimit: 8000 }),
          { path: 'result.txt', charOffset: offset, charLimit: 8000 });
        const visible = { ...message, toolCallId: id, content: page.content };
        await (await wrapped({} as never, { messages: [truncateToolResultMessage(visible, 32_000) as never] }, {})).result();
      }
      expect(() => store.assertReviewerReadCandidate(delegation)).not.toThrow();
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['base64', 'binary'])('credits a delivered %s image and rejects an image removed by provider serialization', async encoding => {
    const root = mkdtempSync(join(tmpdir(), 'review-image-'));
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      writeFileSync(join(root, 'result.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1cAAAAASUVORK5CYII=', 'base64'));
      const task = store.start({ contract: { objective: 'Review image', target: 'result.png', constraints: [], maxRepairAttempts: 0,
        acceptance: [{ id: 'review', description: 'See image', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files: ['result.png'] } }],
      } }, 'parent', 'parent-g', 'start');
      store.submit(task.claim!, 'candidate');
      const delegation = store.prepareWriterDelegation(task.claim!, { delegationId: 'review-run', childSessionKey: 'reviewer', childGeneration: 'review-g',
        childRunId: 'review-run', childWorktree: root, mode: 'observer', verifier: true });
      const guard = createTaskRuntimeGuard(root, 'reviewer', 'review-g');
      const read = createReadTool(root, { autoResizeImages: false });
      const result = await executeTaskGuarded(guard, 'image-read', 'read', () => read.execute('image-read', { path: 'result.png' }), { path: 'result.png' });
      const message = { role: 'toolResult' as const, toolCallId: 'image-read', toolName: 'read', content: result.content, isError: false, timestamp: Date.now() };
      let keepImage = false;
      const streamFn: Parameters<typeof wrapReviewerReadConfirmation>[0] = async (model, _context, options) => {
        const content = keepImage ? result.content.map(block => block.type === 'image' && encoding === 'binary'
          ? { source: { bytes: new Uint8Array(Buffer.from(block.data, 'base64')) } } : block)
          : result.content.filter(block => block.type === 'text');
        await options?.onPayload?.({ content }, model);
        const response = { role: 'assistant', content: [], stopReason: 'stop' } as unknown as AssistantMessage;
        const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: response }); stream.end(response); return stream;
      };
      const wrapped = wrapReviewerReadConfirmation(streamFn, guard);
      await (await wrapped({} as never, { messages: [message as never] }, {})).result();
      expect(() => store.assertReviewerReadCandidate(delegation)).toThrow('TASK_VERIFIER_READ_REQUIRED');
      keepImage = true;
      await (await wrapped({} as never, { messages: [message as never] }, {})).result();
      expect(() => store.assertReviewerReadCandidate(delegation)).not.toThrow();
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['utf8-bom', 'utf16-bom', 'image', 'paged', 'cr-lines'])('records actual read-tool evidence for %s candidates', async format => {
    const root = mkdtempSync(join(tmpdir(), 'task-review-format-'));
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const file = format === 'image' ? 'result.png' : 'result.txt';
      const bytes = format === 'image' ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1cAAAAASUVORK5CYII=', 'base64')
        : format === 'utf16-bom' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('first\nsecond\n', 'utf16le')])
          : format === 'utf8-bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('first\nsecond\n')])
            : format === 'cr-lines' ? Buffer.from('first\rsecond\r')
            : Buffer.from(Array.from({ length: 2400 }, (_, i) => `line ${i}`).join('\n'));
      writeFileSync(join(root, file), bytes);
      const task = store.start({ contract: { objective: 'Read supported candidate', target: file, constraints: [], maxRepairAttempts: 0,
        acceptance: [{ id: 'review', description: 'Read file', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files: [file] } }],
      } }, 'parent', 'parent-g', 'start');
      store.submit(task.claim!, 'candidate');
      const delegation = store.prepareWriterDelegation(task.claim!, { delegationId: 'review-run', childSessionKey: 'reviewer', childGeneration: 'review-g',
        childRunId: 'review-run', childWorktree: root, mode: 'observer', verifier: true });
      const guard = createTaskRuntimeGuard(root, 'reviewer', 'review-g');
      const tool = createReadTool(root, { autoResizeImages: false });
      const first = await executeTaskGuarded(guard, 'first', 'read', () => tool.execute('first', { path: file }), { path: file });
      const details = first.details as ReadToolDetails;
      expect(details.reviewReads?.length).toBe(1);
      store.confirmReviewerPrompt('reviewer', 'review-g', [{ role: 'toolResult', toolCallId: 'first', content: first.content }]);
      if (format === 'paged') {
        expect(() => store.assertReviewerReadCandidate(delegation)).toThrow('TASK_VERIFIER_READ_REQUIRED');
        const offset = details.reviewReads![0].end + 1;
        const second = await executeTaskGuarded(guard, 'second', 'read', () => tool.execute('second', { path: file, offset }), { path: file, offset });
        store.confirmReviewerPrompt('reviewer', 'review-g', [{ role: 'toolResult', toolCallId: 'second', content: second.content }]);
      }
      expect(() => store.assertReviewerReadCandidate(delegation)).not.toThrow();
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('records the actual read output of an observer across all candidate line ranges', async () => {
    const root = mkdtempSync(join(tmpdir(), 'task-review-read-'));
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      writeFileSync(join(root, 'result.txt'), 'first\nsecond\n');
      const task = store.start({ contract: { objective: 'Read candidate', target: 'result.txt', constraints: [], maxRepairAttempts: 0,
        acceptance: [{ id: 'review', description: 'Read both lines', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files: ['result.txt'] } }],
      } }, 'parent', 'parent-g', 'start');
      store.submit(task.claim!, 'candidate');
      const delegation = store.prepareWriterDelegation(task.claim!, { delegationId: 'review-run', childSessionKey: 'reviewer', childGeneration: 'review-g',
        childRunId: 'review-run', childWorktree: root, mode: 'observer', verifier: true });
      const guard = createTaskRuntimeGuard(root, 'reviewer', 'review-g');
      const readTool = createReadTool(root);
      const first = await executeTaskGuarded(guard, 'read-1', 'read', () => readTool.execute('read-1', { path: 'result.txt', offset: 1, limit: 1 }),
        { path: 'result.txt', offset: 1, limit: 1 });
      store.confirmReviewerPrompt('reviewer', 'review-g', [{ role: 'toolResult', toolCallId: 'read-1', content: first.content }]);
      expect(() => store.assertReviewerReadCandidate(delegation)).toThrow('TASK_VERIFIER_READ_REQUIRED');
      const second = await executeTaskGuarded(guard, 'read-2', 'read', () => readTool.execute('read-2', { path: 'result.txt', offset: 2, limit: 1 }),
        { path: 'result.txt', offset: 2, limit: 1 });
      store.confirmReviewerPrompt('reviewer', 'review-g', [{ role: 'toolResult', toolCallId: 'read-2', content: second.content }]);
      expect(() => store.assertReviewerReadCandidate(delegation)).not.toThrow();
      expect(store.history(task.contract.taskNodeId).filter(e => e.kind === 'review_file_read')).toHaveLength(2);
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('executes the yield callback while a submitted candidate waits for independent review', async () => {
    const root = mkdtempSync(join(tmpdir(), 'task-review-yield-'));
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      writeFileSync(join(root, 'result.txt'), 'review candidate');
      const task = store.start({ contract: { objective: 'Review candidate', target: 'result.txt', constraints: [], maxRepairAttempts: 1,
        acceptance: [{ id: 'review', description: 'Independent review', verification: {
          kind: 'owner-receipt', owner: 'subagent-verifier', files: ['result.txt'],
        } }] } }, 'parent', 'generation', 'start');
      store.submit(task.claim!, 'candidate');
      const guard = createTaskRuntimeGuard(root, 'parent', 'generation');
      let yields = 0;
      const tool = createSessionsYieldTool({ sessionId: 'generation', onYield: () => { yields++; } });
      const result = await executeTaskGuarded(guard, 'yield', tool.name, () => tool.execute('yield', {}));
      expect(result.details).toMatchObject({ status: 'yielded' });
      expect(yields).toBe(1);
      expect(store.get(task.contract.taskNodeId)).toMatchObject({ contract: { state: 'review' }, pendingOperations: 0 });
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it("requires a task before the first write even when no task database exists yet", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-first-write-"));
    try {
      const guard = createTaskRuntimeGuard(root, "a", "g");
      let mutations = 0;
      await expect(
        executeTaskGuarded(guard, "write", "write", async () => {
          mutations++;
        }),
      ).rejects.toThrow("TASK_CLAIM_REQUIRED");
      expect(mutations).toBe(0);
      expect(await executeTaskGuarded(guard, "read", "read", async () => 1)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("records cancellation immediately and waits for the in-flight owner before releasing the task", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-cancel-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const t = s.create(
        {
          objective: "cancel safely",
          target: ".",
          constraints: [],
          acceptance: [
            { id: "v", description: "verify", verification: { kind: "owner-receipt", owner: "v" } },
          ],
        },
        "c",
      ).task;
      const c = s.claim(t.contract.taskNodeId, "a", "g", "a").claim!;
      const guard = createTaskRuntimeGuard(root, "a", "g");
      let finish!: () => void;
      const wait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const operation = executeTaskGuarded(guard, "op", "write", async () => {
        await wait;
        return { ok: true };
      });
      expect(s.control(c, "cancel").contract.state).toBe("cancelling");
      await expect(executeTaskGuarded(guard, "new", "write", async () => 1)).rejects.toThrow(
        "EXECUTION_NOT_RUNNING",
      );
      finish();
      await operation;
      expect(s.get(c.taskNodeId).contract.state).toBe("cancelled");
      expect(s.get(c.taskNodeId).claim?.state).toBe("released");
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("blocks retries after a background effect until the real process owner reports completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-process-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "one process",
          target: ".",
          constraints: [],
          acceptance: [
            { id: "v", description: "verify", verification: { kind: "owner-receipt", owner: "v" } },
          ],
        },
        "c",
      ).task;
      s.claim(task.contract.taskNodeId, "a", "g", "a");
      const guard = createTaskRuntimeGuard(root, "a", "g");
      await executeTaskGuarded(
        guard,
        "exec",
        "exec",
        async () => ({ details: { sessionId: "owned-process", status: "running" } }),
        { command: "work" },
      );
      await expect(
        executeTaskGuarded(guard, "duplicate", "exec", async () => ({ details: { exitCode: 0 } }), {
          command: "work",
        }),
      ).rejects.toThrow("RECONCILIATION_REQUIRED");
      await executeTaskGuarded(
        guard,
        "poll",
        "process",
        async () => ({ details: { sessionId: "owned-process", status: "completed", exitCode: 0 } }),
        { action: "poll", sessionId: "owned-process" },
      );
      expect(s.get(task.contract.taskNodeId).pendingOperations).toBe(0);
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("restores a goal created during the run after ten compacted contexts without duplicating it", () => {
    const root = mkdtempSync(join(tmpdir(), "task-model-context-"));
    const guard = createTaskRuntimeGuard(root, "a", "g", "run");
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "Complete all three requirements",
          constraints: ["Keep the red lines"],
          target: ".",
          acceptance: [
            {
              id: "v",
              description: "All requirements verified",
              verification: { kind: "owner-receipt", owner: "v" },
            },
          ],
        },
        "c",
      ).task;
      s.claim(task.contract.taskNodeId, "a", "g", "a");
      for (let i = 0; i < 10; i++) {
        const restored = restoreTaskModelContext(guard, "System rules. Transcript was compacted.");
        expect(restored).toContain("Complete all three requirements");
        expect(restored).toContain("Keep the red lines");
        expect(restored).toContain("All requirements verified");
        expect(() => restoreTaskModelContext(guard, "rules", 10)).toThrow(
          "MODEL_CONTEXT_BUDGET_EXCEEDED",
        );
        expect(
          restoreTaskModelContext(guard, restored).split("<PERSISTENT_TASK_CONTRACT>"),
        ).toHaveLength(2);
      }
      const receipts = s.history(task.contract.taskNodeId).filter(event => event.kind === "context_rehydrated");
      expect(receipts).toHaveLength(1);
      const receipt = JSON.parse(receipts[0].json);
      expect(receipt).toMatchObject({ taskNodeId:task.contract.taskNodeId,revision:1,epoch:1,runId:"run",source:"runtime-context-restoration" });
      s.checkpoint(s.get(task.contract.taskNodeId).claim!,{nextAction:"Verify the final requirement",completed:[],unresolved:[],artifacts:[]});
      restoreTaskModelContext(guard,"System rules.");
      expect(s.history(task.contract.taskNodeId).filter(event=>event.kind==="context_rehydrated")).toHaveLength(2);
      expect(()=>s.recordContextHydration({sessionKey:"a",generation:"g",runId:"stale",taskNodeId:task.contract.taskNodeId,revision:1,epoch:1,context:"obsolete task context"})).toThrow("CONTEXT_CHANGED_DURING_RESTORATION");
    } finally {
      finishPersistentTaskRun(root, "a", "run");
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("does not grant a fork or unbound session write access in a managed repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-unbound-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const guard = createTaskRuntimeGuard(root, "fork", "generation");
      let writes = 0;
      await expect(
        executeTaskGuarded(guard, "op", "write", async () => {
          writes++;
        }),
      ).rejects.toThrow("CLAIM_REQUIRED");
      expect(writes).toBe(0);
      expect(await executeTaskGuarded(guard, "read", "read", async () => 1)).toBe(1);
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("adopts only a new initial binding, then keeps its epoch pinned", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-first-"));
    const guard = createTaskRuntimeGuard(root, "a", "g");
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "goal",
          target: ".",
          constraints: [],
          acceptance: [
            { id: "v", description: "verify", verification: { kind: "owner-receipt", owner: "v" } },
          ],
        },
        "c",
      ).task;
      const c = s.claim(task.contract.taskNodeId, "a", "g", "a").claim!;
      expect(await executeTaskGuarded(guard, "op1", "write", async () => ({ ok: true }))).toEqual({
        ok: true,
      });
      s.handoff(c, "a", "g");
      await expect(
        executeTaskGuarded(guard, "op2", "write", async () => ({ ok: true })),
      ).rejects.toThrow("STALE_OWNER");
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("captures the old epoch and refuses execution after handoff", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-guard-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "keep goal",
          constraints: [],
          target: ".",
          acceptance: [
            {
              id: "verify",
              description: "check",
              verification: { kind: "owner-receipt", owner: "verifier" },
            },
          ],
        },
        "create",
      ).task;
      const claim = s.claim(task.contract.taskNodeId, "a", "g", "a").claim!;
      const guard = createTaskRuntimeGuard(root, "a", "g");
      expect(readPersistentTaskContext(root, "a", "g")).toContain("keep goal");
      expect(await executeTaskGuarded(guard, "op1", "read", async () => ({ text: "ok" }))).toEqual({
        text: "ok",
      });
      s.handoff(claim, "b", "g2");
      let effects = 0;
      await expect(
        executeTaskGuarded(guard, "op2", "write", async () => {
          effects++;
        }),
      ).rejects.toThrow("STALE_OWNER");
      expect(effects).toBe(0);
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("binds a real tool result to unchanged verification inputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-verify-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      writeFileSync(join(root, "test.js"), "// approved test fixture");
      const task = s.create(
        {
          objective: "Pass the specified check",
          target: ".",
          constraints: [],
          acceptance: [
            {
              id: "test",
              description: "Registered check succeeds",
              verification: {
                kind: "tool-result",
                tool: "exec",
                command: "node test.js",
                files: ["test.js"],
                exitCode: 0,
              },
            },
          ],
        },
        "create",
      ).task;
      const c = s.claim(task.contract.taskNodeId, "a", "g", "a").claim!;
      const guard = createTaskRuntimeGuard(root, "a", "g");
      await executeTaskGuarded(
        guard,
        "exec1",
        "exec",
        async () => ({ details: { exitCode: 0, status: "completed" } }),
        { command: "node other.js" },
      );
      s.submit(c, "candidate");
      expect(() => s.accept(c, "candidate")).toThrow("EVIDENCE_MISSING");
      // A rejected submission retains its claim; release and reclaim starts a new attempt.
      s.control(c, "release");
      const current = s.claim(c.taskNodeId, "a", "g", "next").claim!;
      await executeTaskGuarded(
        createTaskRuntimeGuard(root, "a", "g"),
        "exec2",
        "exec",
        async () => ({ details: { exitCode: 0, status: "completed" } }),
        { command: "node test.js" },
      );
      s.submit(current, "candidate");
      writeFileSync(join(root, "test.js"), "// changed after checking");
      expect(() => s.accept(current, "candidate")).toThrow("EVIDENCE_STALE");
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
