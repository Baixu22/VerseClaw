import fs from "node:fs/promises";
import path from "node:path";
import {
  isExternalOrUnknownProvenance,
  provenanceStatus,
  type ContentProvenanceContext,
  type ProvenanceStatus,
} from "../../../shared/security/content-provenance.js";
import { canonicalPathFromExistingAncestor } from "../infra/fs-safe.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { assertSandboxPath } from "./sandbox-paths.js";

export type WorkspaceExternalWriteAction = "write" | "edit" | "apply_patch";

export type WorkspaceExternalWriteTargetScope = {
  workspaceRoot?: string;
  targetPaths: readonly string[];
  /** False means the caller could not safely determine every mutation target. */
  scopeKnown: boolean;
};

export type WorkspaceExternalWritePolicyInput = {
  action: WorkspaceExternalWriteAction;
  provenanceContext?: ContentProvenanceContext;
  workspaceRoot: string;
  targetPaths: readonly string[];
  scopeKnown: boolean;
};

export type WorkspaceExternalWritePolicyResult = {
  status: ProvenanceStatus;
  allowed: boolean;
  restricted: boolean;
  externalTarget: boolean;
  reason?: string;
};

function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function resolveWorkspaceExternalWritePolicy(
  input: WorkspaceExternalWritePolicyInput,
): WorkspaceExternalWritePolicyResult {
  const status = provenanceStatus(input.provenanceContext?.provenance);
  const externalTarget = input.targetPaths.some(
    (targetPath) => !isPathInsideRoot(input.workspaceRoot, targetPath),
  );
  const restricted = isExternalOrUnknownProvenance(status);
  const targetScopeKnown = input.scopeKnown && input.targetPaths.length > 0;

  if (!restricted || (!externalTarget && targetScopeKnown)) {
    return { status, allowed: true, restricted, externalTarget };
  }

  return {
    status,
    allowed: false,
    restricted: true,
    externalTarget,
    reason: input.scopeKnown
      ? `Workspace external ${input.action} denied: external or unknown provenance cannot write outside the active workspace.`
      : `Workspace external ${input.action} denied: the mutation target could not be established for external or unknown provenance.`,
  };
}

export type WorkspaceExternalWriteWrapperOptions = {
  action: WorkspaceExternalWriteAction;
  provenanceContext?: ContentProvenanceContext;
  workspaceRoot: string;
  resolveTargets: (params: unknown) =>
    | (WorkspaceExternalWriteTargetScope & {
        /** Skip policy when normal tool validation should own a missing argument. */
        check: boolean;
      })
    | Promise<
        WorkspaceExternalWriteTargetScope & {
          check: boolean;
        }
      >;
};

/** Resolve aliases with the same fs-safe boundary used by workspace writes. */
export async function resolveCanonicalWorkspaceWriteScope(input: {
  workspaceRoot: string;
  targetPaths: readonly string[];
}): Promise<Pick<WorkspaceExternalWriteTargetScope, "workspaceRoot" | "targetPaths">> {
  const workspaceRoot = await fs
    .realpath(input.workspaceRoot)
    .catch(() => canonicalPathFromExistingAncestor(path.resolve(input.workspaceRoot)));
  const targetPaths: string[] = [];
  for (const targetPath of input.targetPaths) {
    const canonicalTarget = await canonicalPathFromExistingAncestor(path.resolve(targetPath));
    if (isPathInsideRoot(workspaceRoot, canonicalTarget)) {
      await assertSandboxPath({
        filePath: canonicalTarget,
        cwd: workspaceRoot,
        root: workspaceRoot,
      });
    }
    targetPaths.push(canonicalTarget);
  }
  return { workspaceRoot, targetPaths };
}

/** Run the source-dependent check before any existing write/journal wrapper. */
export function wrapToolWithWorkspaceExternalWriteProvenance(
  tool: AnyAgentTool,
  options: WorkspaceExternalWriteWrapperOptions,
): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const status = provenanceStatus(options.provenanceContext?.provenance);
      if (!isExternalOrUnknownProvenance(status)) {
        return tool.execute(toolCallId, params, signal, onUpdate);
      }
      const scope = await options.resolveTargets(params);
      if (scope.check) {
        const decision = resolveWorkspaceExternalWritePolicy({
          action: options.action,
          provenanceContext: options.provenanceContext,
          workspaceRoot: scope.workspaceRoot ?? options.workspaceRoot,
          targetPaths: scope.targetPaths,
          scopeKnown: scope.scopeKnown,
        });
        if (!decision.allowed) {
          throw new Error(decision.reason ?? `Workspace external ${options.action} denied.`);
        }
      }
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}
