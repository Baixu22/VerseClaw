/**
 * P7 UFTK: operator recovery advice for a checkpoint restore outcome.
 *
 * The last of the optional P7 products named in the development spec
 * (`checkpoint 间 patch export`, `review diff 视图`, `恢复建议`). The first two
 * already exist -- `exportPatch` from P6B lifecycle and the bridge's review-diff
 * surface -- this one closes the third.
 *
 * The gap it closes is concrete: when a restore returns `recovery_required` the
 * caller receives a `safetyRef`, maybe a `recoveryRef`, and a reason string, but
 * no statement of what to actually do. Until now that operator path existed only
 * as a comment in a P6B test. Turning it into a structured, ordered answer means
 * the recovery procedure is part of the contract rather than folklore.
 *
 * This module is deliberately **pure**: it derives advice from the result shape
 * alone and runs no git commands, touches no locks and reads no files. Advice
 * about a broken workspace must never be able to break the workspace further,
 * and it must be safe to call from an error path that is already failing.
 */
import type { GitCheckpointRestoreResult, GitCheckpointRestoreStatus } from "./git-checkpoint.js";

export type RecoveryAdviceStep = {
  /** Imperative one-line action. */
  action: string;
  /** Why this step, and what it protects. */
  detail: string;
  /** A concrete command when one exists. Never destructive. */
  command?: string;
};

export type RecoveryAdvice = {
  status: GitCheckpointRestoreStatus;
  /**
   * True only when the workspace may be in a mixed state that needs a human.
   * Every other outcome left the target byte-unchanged, so nothing is required.
   */
  actionRequired: boolean;
  /** One sentence a caller can surface verbatim. */
  summary: string;
  steps: RecoveryAdviceStep[];
  /** Refs the advice refers to, echoed for convenience. */
  safetyRef?: string;
  recoveryRef?: string;
};

/**
 * Build ordered recovery advice for a restore outcome.
 *
 * Note the asymmetry this encodes: only `recovery_required` sets
 * `actionRequired`. `conflict`, `failed`, `unsupported`, `not_found` and
 * `disabled` all guarantee zero worktree change by construction -- either the
 * rejection happened in prepare, or the apply was rolled back from the safety
 * snapshot -- so advertising them as needing recovery would send an operator
 * hunting for damage that does not exist.
 */
