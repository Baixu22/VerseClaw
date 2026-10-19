import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { app } from 'electron';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { isRecord } from './payload-utils';
import { buildSandboxStatus } from './sandbox-api';
import { previewRestore, restoreBackupArchive } from './backup-restore';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

type BackupRestorePayload = {
  archivePath?: unknown;
};

/**
 * Resolve and sanity-check a caller-supplied archive path.
 *
 * The path arrives from the renderer, so it is validated here rather than being
 * handed straight to the filesystem layer: it must be a non-empty string and it
 * must point at an existing regular file.
 */
async function resolveArchivePath(raw: unknown): Promise<{ ok: true; archivePath: string } | { ok: false; error: string }> {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'archivePath is required' };
  }
  const archivePath = raw.trim();
  const { stat } = await import('node:fs/promises');
  const statResult = await stat(archivePath).catch(() => null);
  if (!statResult?.isFile()) {
    return { ok: false, error: `backup archive not found: ${archivePath}` };
  }
  return { ok: true, archivePath };
}

export function createAppApi(): CompleteHostServiceRegistry['app'] {
  return {
    version: () => app.getVersion(),
    openClawDoctor: async (payload) => {
      const body = isRecord(payload) ? payload as OpenClawDoctorPayload : {};
      const result = body.mode === 'fix' ? await runOpenClawDoctorFix() : await runOpenClawDoctor();
      try {
        return { ...result, sandbox: await buildSandboxStatus() };
      } catch {
        return result;
      }
    },

    /**
     * Dry-run a restore: validate the archive and report what would be written,
     * skipped, or rejected. Performs no filesystem writes.
     *
     * Agent-driven automation; no human step is required or implied.
     */
    backupRestorePreview: async (payload) => {
      const body = isRecord(payload) ? payload as BackupRestorePayload : {};
      const resolved = await resolveArchivePath(body.archivePath);
      if (!resolved.ok) {
        return {
          success: false,
          error: resolved.error,
          valid: false,
          dryRun: true as const,
          archivePath: typeof body.archivePath === 'string' ? body.archivePath : '',
          entries: [],
          counts: { create: 0, skipped: 0, rejected: 0 },
          errors: [resolved.error],
        };
      }
      const preview = await previewRestore(resolved.archivePath);
      return {
        success: true,
        valid: preview.valid,
        dryRun: true as const,
        archivePath: resolved.archivePath,
        createdAt: preview.createdAt,
        includeWorkspace: preview.includeWorkspace,
        entries: preview.entries,
        counts: preview.counts,
        errors: preview.errors,
      };
    },

    /**
     * Apply a restore using conservative writes: only paths that do not exist
     * yet are created. Existing files are reported as skipped and never
     * overwritten, and a mid-run failure rolls back everything created here.
     */
    backupRestoreApply: async (payload) => {
      const body = isRecord(payload) ? payload as BackupRestorePayload : {};
      const resolved = await resolveArchivePath(body.archivePath);
      if (!resolved.ok) {
        return {
          success: false,
          error: resolved.error,
          dryRun: false,
          archivePath: typeof body.archivePath === 'string' ? body.archivePath : '',
          written: [],
          skipped: [],
          rejected: [],
          errors: [resolved.error],
          rolledBack: [],
        };
      }
      const result = await restoreBackupArchive(resolved.archivePath);
      return {
        success: result.success,
        ...(result.success ? {} : { error: result.errors[0] ?? 'restore failed' }),
        dryRun: result.dryRun,
        archivePath: resolved.archivePath,
        written: result.written,
        skipped: result.skipped,
        rejected: result.rejected,
        errors: result.errors,
        rolledBack: result.rolledBack,
      };
    },
  };
}