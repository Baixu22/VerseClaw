import { app, nativeImage } from 'electron';
import crypto from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { FsSafeError, root as fsRoot } from '../../openclaw_runtime/src/infra/fs-safe';
import type {
  FilePreviewTreeNode,
  FilePreviewTreeOptions,
  FileReadBinaryOptions,
} from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { expandPath, getOpenClawConfigDir } from '../utils/paths';
import { isRecord } from './payload-utils';
import { isValidHtmlPreviewDocument, registerHtmlPreviewDocument } from '../main/html-preview-protocol';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
  recordPermissionDecisionEvent,
  recordPermissionAudit,
} from './permissions-api';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { createWorkspacePermissionDecisionEvent } from './permission-decision-audit';
import { decideWorkspaceFileWriteResolved, isApprovalRisk } from './workspace-permissions';
import {
  PathBrokerError,
  assertSafeHostFilePath,
  isPathInsideLexical,
  isResolvedPathInsideRoot,
  realpathOrResolve,
} from './path-broker';

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const OUTBOUND_DIR = join(getOpenClawConfigDir(), 'media', 'outbound');
const DIRECTORY_MIME_TYPE = 'application/x-directory';
const FILE_PREVIEW_MAX_TEXT_BYTES = 2 * 1024 * 1024;
const FILE_PREVIEW_MAX_BINARY_BYTES = 50 * 1024 * 1024;
const FILE_PREVIEW_TREE_MAX_DEPTH = 6;
const FILE_PREVIEW_TREE_MAX_NODES = 5000;
const FILE_PREVIEW_DIR_BLACKLIST = new Set([
  'node_modules',
  '.venv',
  '__pycache__',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

type StagePathsPayload = {
  filePaths?: unknown;
};

type StageBufferPayload = {
  base64?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
};

type PathPayload = {
  path?: unknown;
  content?: unknown;
  opts?: unknown;
  approvalId?: unknown;
};

type ResolvedSandboxedPath = {
  realPath: string;
  readOnly: boolean;
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })
        : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function requirePath(payload: unknown): string {
  const path = isRecord(payload) ? payload.path : payload;
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Invalid file path');
  }
  return path;
}

function isPathInside(child: string, parent: string): boolean {
  return isPathInsideLexical(child, parent);
}

function getFilePreviewWriteRoots(): string[] {
  const roots: string[] = [];
  roots.push(resolve(getOpenClawConfigDir()));
  try {
    roots.push(resolve(app.getPath('userData')));
  } catch {
    // ignore
  }
  roots.push(resolve(OUTBOUND_DIR));
  return roots;
}

async function getReadAllowlistRoots(): Promise<string[]> {
  const roots = getFilePreviewWriteRoots().map((root) => resolve(root));
  try {
    const workspace = await getActiveWorkspaceProfile();
    if (workspace?.rootPath) {
      roots.push(await realpathOrResolve(workspace.rootPath));
    }
  } catch {
    // no active workspace
  }
  return roots;
}

async function resolveSandboxedPath(
  input: string,
  mode: 'read' | 'write' = 'read',
): Promise<ResolvedSandboxedPath> {
  if (!input.trim()) {
    throw new Error('outsideSandbox');
  }
  let expanded: string;
  try {
    expanded = assertSafeHostFilePath(expandPath(input));
  } catch (error) {
    if (error instanceof PathBrokerError) {
      throw new Error(error.code, { cause: error });
    }
    throw new Error('outsideSandbox', { cause: error });
  }
  let real: string;
  try {
    real = await realpathOrResolve(expanded);
  } catch (error) {
    if (error instanceof PathBrokerError) {
      throw new Error(error.code, { cause: error });
    }
    real = resolve(expanded);
  }
  const writeRoots = getFilePreviewWriteRoots();
  if (writeRoots.some((root) => isPathInside(real, root))) {
    return { realPath: real, readOnly: false };
  }
  if (mode === 'write') {
    throw new Error('readOnlyRoot');
  }
  // P1-003 / F-SEC-004: reads limited to workspace + explicit write roots.
  const readRoots = await getReadAllowlistRoots();
  if (!readRoots.some((root) => isPathInside(real, root))) {
    throw new Error('outsideSandbox');
  }
  return { realPath: real, readOnly: true };
}

function looksLikeBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function shouldSkipDirEntry(name: string, includeHidden: boolean): boolean {
  if (FILE_PREVIEW_DIR_BLACKLIST.has(name)) return true;
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

function shouldSkipFileEntry(name: string, includeHidden: boolean): boolean {
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

function getTreeOptions(opts: unknown): FilePreviewTreeOptions {
  return isRecord(opts) ? opts as FilePreviewTreeOptions : {};
}

function getBinaryOptions(opts: unknown): FileReadBinaryOptions {
  return isRecord(opts) ? opts as FileReadBinaryOptions : {};
}

function normalizeApprovalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildFileWriteRequestHash(path: string, content: string): string {
  return `${resolve(path)}:${Buffer.byteLength(content, 'utf8')}`;
}

export function createFilesApi(): CompleteHostServiceRegistry['files'] {
  return {
    stagePaths: async (payload) => {
      const body = isRecord(payload) ? payload as StagePathsPayload : {};
      const filePaths = Array.isArray(body.filePaths)
        ? body.filePaths.filter((value): value is string => typeof value === 'string')
        : [];
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });

      const results = [];
      for (const filePath of filePaths) {
        const id = crypto.randomUUID();
        const fileName = basename(filePath);
        const sourceStat = await fsP.stat(filePath);
        if (sourceStat.isDirectory()) {
          results.push({
            id,
            fileName,
            mimeType: DIRECTORY_MIME_TYPE,
            fileSize: 0,
            stagedPath: filePath,
            preview: null,
          });
          continue;
        }

        const ext = extname(filePath);
        const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
        await fsP.copyFile(filePath, stagedPath);
        const s = await fsP.stat(stagedPath);
        const mimeType = getMimeType(ext);
        const preview = mimeType.startsWith('image/')
          ? await generateImagePreview(stagedPath, mimeType)
          : null;
        results.push({ id, fileName, mimeType, fileSize: s.size, stagedPath, preview });
      }
      return results;
    },
    stageBuffer: async (payload) => {
      const body = isRecord(payload) ? payload as StageBufferPayload : {};
      if (typeof body.base64 !== 'string' || typeof body.fileName !== 'string') {
        throw new Error('Invalid staged buffer payload');
      }
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });

      const id = crypto.randomUUID();
      const payloadMimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
      const ext = extname(body.fileName) || mimeToExt(payloadMimeType);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      const buffer = Buffer.from(body.base64, 'base64');
      await fsP.writeFile(stagedPath, buffer);

      const mimeType = payloadMimeType || getMimeType(ext);
      const preview = mimeType.startsWith('image/')
        ? await generateImagePreview(stagedPath, mimeType)
        : null;
      return {
        id,
        fileName: body.fileName,
        mimeType,
        fileSize: buffer.length,
        stagedPath,
        preview,
      };
    },
    readText: async (payload) => {
      try {
        const { realPath: real, readOnly } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        if (stat.size > FILE_PREVIEW_MAX_TEXT_BYTES) return { ok: false, error: 'tooLarge', size: stat.size };
        const buf = await fsP.readFile(real);
        if (looksLikeBinary(buf)) return { ok: false, error: 'binary', size: stat.size };
        return {
          ok: true,
          content: buf.toString('utf8'),
          mimeType: getMimeType(extname(real)),
          size: stat.size,
          readOnly,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox' || message === 'unsafePath' || message === 'devicePath' || message === 'uncPath' || message === 'adsPath' || message === 'pathTooLong') return { ok: false, error: message === 'outsideSandbox' ? 'outsideSandbox' : message };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    readBinary: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as PathPayload : {};
        const opts = getBinaryOptions(body.opts);
        const { realPath: real, readOnly } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : undefined;
        const cap = Math.max(1, Math.min(maxBytes ?? FILE_PREVIEW_MAX_BINARY_BYTES, FILE_PREVIEW_MAX_BINARY_BYTES));
        if (stat.size > cap) return { ok: false, error: 'tooLarge', size: stat.size };
        const buf = await fsP.readFile(real);
        const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return {
          ok: true,
          data: view,
          mimeType: getMimeType(extname(real)),
          size: stat.size,
          readOnly,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox' || message === 'unsafePath' || message === 'devicePath' || message === 'uncPath' || message === 'adsPath' || message === 'pathTooLong') return { ok: false, error: message === 'outsideSandbox' ? 'outsideSandbox' : message };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    writeText: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as PathPayload : {};
        if (typeof body.content !== 'string') return { ok: false, error: 'invalidContent' };
        if (Buffer.byteLength(body.content, 'utf8') > FILE_PREVIEW_MAX_TEXT_BYTES) {
          return { ok: false, error: 'tooLarge' };
        }
        const requestedPath = requirePath(payload);
        const approvalId = normalizeApprovalId(body.approvalId);
        const workspace = await getActiveWorkspaceProfile();
        let approvedByRequest = false;
        let decision: Awaited<ReturnType<typeof decideWorkspaceFileWriteResolved>> | null = null;
        if (workspace) {
          decision = await decideWorkspaceFileWriteResolved(requestedPath, workspace);
          void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
            workspaceMode: workspace.permissionMode,
            tool: 'files.writeText',
            boundary: 'user-file',
            requestId: approvalId ?? buildFileWriteRequestHash(requestedPath, body.content),
            decision,
          }));
          if (!decision.allowed) {
            if (decision.requiresApproval && isApprovalRisk(decision.risk)) {
              const requestHash = buildFileWriteRequestHash(requestedPath, body.content);
              if (approvalId) {
                const approved = await consumeApprovedPermissionApproval({
                  id: approvalId,
                  workspaceId: workspace.id,
                  source: 'file',
                  paths: [requestedPath],
                  requestHash,
                });
                if (!approved) {
                  return { ok: false, error: 'approvalRequired' };
                }
                approvedByRequest = true;
              } else {
                const approval = await createPermissionApproval({
                  workspace,
                  source: 'file',
                  risk: decision.risk,
                  paths: [requestedPath],
                  requestHash,
                  paramsPreview: `${requestedPath} (${Buffer.byteLength(body.content, 'utf8')} bytes)`,
                  reason: decision.reason,
                });
                return { ok: false, error: 'approvalRequired', approvalRequired: true, approval };
              }
            }
            if (!approvedByRequest) {
              return { ok: false, error: 'permissionDenied' };
            }
          }
          if (workspace.permissionMode === 'fullAccess' && decision.risk === 'external-write') {
            void recordPermissionAudit({
              workspace,
              source: 'file',
              risk: decision.risk,
              paths: [requestedPath],
              requestHash: buildFileWriteRequestHash(requestedPath, body.content),
              paramsPreview: `${requestedPath} (${Buffer.byteLength(body.content, 'utf8')} bytes)`,
              reason: 'External file write under fullAccess mode',
            });
          }
        }
        let real: string;
        try {
          assertSafeHostFilePath(expandPath(requestedPath));
          real = workspace
            ? await realpathOrResolve(requestedPath)
            : (await resolveSandboxedPath(requestedPath, 'write')).realPath;
        } catch (error) {
          if (error instanceof PathBrokerError) {
            return { ok: false, error: error.code };
          }
          throw error;
        }
        if (workspace) {
          // Re-check after realpath so workspace junctions cannot escape (F-SEC-006).
          // Do not re-open the approval prompt for intentional external writes that were
          // already approved (or classified as external-write under fullAccess).
          const stillInside = await isResolvedPathInsideRoot(real, workspace.rootPath);
          if (!stillInside && workspace.permissionMode !== 'fullAccess') {
            const authorizedExternal =
              approvedByRequest
              || decision?.risk === 'external-write';
            if (!authorizedExternal) {
              // Lexical/pre-check thought this was an in-workspace write, but realpath escaped.
              return { ok: false, error: 'outsideSandbox' };
            }
          }
        }
        const fsP = await import('node:fs/promises');
        let stat;
        try {
          stat = await fsP.stat(real);
        } catch {
          return { ok: false, error: 'notFound' };
        }
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        const workspaceRoot = workspace ? await realpathOrResolve(workspace.rootPath) : undefined;
        const writeRoot = workspaceRoot && isPathInside(real, workspaceRoot) ? workspaceRoot : dirname(real);
        const guarded = await fsRoot(writeRoot);
        // Keep the canonical target literal: fs-safe expands relative ~ segments.
        // The verified handle preserves the inode, ACLs and existing readers.
        const opened = await guarded.openWritable(real, { mkdir: false, writeMode: 'replace' });
        try {
          await opened.handle.writeFile(body.content, 'utf8');
        } finally {
          await opened.handle.close();
        }
        return { ok: true };
      } catch (err) {
        if (err instanceof FsSafeError) {
          if (err.code === 'not-found' || err.code === 'not-file') return { ok: false, error: 'notFound' };
          if (err.code === 'outside-workspace') return { ok: false, error: 'outsideSandbox' };
          if (['path-alias', 'hardlink', 'symlink', 'path-mismatch', 'invalid-path', 'denied-path'].includes(err.code)) {
            return { ok: false, error: 'unsafePath' };
          }
        }
        if (err instanceof PathBrokerError) {
          return { ok: false, error: err.code };
        }
        const message = err instanceof Error ? err.message : String(err);
        if (
          message === 'outsideSandbox'
          || message === 'unsafePath'
          || message === 'devicePath'
          || message === 'uncPath'
          || message === 'adsPath'
          || message === 'pathTooLong'
          || message === 'readOnlyRoot'
        ) {
          return { ok: false, error: message };
        }
        return { ok: false, error: message };
      }
    },
    stat: async (payload) => {
      try {
        const { realPath: real, readOnly } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        return {
          ok: true,
          size: stat.size,
          mtime: stat.mtimeMs,
          isFile: stat.isFile(),
          isDir: stat.isDirectory(),
          readOnly,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox' || message === 'unsafePath' || message === 'devicePath' || message === 'uncPath' || message === 'adsPath' || message === 'pathTooLong') return { ok: false, error: message === 'outsideSandbox' ? 'outsideSandbox' : message };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    listDir: async (payload) => {
      try {
        const { realPath: real } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const dirents = await fsP.readdir(real, { withFileTypes: true });
        const entries = await Promise.all(dirents.map(async (entry) => {
          const abs = join(real, entry.name);
          let size = 0;
          try {
            if (entry.isFile()) size = (await fsP.stat(abs)).size;
          } catch {
            // non-fatal
          }
          return {
            name: entry.name,
            path: abs,
            isDir: entry.isDirectory(),
            size,
          };
        }));
        return { ok: true, entries };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox' || message === 'unsafePath' || message === 'devicePath' || message === 'uncPath' || message === 'adsPath' || message === 'pathTooLong') return { ok: false, error: message === 'outsideSandbox' ? 'outsideSandbox' : message };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    listTree: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as PathPayload : {};
        const opts = getTreeOptions(body.opts);
        const { realPath: real } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        if (!stat.isDirectory()) return { ok: false, error: 'notDirectory' };
        const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? FILE_PREVIEW_TREE_MAX_DEPTH, 12));
        const maxNodes = Math.max(1, Math.min(opts.maxNodes ?? FILE_PREVIEW_TREE_MAX_NODES, 50000));
        const includeHidden = !!opts.includeHidden;

        let nodeCount = 0;
        let truncated = false;

        const walk = async (absDir: string, depth: number): Promise<FilePreviewTreeNode[] | undefined> => {
          if (depth > maxDepth || truncated) return undefined;
          let dirents;
          try {
            dirents = await fsP.readdir(absDir, { withFileTypes: true });
          } catch {
            return [];
          }
          const children: FilePreviewTreeNode[] = [];
          for (const entry of dirents) {
            if (truncated) break;
            const isDir = entry.isDirectory();
            const isFile = entry.isFile();
            if (!isDir && !isFile) continue;
            if (isDir && shouldSkipDirEntry(entry.name, includeHidden)) continue;
            if (isFile && shouldSkipFileEntry(entry.name, includeHidden)) continue;
            if (nodeCount >= maxNodes) {
              truncated = true;
              break;
            }
            nodeCount += 1;
            const abs = join(absDir, entry.name);
            const node: FilePreviewTreeNode = {
              name: entry.name,
              relPath: relative(real, abs).split(sep).join('/'),
              absPath: abs,
              isDir,
            };
            if (isFile) {
              try {
                const fstat = await fsP.stat(abs);
                node.size = fstat.size;
                node.mtime = fstat.mtimeMs;
              } catch {
                // non-fatal
              }
            } else {
              try {
                node.mtime = (await fsP.stat(abs)).mtimeMs;
              } catch {
                // non-fatal
              }
              node.children = await walk(abs, depth + 1) ?? [];
            }
            children.push(node);
          }
          children.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          return children;
        };

        const root: FilePreviewTreeNode = {
          name: basename(real) || real,
          relPath: '',
          absPath: real,
          isDir: true,
          mtime: stat.mtimeMs,
          children: (await walk(real, 1)) ?? [],
        };
        return { ok: true, root, truncated };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox' || message === 'unsafePath' || message === 'devicePath' || message === 'uncPath' || message === 'adsPath' || message === 'pathTooLong') return { ok: false, error: message === 'outsideSandbox' ? 'outsideSandbox' : message };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    registerHtmlPreview: async (payload) => {
      const html = isRecord(payload) ? (payload as { html?: unknown }).html : undefined;
      if (typeof html !== 'string' || html.length === 0) return { ok: false, error: 'invalidContent' };
      if (!isValidHtmlPreviewDocument(html)) return { ok: false, error: 'tooLarge' };
      return { ok: true, url: registerHtmlPreviewDocument(html) };
    },
  };
}
