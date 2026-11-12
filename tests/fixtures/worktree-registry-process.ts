import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service.js';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const [root, action] = process.argv.slice(2);
const service = createWorktreeService(root, { backend: 'git' });
if (action === 'create') {
  const record = service.create('restart', {
    operationId: 'restart-op',
    owner: { agentId: 'worker', sessionKey: 'agent:worker:persistent', expectedSessionId: 'generation-1' },
  });
  writeFileSync(path.join(record.root, 'tracked.txt'), 'pending worker result');
  service.enqueueMerge({ worktreeId: record.id, changedFiles: ['tracked.txt'] });
  process.stdout.write(JSON.stringify(record));
  // Abrupt process exit deliberately omits normal store close.
  process.exit(23);
}
process.stdout.write(JSON.stringify({ records: service.list(), inventory: service.inventory(), queue: service.getMergeQueue() }));
closeOpenClawStateDatabaseForTest();
