/**
 * P4-002: Agent Browser filesystem boundary helpers.
 * Keep downloads/uploads/artifacts inside the agent-browser root under userData.
 */
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** Reject path traversal / absolute segments in logical ids (runId, sessionId, profile). */
export function sanitizeAgentBrowserPathSegment(value: unknown, label = "path segment"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Agent browser ${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`Agent browser ${label} is invalid`);
  }
  if (!SAFE_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Agent browser ${label} contains illegal characters`);
  }
  if (trimmed.length > 128) {
    throw new Error(`Agent browser ${label} is too long`);
  }
  return trimmed;
}

/** Resolve a path under root and fail if it escapes the root (after normalization). */
export function resolvePathWithinRoot(rootDir: string, ...parts: string[]): string {
  const root = resolve(rootDir);
  const candidate = resolve(root, ...parts);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Agent browser path escapes filesystem boundary");
  }
  // Normalize separators for stable comparisons in tests / logs.
  return normalize(candidate);
}

/** Build the canonical agent-browser root under userData. */
export function agentBrowserRootDir(userDataPath: string): string {
  return resolve(userDataPath, "agent-browser");
}

export function agentBrowserRunArtifactDir(userDataPath: string, runId: unknown): string {
  const safeRunId = sanitizeAgentBrowserPathSegment(runId, "runId");
  return resolvePathWithinRoot(agentBrowserRootDir(userDataPath), "run-artifacts", safeRunId);
}

export function agentBrowserScreenshotDir(userDataPath: string, sessionId: unknown): string {
  const safeSessionId = sanitizeAgentBrowserPathSegment(sessionId, "sessionId");
  return resolvePathWithinRoot(agentBrowserRootDir(userDataPath), "screenshots", safeSessionId);
}

export function agentBrowserProfilePartition(profile: string): string {
  const safe = sanitizeAgentBrowserPathSegment(profile, "profile");
  return `persist:agent-browser-${safe}`;
}

/** True when candidate is strictly inside root (or equals root). */
export function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const root = resolve(rootDir);
  const candidate = resolve(candidatePath);
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function joinWithinRoot(rootDir: string, ...parts: string[]): string {
  return resolvePathWithinRoot(rootDir, ...parts);
}

// Keep sep referenced so Windows/posix tests can import if needed.
export const PATH_SEP = sep;
export const joinPath = join;
