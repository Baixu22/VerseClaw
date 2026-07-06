import { freemem, totalmem, cpus, loadavg, platform, arch } from 'node:os';
import { statfs, readdir, stat, unlink, rm, readFile } from 'node:fs/promises';
import { join, basename, dirname, relative, resolve, sep } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type {
  SystemInfoResult,
  SystemScanResult,
  SystemScanCategory,
  SystemScanItem,
  SystemScanCategoryId,
  SystemScanPayload,
  SystemDeleteItemsPayload,
  SystemDeleteItemsResult,
  SystemDiskInfo,
} from '@shared/host-api/contract';
import { getOpenClawConfigDir, getDataDir, getLogsDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { listAgentIdsWithSessionDirs } from '../utils/token-usage';
import { sweepSessionArtefacts } from '../utils/session-files';
import { recordPermissionAudit } from './permissions-api';
import { isRecord } from './payload-utils';

const MAX_ITEMS_PER_CATEGORY = 500;
const DRY_RUN_CACHE_TTL_MS = 60_000;
const SESSION_FILE_PATTERN = /^([^.]+)\.(jsonl|archived\.jsonl|deleted\.jsonl|trajectory\.jsonl|trajectory-path\.json|jsonl\.reset\..*)$/;

type ScanPayload = SystemScanPayload & { categories?: SystemScanCategoryId[] };
type DeletePayload = SystemDeleteItemsPayload & {
  items: Array<{ id: string; path: string }>;
  dryRun?: boolean;
  approvalId?: string;
};

interface DryRunCacheEntry {
  itemIds: Set<string>;
  expiresAt: number;
}

const dryRunCache = new Map<string, DryRunCacheEntry>();

function getElectronCacheDir(): string {
  return join(getDataDir(), 'Cache');
}

function getAllowedRoots(): string[] {
  return [resolve(getOpenClawConfigDir()), resolve(getDataDir()), resolve(getLogsDir()), resolve(getElectronCacheDir())];
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const rel = relative(parentDir, childPath);
  return rel.length > 0 && !rel.startsWith('..') && !rel.includes(`..${sep}`);
}

function isPathAllowed(absPath: string): boolean {
  return getAllowedRoots().some((root) => isPathInside(root, absPath) || absPath === root);
}

function stableId(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = (h * 31 + path.charCodeAt(i)) | 0;
  }
  return `item-${(h >>> 0).toString(36)}`;
}

function extractBaseId(filename: string): string | null {
  const m = SESSION_FILE_PATTERN.exec(filename);
  return m ? m[1] : null;
}

function isSessionArtefact(absPath: string): boolean {
  return SESSION_FILE_PATTERN.test(basename(absPath));
}

async function safeStat(path: string): Promise<{ size: number; mtime: number; isDir: boolean } | null> {
  try {
    const s = await stat(path);
    return { size: s.size, mtime: s.mtimeMs, isDir: s.isDirectory() };
  } catch {
    return null;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(child);
    } else if (entry.isFile()) {
      const s = await safeStat(child);
      if (s) total += s.size;
    }
  }
  return total;
}

async function listDirItems(
  dir: string,
  opts: { recursive?: boolean; fileFilter?: (name: string) => boolean } = {},
): Promise<SystemScanItem[]> {
  const items: SystemScanItem[] = [];
  const seen = new Set<string>();

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (items.length >= MAX_ITEMS_PER_CATEGORY) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (items.length >= MAX_ITEMS_PER_CATEGORY) return;
      const child = join(currentDir, entry.name);
      if (seen.has(child)) continue;
      seen.add(child);
      const s = await safeStat(child);
      if (!s) continue;
      const sizeBytes = s.isDir ? await dirSize(child) : s.size;
      const filterOk = !opts.fileFilter || s.isDir || opts.fileFilter(entry.name);
      if (!filterOk) continue;
      items.push({
        id: stableId(child),
        path: child,
        displayPath: child,
        sizeBytes,
        mtime: s.mtime,
        isDir: s.isDir,
        safeToDelete: true,
      });
      if (opts.recursive && s.isDir && depth < 2) {
        await walk(child, depth + 1);
      }
    }
  }

  await walk(dir, 0);
  return items;
}

function truncateItems(items: SystemScanItem[]): { items: SystemScanItem[]; truncated: boolean } {
  if (items.length <= MAX_ITEMS_PER_CATEGORY) return { items, truncated: false };
  return { items: items.slice(0, MAX_ITEMS_PER_CATEGORY), truncated: true };
}

// ── System info ─────────────────────────────────────────────────

