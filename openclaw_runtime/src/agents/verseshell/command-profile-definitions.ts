/**
 * Bounded execution profiles for the governed VerseShell route.
 *
 * These are classification and bound declarations only. A profile never grants
 * write authority; the existing exec approval pipeline remains the sole
 * authorization surface.
 */

export const VERSESHELL_COMMAND_PROFILE_IDS = [
  "generic",
  "test",
  "build",
  "lint",
  "git",
  "terminal-shell",
] as const;

export type VerseShellCommandProfile = (typeof VERSESHELL_COMMAND_PROFILE_IDS)[number];
export type VerseShellCommandPlanMode = "argv" | "explicit-shell";

export type VerseShellCommandProfileDefinition = {
  id: VerseShellCommandProfile;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  cwdPolicy: "workspace-relative";
  envPolicy: "host-sanitized";
  /** Classification only; P2-02 does not grant write authority. */
  writePolicy: "deny-unless-policy" | "external-write-visible";
  declaredWriteDirs: readonly string[];
};

const PROFILE_DEFINITIONS: Readonly<
  Record<VerseShellCommandProfile, VerseShellCommandProfileDefinition>
> = {
  generic: {
    id: "generic",
    maxTimeoutMs: 10 * 60 * 1000,
    maxOutputBytes: 8 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [],
  },
  test: {
    id: "test",
    maxTimeoutMs: 30 * 60 * 1000,
    maxOutputBytes: 32 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [".cache", ".pytest_cache", "coverage", "test-results"],
  },
  build: {
    id: "build",
    maxTimeoutMs: 60 * 60 * 1000,
    maxOutputBytes: 32 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [".cache", "build", "dist", "out", "target"],
  },
  lint: {
    id: "lint",
    maxTimeoutMs: 20 * 60 * 1000,
    maxOutputBytes: 16 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [".cache"],
  },
  git: {
    id: "git",
    maxTimeoutMs: 10 * 60 * 1000,
    maxOutputBytes: 16 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [],
  },
  "terminal-shell": {
    id: "terminal-shell",
    maxTimeoutMs: 30 * 60 * 1000,
    maxOutputBytes: 32 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "external-write-visible",
    declaredWriteDirs: [],
  },
};

export function getVerseShellCommandProfileDefinition(
  profile: VerseShellCommandProfile,
): VerseShellCommandProfileDefinition {
  return PROFILE_DEFINITIONS[profile];
}
