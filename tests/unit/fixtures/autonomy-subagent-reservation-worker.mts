import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from '../../../openclaw_runtime/src/state/openclaw-state-db.js';
import { countActiveRunsForSession, reserveSubagentRun, resetSubagentRegistryForTests, testing } from '../../../openclaw_runtime/src/agents/subagent-registry.js';
import { loadSubagentRegistryFromSqlite, saveSubagentRegistryToSqlite, withSubagentRegistryCapacity, refreshSubagentRegistrySnapshot } from '../../../openclaw_runtime/src/agents/subagent-registry.store.sqlite.js';
import { createSubagentDispatchQueue } from '../../../openclaw_runtime/src/agents/subagent-registry-dispatch.js';
const controller = 'agent:main:controller', id = process.argv[2];
openOpenClawStateDatabase();
testing.setDepsForTest({ getRuntimeConfig: () => ({ agents: { defaults: { subagents: { maxChildrenPerAgent: 1 } } } }) });
process.stdout.write(JSON.stringify({ ready: true, pid: process.pid, before: countActiveRunsForSession(controller) }) + '\n');
await new Promise<void>(resolve => process.stdin.once('data', () => resolve()));
let admitted = false;
if (process.argv[3] === 'queue') {
  const runs = loadSubagentRegistryFromSqlite();
  const queue = createSubagentDispatchQueue({ runs, persist: () => saveSubagentRegistryToSqlite(runs),
    refresh: () => refreshSubagentRegistrySnapshot(runs), capacity: () => 1,
    claim: (entry, cap, claim) => withSubagentRegistryCapacity({ controller, maxChildren: cap, queuedRunId: entry.runId }, claim),
    dispatch: async () => { admitted = true; return { status: 'unknown', error: 'agent-injected lost acknowledgement' }; },
    accepted: () => {}, rejected: async () => { throw new Error('unexpected queued rejection'); }, warn: () => {},
  });
  await queue.drain();
} else {
  admitted = reserveSubagentRun({ runId: id, childSessionKey: 'agent:main:subagent:' + id, requesterSessionKey: controller,
    controllerSessionKey: controller, requesterDisplayKey: controller, requesterSessionId: 'controller-generation',
    task: 'controlled reservation', cleanup: 'keep', expectsCompletionMessage: false }, 1);
}
process.stdout.write(JSON.stringify({ admitted, pid: process.pid, after: countActiveRunsForSession(controller) }) + '\n');
resetSubagentRegistryForTests({ persist: false }); closeOpenClawStateDatabase();
