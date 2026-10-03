import { createHash } from "node:crypto";

export const VERSESHELL_GOVERNED_EXEC_PROFILE_ID = "clawx-governed-exec-v1" as const;
export const VERSESHELL_READONLY_FACADE_PROFILE_ID = "clawx-readonly-facade-v1" as const;
export const VERSESHELL_PATCH_PREVIEW_PROFILE_ID = "clawx-patch-preview-v1" as const;

export type VerseShellPolicyProfileId =
  | typeof VERSESHELL_GOVERNED_EXEC_PROFILE_ID
  | typeof VERSESHELL_READONLY_FACADE_PROFILE_ID
  | typeof VERSESHELL_PATCH_PREVIEW_PROFILE_ID;

export type ResolvedVerseShellPolicyProfile = Readonly<{
  id: VerseShellPolicyProfileId;
  digest: `sha256:${string}`;
  capabilities: readonly string[];
  definition: Readonly<Record<string, unknown>>;
}>;

const GOVERNED_EXEC_DEFINITION = Object.freeze({
  schema_version: 1,
  id: VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
  transport: {
    protocol: "verseshell.jsonl/v1",
    operation: "exec.run",
  },
  runtime: {
    mode: "agent_strict",
    capabilities: ["shell.exec"],
    workspace_jail: true,
    approval: "action-bound-token",
  },
  host: {
    command_policy: "openclaw-resolved-exec-policy",
    approval_before_retry: true,
    native_fallback: false,
  },
  output: {
    profile: "auto",
    artifact: "auto",
    bounded_observation: true,
  },
} as const);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const GOVERNED_EXEC_PROFILE = Object.freeze({
  id: VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
  digest: `sha256:${createHash("sha256").update(canonicalJson(GOVERNED_EXEC_DEFINITION)).digest("hex")}`,
  capabilities: Object.freeze(["shell.exec"] as const),
  definition: GOVERNED_EXEC_DEFINITION,
}) satisfies ResolvedVerseShellPolicyProfile;

const READONLY_FACADE_DEFINITION = Object.freeze({
  schema_version: 1,
  id: VERSESHELL_READONLY_FACADE_PROFILE_ID,
  transport: {
    protocol: "verseshell.jsonl/v1",
    operations: ["file.view", "repo.search", "result.query"],
  },
  runtime: {
    mode: "agent_strict",
    // The pinned catalog classifies result.query as shell.exec; the adapter
    // never exposes exec.run through this client.
    capabilities: ["file.read", "shell.exec"],
    workspace_jail: true,
    approval: "read-only",
  },
  host: {
    command_policy: "none",
    approval_before_retry: false,
    native_fallback: false,
  },
  output: {
    profile: "bounded",
    artifact: "query-only",
    bounded_observation: true,
  },
} as const);

const READONLY_FACADE_PROFILE = Object.freeze({
  id: VERSESHELL_READONLY_FACADE_PROFILE_ID,
  digest: `sha256:${createHash("sha256").update(canonicalJson(READONLY_FACADE_DEFINITION)).digest("hex")}`,
  capabilities: Object.freeze(["file.read", "shell.exec"] as const),
  definition: READONLY_FACADE_DEFINITION,
}) satisfies ResolvedVerseShellPolicyProfile;

const PATCH_PREVIEW_DEFINITION = Object.freeze({
  schema_version: 1,
  id: VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
  transport: {
    protocol: "verseshell.jsonl/v1",
    operations: ["file.diff", "file.hash", "file.read_range"],
  },
  runtime: {
    mode: "agent_strict",
    capabilities: ["file.read"],
    workspace_jail: true,
    approval: "read-only",
  },
  host: {
    command_policy: "none",
    approval_before_retry: false,
    native_fallback: false,
    // The pinned catalog ships its own mutation and transaction owner
    // (file.apply_patch plus tx.*, backed by a VerseShell journal directory and
    // trash restore tokens). The preview bridge must never reach it: the ClawX
    // write journal stays the only commit/undo/stale-guard/recovery authority.
    commit_authority: "clawx-write-journal",
    denied_operations: [
      "file.apply_patch",
      "file.copy",
      "file.delete",
      "file.edit_range",
      "file.move",
      "file.remove",
      "file.replace_exact",
      "file.write",
      "tx.begin",
      "tx.commit",
      "tx.restore",
      "tx.rollback",
      "tx.savepoint",
      "tx.status",
    ],
  },
  output: {
    profile: "bounded",
    artifact: "query-only",
    bounded_observation: true,
  },
} as const);

const PATCH_PREVIEW_PROFILE = Object.freeze({
  id: VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
  digest: `sha256:${createHash("sha256").update(canonicalJson(PATCH_PREVIEW_DEFINITION)).digest("hex")}`,
  capabilities: Object.freeze(["file.read"] as const),
  definition: PATCH_PREVIEW_DEFINITION,
}) satisfies ResolvedVerseShellPolicyProfile;

/** Operations the preview bridge is allowed to request, in canonical order. */
export const VERSESHELL_PATCH_PREVIEW_OPERATIONS: readonly string[] =
  PATCH_PREVIEW_DEFINITION.transport.operations;

/** Mutation and transaction operations that must stay unreachable from the bridge. */
export const VERSESHELL_PATCH_PREVIEW_DENIED_OPERATIONS: readonly string[] =
  PATCH_PREVIEW_DEFINITION.host.denied_operations;

const PROFILES: Readonly<Record<VerseShellPolicyProfileId, ResolvedVerseShellPolicyProfile>> =
  Object.freeze({
    [VERSESHELL_GOVERNED_EXEC_PROFILE_ID]: GOVERNED_EXEC_PROFILE,
    [VERSESHELL_READONLY_FACADE_PROFILE_ID]: READONLY_FACADE_PROFILE,
    [VERSESHELL_PATCH_PREVIEW_PROFILE_ID]: PATCH_PREVIEW_PROFILE,
  });

/** Resolve only repository-reviewed policy profiles; callers cannot supply policy digests. */
export function resolveVerseShellPolicyProfile(
  id: VerseShellPolicyProfileId,
): ResolvedVerseShellPolicyProfile {
  const profile = PROFILES[id];
  if (!profile) {
    throw new Error(`Unsupported VerseShell policy profile: ${String(id)}`);
  }
  return profile;
}

