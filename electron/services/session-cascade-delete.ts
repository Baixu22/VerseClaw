/**
 * Host-side session derivative cascade (P3-004 / F-DATA-005).
 * Complements file artefact sweep in session-files.ts with SEKB/memory/DCS journals.
 */
import { existsSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { BlockStore } from '../../openclaw_runtime/src/context-engine/block-store';
import { getOpenClawRuntimeDir } from '../utils/paths';
import { resolveHostOpenClawStateDir } from './knowledge-api';
import { logger } from '../utils/logger';

export type HostCascadeReport = {
  success: boolean;
  removed: Array<{ kind: string; id: string }>;
  errors: Array<{ kind: string; id: string; error: string; retryable: boolean }>;
  retryable: boolean;
};

export async function runHostSessionDerivativeCascade(
  sessionKey: string,
  baseId: string,
): Promise<HostCascadeReport> {
  const removed: HostCascadeReport['removed'] = [];
  const errors: HostCascadeReport['errors'] = [];

  // KS-02: real DCS BlockStore cleanup first. This is the same SQLite that
  // runtime context_search/context_read consume; journal cleanup alone is not
  // enough to prove residual zero.
  try {
    const database = openOpenClawStateDatabase({
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: resolveHostOpenClawStateDir(),
      },
    });
    const blockStore = new BlockStore(database.db);
    const blocks = await blockStore.enumerateBySession(sessionKey);
    for (const block of blocks) {
      await blockStore.deleteBlock(block.block_id);
      removed.push({ kind: 'dcs_experience_block', id: block.block_id });
    }
    const { remaining } = await blockStore.deleteBySession(sessionKey);
    if (remaining > 0) {
      errors.push({
        kind: 'dcs_experience_block',
        id: `session:${sessionKey}`,
        error: `${remaining} context_blocks row(s) remain for session ${sessionKey}`,
        retryable: true,
      });
    }
  } catch (error) {
    errors.push({
      kind: 'dcs_experience_block',
      id: `session:${sessionKey}`,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }

  // DCS experience journal (host-written by P3-002)
  try {
    const stateDir = resolveHostOpenClawStateDir();
    const journalDir = join(stateDir, 'dcs-experience-journal');
    if (existsSync(journalDir)) {
      for (const name of readdirSync(journalDir)) {
        if (!name.includes(baseId) && !name.includes(sessionKey.replace(/[:/\\]/g, '_'))) {
          // also match experience:sekb:<session>:...
          try {
            const raw = readFileSync(join(journalDir, name), 'utf8');
            if (!raw.includes(sessionKey) && !raw.includes(baseId)) continue;
          } catch {
            continue;
          }
        }
        try {
          unlinkSync(join(journalDir, name));
          removed.push({ kind: 'dcs_experience_journal', id: name });
        } catch (error) {
          errors.push({
            kind: 'dcs_experience_journal',
            id: name,
            error: error instanceof Error ? error.message : String(error),
            retryable: true,
          });
        }
      }
    }
  } catch (error) {
    errors.push({
      kind: 'dcs_experience_journal',
      id: '*',
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }

  // SEKB cascade via runtime module when available
  try {
    const entryPath = join(getOpenClawRuntimeDir(), 'dist', 'knowledge', 'sekb', 'index.js');
    if (existsSync(entryPath)) {
      const sekb = await import(pathToFileURL(entryPath).href) as {
        KnowledgeStore: new (opts: unknown) => {
          query_principles: (q: unknown) => Array<{ principle_id: string; metadata?: Record<string, unknown>; source_trajectories?: string[] }>;
          delete_principle?: (id: string) => void;
          archive_principle?: (id: string) => void;
          query_trajectories: (q: unknown) => Array<{ trajectory_id: string; metadata?: Record<string, unknown> }>;
          delete_trajectory?: (id: string) => void;
          purge_expired_trajectories?: () => string[];
        };
        executeSessionCascadeDelete?: (
          sessionId: string,
          stores: unknown,
          options?: { canary?: string },
        ) => {
          success: boolean;
          removed: Array<{ kind: string; id: string }>;
          errors: Array<{ kind: string; id: string; error: string; retryable: boolean }>;
          retryable: boolean;
        };
        createKnowledgeStoreCascadeAdapter?: (store: unknown, extras?: unknown) => unknown;
      };

      const stateDir = resolveHostOpenClawStateDir();
      const store = new sekb.KnowledgeStore({
        database: { env: { ...process.env, OPENCLAW_STATE_DIR: stateDir } },
      });

      if (typeof sekb.executeSessionCascadeDelete === 'function' && typeof sekb.createKnowledgeStoreCascadeAdapter === 'function') {
        const report = sekb.executeSessionCascadeDelete(
          sessionKey,
          sekb.createKnowledgeStoreCascadeAdapter(store, {
            listDcsExperienceJournalIds: () => removed.filter((r) => r.kind === 'dcs_experience_journal').map((r) => r.id),
            deleteDcsExperienceJournal: () => undefined,
          }),
        );
        removed.push(...report.removed);
        errors.push(...report.errors);
      } else {
        // Fallback: archive principles with matching session provenance + purge TTL
        for (const principle of store.query_principles({})) {
          const provenance = principle.metadata?.confirmProvenance as { sessionId?: string } | undefined;
          const sessionId = provenance?.sessionId ?? (principle.metadata?.sessionId as string | undefined);
          if (sessionId !== sessionKey) continue;
          try {
            if (typeof store.delete_principle === 'function') store.delete_principle(principle.principle_id);
            else store.archive_principle?.(principle.principle_id);
            removed.push({ kind: 'sekb_principle', id: principle.principle_id });
          } catch (error) {
            errors.push({
              kind: 'sekb_principle',
              id: principle.principle_id,
              error: error instanceof Error ? error.message : String(error),
              retryable: true,
            });
          }
        }
        if (typeof store.purge_expired_trajectories === 'function') {
          for (const id of store.purge_expired_trajectories()) {
            removed.push({ kind: 'sekb_trajectory', id });
          }
        }
      }
    }
  } catch (error) {
    logger.warn(`[session:cascade] SEKB cascade unavailable: ${String(error)}`);
    errors.push({
      kind: 'sekb_principle',
      id: '*',
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }

  return {
    success: errors.length === 0,
    removed,
    errors,
    retryable: errors.some((entry) => entry.retryable),
  };
}
