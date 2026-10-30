import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  ChangeContextReviewAnchorRevision,
  ChangeContextReviewCommentAnchor,
} from '@shared/types/change-context';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { isPathInsideWorkspaceResolved, requireWorkspace } from './workspace-permissions';

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digestRange(lines: string[], range: ChangeContextReviewCommentAnchor['range']): string | null {
  const selected = lines.slice(range.startLine - 1, range.endLine);
  if (selected.length !== range.endLine - range.startLine + 1) return null;
  return sha256(selected.join('\n'));
}

export async function resolveWorkspaceReviewAnchor(
  anchor: ChangeContextReviewCommentAnchor,
): Promise<ChangeContextReviewAnchorRevision | null> {
  const workspace = requireWorkspace(await getActiveWorkspaceProfile());
  const root = resolve(workspace.rootPath);
  const absolutePath = resolve(root, anchor.path);
  const rel = relative(root, absolutePath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  if (!(await isPathInsideWorkspaceResolved(absolutePath, root))) return null;

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }

  const contentForDigest = content.endsWith('\n') ? content.slice(0, -1) : content;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const rangeDigest = digestRange(lines, anchor.range);
  if (!rangeDigest) return null;
  return {
    kind: 'source-snapshot',
    revisionId: `workspace:${anchor.path}:${sha256(contentForDigest).slice('sha256:'.length, 'sha256:'.length + 16)}`,
    fileDigest: sha256(contentForDigest),
    rangeDigest,
  };
}
