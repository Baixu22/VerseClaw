import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service.ts';
import { applyWorktreeFiles } from '../../openclaw_runtime/src/agents/worktree-merge-files.ts';
import { withAsyncCheckoutMaintenance } from '../../openclaw_runtime/src/agents/worktree-writer.ts';
import { loadWorktreeRegistryScope, saveWorktreeRegistryScope } from '../../openclaw_runtime/src/agents/worktree-registry.ts';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db.ts';

async function main() {
  const [root, id, generation, files] = process.argv.slice(2);
  const service = createWorktreeService(root, { backend: 'git' });
  const request = { worktreeId: id, worktreeGeneration: generation, changedFiles: JSON.parse(files) as string[] };
  const queued = service.enqueueMerge(request);
  if (['crash-before-journal', 'crash-after-journal-ref'].includes(process.argv[6])) {
    await withAsyncCheckoutMaintenance([service.writerBasis(null), service.writerBasis(id)], 'merge', async admit => {
      const state = loadWorktreeRegistryScope(root);
      state.queue[0].status = 'conflict'; state.queue[0].reason = 'merge_outcome_unknown';
      saveWorktreeRegistryScope(state);
      if (process.argv[6] === 'crash-after-journal-ref') {
        const record = state.records.get(id)!;
        await applyWorktreeFiles({ baseRoot: root, workerRoot: record.root, files: request.changedFiles,
          sessionKey: 'r4-native-journal-ref-crash',
          baseline: { parent: new Map(Object.entries(record.mergeBaseline!.parent)), worker: new Map(Object.entries(record.mergeBaseline!.worker)) },
          assertCurrent: () => {}, beforeApply: (journalRef, hashes) => {
            const prepared = loadWorktreeRegistryScope(root); prepared.queue[0].journalRef = journalRef; prepared.queue[0].hashes = hashes;
            saveWorktreeRegistryScope(prepared); process.exit(30);
          }, beforeEffect: admit });
      }
      process.exit(29);
    }, undefined, undefined, undefined, true);
  }
  const processed = await service.processMergeQueue();
  process.stdout.write(JSON.stringify({ driven_by: 'agent', actor: 'r4-native-merge-process',
    pid: process.pid, queued, processed, records: service.list(), remaining: service.getMergeQueue() }));
  closeOpenClawStateDatabaseForTest();
}
void main().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