async function scanRam(): Promise<SystemInfoResult['ram']> {
  return {
    totalBytes: totalmem(),
    freeBytes: freemem(),
    appUsedBytes: process.memoryUsage().rss,
  };
}

async function scanDisk(): Promise<SystemDiskInfo[]> {
  const roots = [resolve(getDataDir()), resolve(getLogsDir()), resolve(getOpenClawConfigDir())];
  const uniqueRoots = [...new Set(roots)];
  const results: SystemDiskInfo[] = [];
  for (const root of uniqueRoots) {
    try {
      const s = await statfs(root);
      results.push({
        root,
        totalBytes: s.bsize * s.blocks,
        freeBytes: s.bsize * s.bavail,
      });
    } catch (err) {
      logger.warn(`[system-api] statfs failed for ${root}: ${err}`);
    }
  }
  return results;
}

function scanCpu(): SystemInfoResult['cpu'] {
  const cores = cpus().length;
  if (platform() === 'win32') {
    return { loadPercent: 0, cores, available: false };
  }
  const avg = loadavg()[0];
  return {
    loadPercent: cores > 0 ? Math.min(100, Math.round((avg / cores) * 100)) : 0,
    cores,
    available: true,
  };
}

// ── Category scanners ───────────────────────────────────────────

async function scanLogsCategory(): Promise<SystemScanCategory> {
  const activeLogPath = logger.getLogFilePath();
  const files = await logger.listLogFiles();
  const items: SystemScanItem[] = files
    .filter((f) => f.path !== activeLogPath)
    .map((f) => ({
      id: stableId(f.path),
      path: f.path,
      displayPath: f.path,
      sizeBytes: f.size,
      mtime: Date.parse(f.modified) || 0,
      isDir: false,
      safeToDelete: true,
    }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  const { items: truncatedItems, truncated } = truncateItems(items);
  return {
    id: 'logs',
    labelKey: 'settings:storage.category.logs.label',
    totalBytes,
    itemCount: items.length,
    deletable: 'always',
    regenerate: false,
    items: truncatedItems,
    truncated,
  };
}

async function readActiveSessionBaseIds(sessionsDirAbs: string): Promise<Set<string>> {
  const indexDir = dirname(sessionsDirAbs);
  const indexPath = join(indexDir, 'sessions.json');
  const activeBaseIds = new Set<string>();
  try {
    const raw = await readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    const extractPath = (entry: unknown): string | null => {
      if (typeof entry === 'string') return entry;
      if (isRecord(entry)) {
        if (typeof entry.transcriptPath === 'string') return entry.transcriptPath;
        if (typeof entry.path === 'string') return entry.path;
        if (typeof entry.sessionId === 'string') return entry.sessionId;
      }
      return null;
    };
    const entries: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.sessions)
        ? parsed.sessions
        : isRecord(parsed)
          ? Object.values(parsed)
          : [];
    for (const entry of entries) {
      const p = extractPath(entry);
      if (p) activeBaseIds.add(basename(p).replace(/\.jsonl$/, ''));
    }
  } catch {
    // Missing/unreadable sessions.json — treat all live transcripts as conditional.
  }
  return activeBaseIds;
}

async function scanSessionsCategory(): Promise<SystemScanCategory> {
  const configDir = getOpenClawConfigDir();
  const agentIds = await listAgentIdsWithSessionDirs();
  const items: SystemScanItem[] = [];

  for (const agentId of agentIds) {
    const sessionsDir = join(configDir, 'agents', agentId, 'sessions');
    const activeBaseIds = await readActiveSessionBaseIds(sessionsDir);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(sessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      const baseId = extractBaseId(name);
      if (!baseId) continue;
      // Only show session transcripts + archived + legacy deleted; trajectories go to their own category.
      if (name.endsWith('.trajectory.jsonl') || name.endsWith('.trajectory-path.json') || name.startsWith(`${baseId}.jsonl.reset.`)) {
        continue;
      }
      const fullPath = join(sessionsDir, name);
      const s = await safeStat(fullPath);
      if (!s) continue;
      const isActive = name.endsWith('.jsonl') && activeBaseIds.has(baseId);
      const isArchived = name.endsWith('.archived.jsonl');
      const isLegacyDeleted = name.endsWith('.deleted.jsonl');
      const deletable = isActive ? 'never' : isLegacyDeleted ? 'always' : 'conditional';
      items.push({
        id: stableId(fullPath),
        path: fullPath,
        displayPath: fullPath,
        sizeBytes: s.size,
        mtime: s.mtime,
        isDir: false,
        safeToDelete: deletable !== 'never',
        riskNoteKey: isActive ? 'settings:storage.riskNote.activeSession' : undefined,
        metadata: { agentId, baseId, sessionsDirAbs: sessionsDir, kind: isActive ? 'active' : isArchived ? 'archived' : isLegacyDeleted ? 'legacyDeleted' : 'orphan' },
      });
    }
  }

  items.sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  const { items: truncatedItems, truncated } = truncateItems(items);
  const categoryDeletable: SystemScanCategory['deletable'] = items.some((i) => i.metadata?.kind === 'active')
    ? 'conditional'
    : items.length > 0
      ? 'conditional'
      : 'always';
  return {
    id: 'sessions',
    labelKey: 'settings:storage.category.sessions.label',
    totalBytes,
    itemCount: items.length,
    deletable: categoryDeletable,
    regenerate: false,
    items: truncatedItems,
    truncated,
  };
}

async function scanTrajectoriesCategory(): Promise<SystemScanCategory> {
  const configDir = getOpenClawConfigDir();
  const agentIds = await listAgentIdsWithSessionDirs();
  const items: SystemScanItem[] = [];

  for (const agentId of agentIds) {
    const sessionsDir = join(configDir, 'agents', agentId, 'sessions');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(sessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const liveBaseIds = new Set<string>();
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.archived.jsonl'))) {
        liveBaseIds.add(extractBaseId(entry.name) ?? '');
      }
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const isTrajectory = entry.name.endsWith('.trajectory.jsonl');
      const isPointer = entry.name.endsWith('.trajectory-path.json');
      if (!isTrajectory && !isPointer) continue;
      const baseId = extractBaseId(entry.name);
      if (!baseId) continue;
      const fullPath = join(sessionsDir, entry.name);
      const s = await safeStat(fullPath);
      if (!s) continue;
      const orphaned = !liveBaseIds.has(baseId);
      items.push({
        id: stableId(fullPath),
        path: fullPath,
        displayPath: fullPath,
        sizeBytes: s.size,
        mtime: s.mtime,
        isDir: false,
        safeToDelete: orphaned,
        riskNoteKey: orphaned ? undefined : 'settings:storage.riskNote.activeSession',
        metadata: { agentId, baseId, sessionsDirAbs: sessionsDir, kind: orphaned ? 'orphanTrajectory' : 'liveTrajectory' },
      });
    }
  }

  items.sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  const { items: truncatedItems, truncated } = truncateItems(items);
  return {
    id: 'trajectories',
    labelKey: 'settings:storage.category.trajectories.label',
    totalBytes,
    itemCount: items.length,
    deletable: 'always',
    regenerate: false,
    items: truncatedItems,
    truncated,
  };
}

