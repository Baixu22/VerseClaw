/**
 * Remote evidence index + capability policy distribution (TF-0060).
 *
 * Scope (user decision 2026-09-24): remote **Evidence index / policy push** —
 * NOT a cloud browser, NOT remote page control.
 *
 * - Evidence index: metadata-only catalog of packs under the workspace jail.
 *   Paths are workspace-relative; payloads / screenshots / HAR stay local.
 * - Policy bundle: versioned tool-group + capability grants for team push.
 *   Apply path is fail-closed (unknown caps rejected, wildcards forbidden).
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getWorkspaceEvidenceRoot,
  toWorkspaceRelative,
} from '../host/workspace-paths.ts';
import type { EvidencePackManifest } from '../evidence/schema.ts';
import {
  McpPolicyError,
  capabilitiesForGroups,
  resolveMcpPolicy,
  type McpCapability,
  type McpPolicy,
  type McpToolGroup,
} from '../mcp/capability-policy.ts';

export const REMOTE_INDEX_SCHEMA_VERSION = 1 as const;
export const POLICY_BUNDLE_SCHEMA_VERSION = 1 as const;

export type EvidenceIndexEntry = {
  packId: string;
  label: string;
  schemaVersion: number;
  createdAt: string;
  sessionId?: string;
  /** Workspace-relative file paths only. */
  files: Array<{ path: string; kind?: string; size?: number }>;
  /** Always true — index never embeds payloads. */
  metadataOnly: true;
};

export type EvidenceIndex = {
  schemaVersion: typeof REMOTE_INDEX_SCHEMA_VERSION;
  generatedAt: string;
  /** Workspace label, or the workspace-relative evidence root. Never an absolute local path. */
  workspace: string;
  packs: EvidenceIndexEntry[];
};

export type PolicyBundle = {
  schemaVersion: typeof POLICY_BUNDLE_SCHEMA_VERSION;
  /** Semver-ish free string for team rollout. */
  version: string;
  /** Issuer identity (team / harness / human). */
  issuer: string;
  issuedAt: string;
  expiresAt?: string;
  groups: readonly McpToolGroup[];
  /** Optional explicit caps; when omitted, expanded from groups. */
  capabilities?: readonly McpCapability[];
  notes?: string;
};

export type PolicyApplyResult =
  | { ok: true; policy: McpPolicy; expandedCapabilities: McpCapability[] }
  | { ok: false; code: string; message: string };

function now(): string {
  return new Date().toISOString();
}

/**
 * Scan workspace evidence packs and build a metadata-only index.
 * Never includes file bodies; paths are workspace-relative.
 */
export async function buildEvidenceIndex(
  options: { evidenceRoot?: string; workspaceLabel?: string } = {},
): Promise<EvidenceIndex> {
  const root = options.evidenceRoot ?? getWorkspaceEvidenceRoot();
  // The index is made to be pushed off the machine: never embed the local absolute
  // evidence root. Prefer the caller's label, then the workspace-relative form; an
  // explicit evidenceRoot outside the jail has no honest relative form, so refuse it
  // instead of quietly carrying an absolute local path off the machine.
  const relativeRoot = toWorkspaceRelative(root);
  const workspace = options.workspaceLabel ?? relativeRoot;
  if (workspace === null || workspace === undefined) {
    throw new McpPolicyError(
      'E_EVIDENCE_WRITE',
      'evidence root ' + root + ' is outside the workspace; pass workspaceLabel so the pushed index stays workspace-relative',
    );
  }
  const packs: EvidenceIndexEntry[] = [];

  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    names = [];
  }

  for (const name of names) {
    const dir = join(root, name);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(dir, 'manifest.json');
    let manifest: EvidencePackManifest | undefined;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as EvidencePackManifest;
    } catch {
      continue;
    }
    if (!manifest?.packId) continue;

    const files: EvidenceIndexEntry['files'] = [];
    for (const file of manifest.files ?? []) {
      const abs = join(dir, file.path);
      const rel = toWorkspaceRelative(abs) ?? file.path;
      files.push({
        path: rel,
        ...(file.kind ? { kind: file.kind } : {}),
        ...(file.size !== undefined ? { size: file.size } : {}),
      });
    }

    packs.push({
      packId: manifest.packId,
      label: manifest.label ?? manifest.packId,
      schemaVersion: manifest.schemaVersion ?? 1,
      createdAt: manifest.createdAt ?? now(),
      ...(manifest.sessionId ? { sessionId: manifest.sessionId } : {}),
      files,
      metadataOnly: true,
    });
  }

  packs.sort((a, b) => a.packId.localeCompare(b.packId));
  return {
    schemaVersion: REMOTE_INDEX_SCHEMA_VERSION,
    generatedAt: now(),
    workspace,
    packs,
  };
}

export async function writeEvidenceIndex(index: EvidenceIndex, path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(index, null, 2), 'utf8');
}

