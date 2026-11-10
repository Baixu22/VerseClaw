import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import type { LongTaskCheckpointRecord } from '../../../shared/host-api/contract';
import { hostInvoke } from './fp-p1-harness';

/** 只补 checkpoint owner 记录；文件与 journal 必须已由真实 Runtime write 生成。 */
export async function ensureContextOwnerCheckpoint(app: ElectronApplication, input: {
  userDataDir: string; workspaceRoot: string; workspaceId: string; sessionKey: string; generation: string; runId: string;
}) {
  const { getOrCreateWriteJournal, __resetWriteJournals } = await import('../../../openclaw_runtime/src/agents/tools/write-journal-core');
  __resetWriteJournals();
  const journal = getOrCreateWriteJournal(input.workspaceRoot, input.generation);
  const entries = journal.entries.filter(entry => entry.lineage?.requestId === 'u5commitwritev1');
  if (entries.length !== 1) throw new Error('Real v1 tool write did not produce exactly one matching journal entry');
  if (entries[0].lineage?.sessionId !== input.generation) throw new Error('Real write journal UUID mismatch');
  const seq = Math.max(...journal.entries.map(entry => entry.seq));
  const bytes = await readFile(entries[0].snapshotPath);
  const meta = await readFile(`${entries[0].snapshotPath}.meta.json`);
  const proof = { entries: journal.entries, seq, preimageSha256: createHash('sha256').update(bytes).digest('hex'),
    metaSha256: createHash('sha256').update(meta).digest('hex') };
  const before = await hostInvoke<{ success: boolean; checkpoints: LongTaskCheckpointRecord[] }>(app, 'sessions', 'resumeCheckpoints',
    { sessionKey: input.sessionKey, agentId: 'main', limit: 100 });
  if (!before.success) throw new Error('Runtime checkpoint owner unavailable');
  const natural = before.checkpoints.find(row => {
    const metadata = row.checkpoint.metadata as Record<string, unknown> | undefined;
    return metadata?.journalSessionId === input.generation && metadata.journalSeq === seq;
  });
  if (natural) return { source: 'existing-runtime-checkpoint', record: natural, journal: proof,
    recordSha256: createHash('sha256').update(JSON.stringify(natural)).digest('hex') };

  // 与 desktop source Runtime 隔离规则一致，并从原 session owner 核验 UUID；不猜另一状态目录。
  const stateDir = join(input.userDataDir, 'openclaw-source-state');
  const config = JSON.parse(await readFile(join(stateDir, 'openclaw.json'), 'utf8'));
  const workspace = config.agents?.list?.find((agent: { id: string }) => agent.id === 'main')?.workspace ?? config.agents?.defaults?.workspace;
  const oldState = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  let closeState: (() => void) | undefined, closeSession: (() => void) | undefined;
  try {
    closeState = (await import('../../../openclaw_runtime/src/state/openclaw-state-db')).closeOpenClawStateDatabase;
    const { getSessionEntry } = await import('../../../openclaw_runtime/src/config/sessions/store');
    const storePath = join(stateDir, 'agents', 'main', 'sessions', 'sessions.json');
    const { closeSqliteSessionStoreDatabase } = await import('../../../openclaw_runtime/src/config/sessions/store-sqlite');
    closeSession = () => { closeSqliteSessionStoreDatabase(storePath); };
    const session = getSessionEntry({ storePath, sessionKey: input.sessionKey });
    if (session?.sessionId !== input.generation) throw new Error('Source Runtime session UUID mismatch; seed refused');
    const executionRoot = session.workspaceDir?.trim() || session.spawnedWorkspaceDir?.trim() || workspace;
    if (typeof executionRoot !== 'string' || resolve(executionRoot).toLowerCase() !== resolve(input.workspaceRoot).toLowerCase())
      throw new Error('Source session execution directory differs from the real journal workspace; seed refused');
    const { recordLongTaskCheckpoint, buildRuntimeResumeCheckpoint, getLongTaskCheckpointById } = await import('../../../openclaw_runtime/src/agents/long-task-control/store');
    const id = `u5-commit:${input.generation}:v1`;
    const record = recordLongTaskCheckpoint({ id, idempotencyKey: id, sessionKey: input.sessionKey, agentId: 'main',
      workspaceId: input.workspaceId, runId: input.runId, trigger: 'manual_review', status: 'checkpointed',
      checkpoint: buildRuntimeResumeCheckpoint({ id, sessionKey: input.sessionKey, agentId: 'main', workspaceId: input.workspaceId,
        trigger: 'manual_review', activeTask: 'Agent-seeded restore boundary after real v1 write', filesTouched: ['result.txt'],
        metadata: { journalSessionId: input.generation, journalSeq: seq, driven_by: 'agent', seedSource: 'test-process-original-checkpoint-owner' }, createdAt: Date.now() }) });
    const readback = getLongTaskCheckpointById(id);
    if (!readback || JSON.stringify(readback) !== JSON.stringify(record)) throw new Error('Seed owner readback mismatch');
    const fromRuntime = await hostInvoke<{ success: boolean; checkpoints: LongTaskCheckpointRecord[] }>(app, 'sessions', 'resumeCheckpoints',
      { sessionKey: input.sessionKey, agentId: 'main', limit: 100 });
    const seen = fromRuntime.checkpoints.find(row => row.id === id);
    if (!fromRuntime.success || seen?.checkpoint.metadata?.journalSessionId !== input.generation || seen?.checkpoint.metadata?.journalSeq !== seq)
      throw new Error('Runtime did not read the exact source-owner seed');
    return { source: 'source-owner-seed', stateDir, sqlitePath: join(stateDir, 'state', 'openclaw.sqlite'), record, journal: proof,
      recordSha256: createHash('sha256').update(JSON.stringify(record)).digest('hex') };
  } finally {
    try { closeSession?.(); closeState?.(); } finally {
      if (oldState === undefined) delete process.env.OPENCLAW_STATE_DIR; else process.env.OPENCLAW_STATE_DIR = oldState;
    }
  }
}