async function scanDirCategory(
  categoryId: SystemScanCategoryId,
  dir: string,
  opts: { deletable: SystemScanCategory['deletable']; regenerate: boolean; recursive?: boolean; fileFilter?: (name: string) => boolean },
): Promise<SystemScanCategory> {
  const items = await listDirItems(dir, { recursive: opts.recursive, fileFilter: opts.fileFilter });
  items.sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  const { items: truncatedItems, truncated } = truncateItems(items);
  return {
    id: categoryId,
    labelKey: `settings:storage.category.${categoryId}.label`,
    totalBytes,
    itemCount: items.length,
    deletable: opts.deletable,
    regenerate: opts.regenerate,
    items: truncatedItems,
    truncated,
  };
}

async function scanAllCategories(filter?: SystemScanCategoryId[]): Promise<SystemScanCategory[]> {
  const all: Array<Promise<SystemScanCategory>> = [];
  const want = (id: SystemScanCategoryId) => !filter || filter.includes(id);

  if (want('logs')) all.push(scanLogsCategory().catch(() => emptyCategory('logs', 'always', false)));
  if (want('sessions')) all.push(scanSessionsCategory().catch(() => emptyCategory('sessions', 'conditional', false)));
  if (want('trajectories')) all.push(scanTrajectoriesCategory().catch(() => emptyCategory('trajectories', 'always', false)));
  if (want('mediaOutbound')) {
    all.push(scanDirCategory('mediaOutbound', join(getOpenClawConfigDir(), 'media', 'outbound'), { deletable: 'conditional', regenerate: false, recursive: true }).catch(() => emptyCategory('mediaOutbound', 'conditional', false)));
  }
  if (want('mediaThumbs')) {
    all.push(scanDirCategory('mediaThumbs', join(getDataDir(), 'media-thumbs'), { deletable: 'always', regenerate: true, recursive: true }).catch(() => emptyCategory('mediaThumbs', 'always', true)));
  }
  if (want('electronCache')) {
    all.push(scanDirCategory('electronCache', getElectronCacheDir(), { deletable: 'conditional', regenerate: true, recursive: true }).catch(() => emptyCategory('electronCache', 'conditional', true)));
  }
  if (want('uvCache')) {
    all.push(scanDirCategory('uvCache', join(getOpenClawConfigDir(), 'uv-cache'), { deletable: 'conditional', regenerate: true, recursive: true }).catch(() => emptyCategory('uvCache', 'conditional', true)));
  }
  if (want('trash')) {
    all.push(scanDirCategory('trash', join(getDataDir(), 'trash'), { deletable: 'conditional', regenerate: false, recursive: true }).catch(() => emptyCategory('trash', 'conditional', false)));
  }

  return Promise.all(all);
}