export function buildCheckpointRecoveryAdvice(
  result: GitCheckpointRestoreResult,
): RecoveryAdvice {
  const refs = {
    ...(result.safetyRef ? { safetyRef: result.safetyRef } : {}),
    ...(result.recoveryRef ? { recoveryRef: result.recoveryRef } : {}),
  };
  const base = { status: result.status, ...refs };

  switch (result.status) {
    case "restored":
      return {
        ...base,
        actionRequired: false,
        summary: "Restore completed. No recovery action is needed.",
        steps: result.safetyRef
          ? [
              {
                action: "Keep the safety ref until you have verified the result",
                detail:
                  "It holds the pre-restore content of every affected path, and no " +
                  "checkpoint retention policy will delete it.",
                command: `git show ${result.safetyRef}:<path>`,
              },
            ]
          : [],
      };

    case "recovery_required":
      return {
        ...base,
        actionRequired: true,
        summary:
          "The apply phase mutated the worktree and the automatic rollback could not " +
          "complete. The workspace may be in a mixed state; the pre-restore content is " +
          "still reachable.",
        steps: [
          {
            action: "Do not run another restore yet",
            detail:
              "A second restore over a mixed worktree makes the pre-restore state harder " +
              "to reconstruct. Recover first, then retry.",
          },
          {
            action: "Fix the underlying failure",
            detail:
              result.reason ??
              "See the reason on the result; the apply failed for an environmental reason " +
              "such as an unwritable state directory or a path replaced by a directory.",
          },
          ...(result.safetyRef
            ? [
                {
                  action: "Inspect the pre-restore content",
                  detail:
                    "The safety ref is a real commit; read it before changing anything so " +
                    "you know what you are restoring to.",
                  command: `git ls-tree -r --name-only ${result.safetyRef}`,
                },
                {
                  action: "Restore the pre-restore state from the safety ref",
                  detail:
                    "Use the normal path-scoped restore API with the safety ref as the " +
                    "checkpoint id. Do not fall back to git's destructive whole-tree reset " +
                    "or force-clean primitives; the scoped restore path is the only " +
                    "supported route, and it is what keeps a second failure recoverable.",
                  command: `restoreCheckpoint("${result.safetyRef}", { paths: [...] })`,
                },
              ]
            : [
                {
                  action: "Reconstruct from the diagnostic",
                  detail:
                    "No safety snapshot was captured, so recovery relies on " +
                    "`diagnostic.beforeStatus` / `beforeTracked` / `beforeUntracked` on the " +
                    "result. Enable runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled " +
                    "so this case is covered next time.",
                },
              ]),
          ...(result.recoveryRef
            ? [
                {
                  action: "Replay files a git tree cannot hold",
                  detail:
                    "The recovery directory holds raw byte copies of the at-risk files, " +
                    "including gitignored ones that never enter the safety tree.",
                  command: `ls -R ${result.recoveryRef}`,
                },
              ]
            : []),
          {
            action: "Re-verify before retrying",
            detail:
              "Confirm `git status` matches `diagnostic.beforeStatus` on the result, then " +
              "re-run the restore.",
            command: "git status --porcelain=v1",
          },
        ],
      };

    case "conflict":
      return {
        ...base,
        actionRequired: false,
        summary:
          "Restore refused before touching anything. The target is byte-unchanged, and " +
          "the conflict is the reason it stayed that way.",
        steps: [
          {
            action: "Read the conflict reason",
            detail: result.reason ?? "See the reason on the result.",
          },
          {
            action: "Decide what should win",
            detail:
              "A dirty in-scope path, a path blocked by a directory or symlink, or a " +
              "pending worktree merge over the same paths. Resolve the collision, or enable " +
              "runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled so dirty content is " +
              "preserved and the restore can proceed.",
          },
        ],
      };

    case "failed": {
      const rolledBack = (result.reason ?? "").includes("rolled back from safety snapshot");
      return {
        ...base,
        actionRequired: false,
        summary: rolledBack
          ? "The apply failed and was rolled back from the safety snapshot. The workspace " +
            "is back at its pre-restore state."
          : "Restore failed before mutating the worktree. The target is byte-unchanged.",
        steps: [
          {
            action: "Read the failure reason",
            detail: result.reason ?? "See the error code and reason on the result.",
          },
          ...(rolledBack
            ? [
                {
                  action: "Confirm the rollback",
                  detail:
                    "Compare `git status` against `diagnostic.beforeStatus` on the result " +
                    "before retrying.",
                  command: "git status --porcelain=v1",
                },
              ]
            : []),
        ],
      };
    }

    case "not_found":
      return {
        ...base,
        actionRequired: false,
        summary: "The checkpoint does not resolve. Nothing was touched.",
        steps: [
          {
            action: "List the checkpoints that do exist",
            detail:
              "Retention may have reclaimed it. Safety refs live in a separate namespace " +
              "and are listed separately.",
            command: "listCheckpoints() / listSafetyCheckpoints()",
          },
        ],
      };

    case "disabled":
    case "unsupported":
    default:
      return {
        ...base,
        actionRequired: false,
        summary:
          result.status === "disabled"
            ? "The capability is disabled by flag. Nothing was touched."
            : "This repository shape or scope is not supported. Nothing was touched.",
        steps: [
          {
            action: "Read the reason",
            detail:
              result.reason ??
              "See the reason on the result: a flag is off, the workspace is not a git " +
              "work tree, a submodule link is unsupported, or the requested scope is not " +
              "covered by the checkpoint.",
          },
        ],
      };
  }
}