export async function readEvidenceIndex(path: string): Promise<EvidenceIndex> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as EvidenceIndex;
  if (parsed.schemaVersion !== REMOTE_INDEX_SCHEMA_VERSION) {
    throw new McpPolicyError(
      'E_EVIDENCE_WRITE',
      `unsupported evidence index schemaVersion=${String(parsed.schemaVersion)}`,
    );
  }
  if (!Array.isArray(parsed.packs)) {
    throw new McpPolicyError('E_EVIDENCE_WRITE', 'evidence index packs must be an array');
  }
  return parsed;
}

/** Serialize a policy bundle for team push (JSON file / gist / artifact). */
export function serializePolicyBundle(bundle: PolicyBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Apply a remote policy bundle into a local McpPolicy.
 * Fail-closed: unknown groups/caps, wildcards, expired bundles → reject.
 * Does **not** widen beyond the bundle; empty bundle stays deny-by-default.
 */
export function applyPolicyBundle(
  bundle: PolicyBundle,
  options: { nowMs?: number } = {},
): PolicyApplyResult {
  if (bundle.schemaVersion !== POLICY_BUNDLE_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'E_CAPABILITY_CONFIG',
      message: `unsupported policy bundle schemaVersion=${String(bundle.schemaVersion)}`,
    };
  }
  const at = options.nowMs ?? Date.now();
  // An unparseable expiry used to slip through: Date.parse() returns NaN and `NaN <= at` is
  // always false, so a bundle whose expiresAt was malformed was treated as *never expiring* -
  // a fail-open on a policy-distribution entry point. A stated expiry that cannot be read is
  // refused rather than silently ignored (omitting expiresAt still means no expiry).
  if (bundle.expiresAt !== undefined && bundle.expiresAt !== null) {
    const expiresAt = Date.parse(String(bundle.expiresAt));
    if (!Number.isFinite(expiresAt)) {
      return {
        ok: false,
        code: 'E_EXPIRED',
        message: `policy bundle has an unreadable expiresAt: ${String(bundle.expiresAt)}`,
      };
    }
    if (expiresAt <= at) {
      return {
        ok: false,
        code: 'E_EXPIRED',
        message: `policy bundle expired at ${String(bundle.expiresAt)}`,
      };
    }
  }

  // The bundle travels as JSON, so its shape is not guaranteed by the TS type. This call
  // contract is a `PolicyApplyResult`, never a throw: a malformed `groups`/`capabilities` used to
  // escape as `TypeError: (bundle.groups ?? []).join is not a function`, skipping the
  // `if (!result.ok) throw new Error(result.message)` branch the docs tell receivers to write.
  if (bundle.groups !== undefined && !Array.isArray(bundle.groups)) {
    return { ok: false, code: 'E_GROUP_CONFIG', message: 'policy bundle groups must be an array' };
  }
  if (bundle.capabilities !== undefined && !Array.isArray(bundle.capabilities)) {
    return { ok: false, code: 'E_CAPABILITY_CONFIG', message: 'policy bundle capabilities must be an array' };
  }
  const groupList = (bundle.groups ?? []).join(',');
  let capabilities: McpCapability[];
  try {
    if (bundle.capabilities && bundle.capabilities.length > 0) {
      // Explicit caps must be valid; still respect group expansion as minimum.
      const fromGroups = capabilitiesForGroups(bundle.groups ?? []);
      const explicit = bundle.capabilities;
      for (const cap of explicit) {
        if (cap === ('all' as string) || cap === ('*' as string)) {
          return {
            ok: false,
            code: 'E_CAPABILITY_CONFIG',
            message: 'wildcard capability grants are forbidden',
          };
        }
      }
      // Validate via resolve (throws on unknown).
      resolveMcpPolicy({ groups: groupList, caps: explicit.join(',') });
      capabilities = [...new Set([...fromGroups, ...explicit])];
    } else {
      const expanded = capabilitiesForGroups(bundle.groups ?? []);
      resolveMcpPolicy({ groups: groupList, caps: expanded.join(',') });
      capabilities = expanded;
    }
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return {
      ok: false,
      code: e.code ?? 'E_CAPABILITY_CONFIG',
      message: e.message ?? 'invalid policy bundle',
    };
  }

  const policy = resolveMcpPolicy({
    groups: groupList,
    caps: capabilities.join(','),
  });
  return { ok: true, policy, expandedCapabilities: capabilities };
}

/** Convenience builder for a minimal team default (debug + evidence read). */
export function createDefaultPolicyBundle(options: {
  version: string;
  issuer: string;
  groups: readonly McpToolGroup[];
  capabilities?: readonly McpCapability[];
  expiresAt?: string;
  notes?: string;
}): PolicyBundle {
  return {
    schemaVersion: POLICY_BUNDLE_SCHEMA_VERSION,
    version: options.version,
    issuer: options.issuer,
    issuedAt: now(),
    groups: options.groups,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
  };
}