function emptyCategory(id: SystemScanCategoryId, deletable: SystemScanCategory['deletable'], regenerate: boolean): SystemScanCategory {
  return {
    id,
    labelKey: `settings:storage.category.${id}.label`,
    totalBytes: 0,
    itemCount: 0,
    deletable,
    regenerate,
    items: [],
    truncated: false,
  };
}

// ── Deletion ────────────────────────────────────────────────────

function pruneDryRunCache(): void {
  const now = Date.now();
  for (const [id, entry] of dryRunCache) {
    if (entry.expiresAt <= now) dryRunCache.delete(id);
  }
}

async function deleteSingleItem(item: { id: string; path: string }): Promise<{ removed: boolean; freedBytes: number; error?: string }> {
  const absPath = resolve(item.path);
  if (!isPathAllowed(absPath)) {
    return { removed: false, freedBytes: 0, error: 'path outside allowed roots' };
  }
  const s = await safeStat(absPath);
  if (!s) {
    return { removed: false, freedBytes: 0, error: 'not found' };
  }
  const freedBytes = s.isDir ? await dirSize(absPath) : s.size;

  // Session/trajectory artefacts: sweep all siblings of the baseId.
  if (isSessionArtefact(absPath)) {
    const sessionsDirAbs = dirname(absPath);
    const baseId = extractBaseId(basename(absPath));
    if (!baseId) {
      return { removed: false, freedBytes: 0, error: 'cannot parse session base id' };
    }
    // Guard: never sweep an active live transcript.
    const activeBaseIds = await readActiveSessionBaseIds(sessionsDirAbs);
    if (activeBaseIds.has(baseId) && basename(absPath).endsWith('.jsonl')) {
      return { removed: false, freedBytes: 0, error: 'active session transcript cannot be deleted' };
    }
    try {
      await sweepSessionArtefacts(sessionsDirAbs, baseId);
      return { removed: true, freedBytes };
    } catch (err) {
      return { removed: false, freedBytes: 0, error: (err as Error).message };
    }
  }

  // Log files: guard the active log.
  const activeLogPath = logger.getLogFilePath();
  if (activeLogPath && absPath === resolve(activeLogPath)) {
    return { removed: false, freedBytes: 0, error: 'active log file cannot be deleted' };
  }

  try {
    if (s.isDir) {
      await rm(absPath, { recursive: true, force: false });
    } else {
      await unlink(absPath);
    }
    return { removed: true, freedBytes };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { removed: true, freedBytes };
    return { removed: false, freedBytes: 0, error: (err as Error).message };
  }
}

async function buildWorkspaceStub() {
  const now = Date.now();
  return {
    id: 'clawx-storage-cleaner',
    name: 'Storage Cleaner',
    rootPath: getOpenClawConfigDir(),
    agentId: 'main',
    activeSessionKey: '',
    permissionMode: 'fullAccess' as const,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    state: {},
  };
}

// ── Public API ──────────────────────────────────────────────────

