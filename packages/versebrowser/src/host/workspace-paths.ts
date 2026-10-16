import { sanitizeSegment } from '../evidence/path-guard.ts';
/**
 * Workspace jail paths — Evidence / session metadata bind to the project workspace.
 *
 * Default layout (TF-0017 / docs/browser-ops.md §6):
 *   <workspace>/.ae/evidence/    Evidence Packs, screenshots, verify/record/diagnose
 *   <workspace>/.ae/sessions/    session metadata + timeline
 *
 * Authority order for workspace root:
 *   1. setWorkspaceRoot() / setWorkspaceRootProvider() (host inject)
 *   2. VERSEBROWSER_WORKSPACE env
 *   3. process.cwd()
 */
import { isAbsolute, join, relative, resolve } from 'node:path';

export const WORKSPACE_AE_DIR = '.ae' as const;
export const WORKSPACE_EVIDENCE_DIR = 'evidence' as const;
export const WORKSPACE_SESSIONS_DIR = 'sessions' as const;

export type WorkspaceRootProvider = () => string | null | undefined;

let pinnedRoot: string | undefined;
let rootProvider: WorkspaceRootProvider = () => undefined;

/** Host-injectable workspace root (highest priority when set). */
export function setWorkspaceRoot(root: string | undefined | null): void {
  pinnedRoot = root ? resolve(root) : undefined;
}

/** Host-injectable resolver; used when no root is pinned. */
export function setWorkspaceRootProvider(provider: WorkspaceRootProvider | null): void {
  rootProvider = provider ?? (() => undefined);
}

/**
 * Resolve the active workspace root.
 * Explicit override → provider → VERSEBROWSER_WORKSPACE → cwd.
 */
export function getWorkspaceRoot(override?: string): string {
  if (override) return resolve(override);
  if (pinnedRoot) return pinnedRoot;
  const provided = rootProvider();
  if (provided) return resolve(provided);
  const env = process.env.VERSEBROWSER_WORKSPACE;
  if (env && env.trim()) return resolve(env.trim());
  return resolve(process.cwd());
}

/** `<workspace>/.ae/evidence` — authoritative Evidence Pack root. */
export function getWorkspaceEvidenceRoot(overrideRoot?: string): string {
  return join(getWorkspaceRoot(overrideRoot), WORKSPACE_AE_DIR, WORKSPACE_EVIDENCE_DIR);
}

/** `<workspace>/.ae/sessions` — session metadata / timeline root. */
export function getWorkspaceSessionsRoot(overrideRoot?: string): string {
  return join(getWorkspaceRoot(overrideRoot), WORKSPACE_AE_DIR, WORKSPACE_SESSIONS_DIR);
}

/** `<workspace>/.ae/sessions/<sessionId>` */
export function getWorkspaceSessionDir(sessionId: string, overrideRoot?: string): string {
  return join(getWorkspaceSessionsRoot(overrideRoot), sanitizeSegment(sessionId, 'item'));
}

/** `<workspace>/.ae/evidence/<packId>` */
export function getWorkspaceEvidencePackDir(packId: string, overrideRoot?: string): string {
  return join(getWorkspaceEvidenceRoot(overrideRoot), sanitizeSegment(packId, 'item'));
}

/**
 * Prefer workspace-relative path for EvidenceRef / summaries.
 * Returns null when the path is outside the workspace (caller keeps absolute).
 */
export function toWorkspaceRelative(absolutePath: string, overrideRoot?: string): string | null {
  const root = getWorkspaceRoot(overrideRoot);
  const abs = resolve(absolutePath);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  // Normalize to posix-style separators in refs for stable cross-OS summaries.
  return rel.split('\\').join('/');
}