export function createSystemApi(): CompleteHostServiceRegistry['system'] {
  return {
    info: async () => {
      const [ram, disk] = await Promise.all([scanRam(), scanDisk()]);
      const cpu = scanCpu();
      return {
        success: true,
        ram,
        disk,
        cpu,
        platform: platform(),
        arch: arch(),
      } satisfies SystemInfoResult;
    },

    scan: async (payload) => {
      const body = isRecord(payload) ? (payload as ScanPayload) : {};
      const filter = Array.isArray(body.categories) ? body.categories : undefined;
      const [ram, disk] = await Promise.all([scanRam(), scanDisk()]);
      const cpu = scanCpu();
      const categories = await scanAllCategories(filter);
      const result: SystemScanResult = {
        success: true,
        scannedAt: Date.now(),
        system: { ram, disk, cpu, platform: platform(), arch: arch() },
        categories,
      };
      return result;
    },

    deleteItems: async (payload) => {
      const body = isRecord(payload) ? (payload as DeletePayload) : { items: [] };
      const items = Array.isArray(body.items) ? body.items.filter((i) => i && typeof i.path === 'string') : [];
      const dryRun = body.dryRun !== false;
      pruneDryRunCache();

      if (dryRun) {
        const approvalId = `dryrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        dryRunCache.set(approvalId, {
          itemIds: new Set(items.map((i) => i.id)),
          expiresAt: Date.now() + DRY_RUN_CACHE_TTL_MS,
        });
        // Project removal without side effects.
        const removed: string[] = [];
        const errors: Array<{ path: string; error: string }> = [];
        let freedBytes = 0;
        for (const item of items) {
          const absPath = resolve(item.path);
          if (!isPathAllowed(absPath)) {
            errors.push({ path: item.path, error: 'path outside allowed roots' });
            continue;
          }
          const s = await safeStat(absPath);
          if (!s) {
            errors.push({ path: item.path, error: 'not found' });
            continue;
          }
          if (isSessionArtefact(absPath)) {
            const baseId = extractBaseId(basename(absPath));
            const sessionsDirAbs = dirname(absPath);
            const activeBaseIds = await readActiveSessionBaseIds(sessionsDirAbs);
            if (baseId && activeBaseIds.has(baseId) && basename(absPath).endsWith('.jsonl')) {
              errors.push({ path: item.path, error: 'active session transcript cannot be deleted' });
              continue;
            }
          } else {
            const activeLogPath = logger.getLogFilePath();
            if (activeLogPath && absPath === resolve(activeLogPath)) {
              errors.push({ path: item.path, error: 'active log file cannot be deleted' });
              continue;
            }
          }
          freedBytes += s.isDir ? await dirSize(absPath) : s.size;
          removed.push(item.path);
        }
        return {
          success: true,
          dryRun: true,
          removed,
          errors,
          freedBytes,
          auditId: approvalId,
        } satisfies SystemDeleteItemsResult;
      }

      // Real deletion: require a valid approvalId matching a prior dry-run.
      const approvalId = typeof body.approvalId === 'string' ? body.approvalId : '';
      const cached = approvalId ? dryRunCache.get(approvalId) : undefined;
      if (!cached || cached.expiresAt <= Date.now()) {
        return {
          success: false,
          error: 'deleteItems requires a valid approvalId from a prior dry-run (expired or missing)',
          dryRun: false,
          removed: [],
          errors: [],
          freedBytes: 0,
        } satisfies SystemDeleteItemsResult;
      }
      // Verify the requested item set matches the dry-run set.
      const requestedIds = new Set(items.map((i) => i.id));
      for (const id of requestedIds) {
        if (!cached.itemIds.has(id)) {
          return {
            success: false,
            error: 'deleteItems item set does not match the dry-run approval',
            dryRun: false,
            removed: [],
            errors: [],
            freedBytes: 0,
          } satisfies SystemDeleteItemsResult;
        }
      }
      dryRunCache.delete(approvalId);

      const removed: string[] = [];
      const errors: Array<{ path: string; error: string }> = [];
      let freedBytes = 0;

      for (const item of items) {
        const result = await deleteSingleItem(item);
        if (result.removed) {
          removed.push(item.path);
          freedBytes += result.freedBytes;
        } else if (result.error) {
          errors.push({ path: item.path, error: result.error });
        }
      }

      // Audit the deletion.
      let auditId: string | undefined;
      try {
        const workspaceStub = await buildWorkspaceStub();
        const auditEvent = await recordPermissionAudit({
          workspace: workspaceStub as never,
          source: 'cleaner',
          risk: 'destructive',
          paths: removed,
          reason: 'Storage Cleaner deletion',
          paramsPreview: `removed ${removed.length} item(s), freed ${freedBytes} bytes`,
        });
        auditId = auditEvent.id;
      } catch (err) {
        logger.warn(`[system-api] audit recording failed: ${err}`);
      }

      logger.info(`[system-api] deleteItems: removed ${removed.length}, freed ${freedBytes} bytes, errors ${errors.length}`);

      return {
        success: errors.length === 0,
        error: errors.length > 0 ? `${errors.length} item(s) failed` : undefined,
        dryRun: false,
        removed,
        errors,
        freedBytes,
        auditId,
      } satisfies SystemDeleteItemsResult;
    },
  };
}
