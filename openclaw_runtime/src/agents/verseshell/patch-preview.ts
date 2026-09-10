import { Type } from "typebox";
import type { DiagnosticTraceContext } from "../../infra/diagnostic-trace-context.js";
import { jsonResult, ToolInputError, type AnyAgentTool } from "../tools/common.js";
import { resolveVerseShellFoundationRollout } from "../verseshell-foundation-flags.js";
import type { JsonObject, Observation } from "../../../../shared/verseshell/types.js";
import type { ApplyPatchSummary } from "../apply-patch-types.js";
import { parsePatchText } from "../apply-patch.js";
import { applyUpdateHunk } from "../apply-patch-update.js";
import { VerseShellAciClient } from "./aci-client.js";
import {
  createPatchPreviewVerseShellProcessConfig,
  getGovernedVerseShellManager,
} from "./governed-exec.js";
import { normalizeAciObservation } from "./normalizer.js";
import { readBaseline, type Baseline } from "./patch-preview-baseline.js";
import {
  boundedPatch,
  boundedRevision,
  buildChangeSummaryDigest,
  canonicalWorkspace,
  contentHash,
  isPatchPreviewOperationAllowed,
  MAX_PATCH_BYTES,
  MAX_PREVIEW_PATHS,
  normalizeContentHash,
  normalizeDiffArtifacts,
  observationData,
  PatchPreviewOperationDeniedError,
  PREVIEW_PATCH_TOOL_NAME,
  readString,
  registerPatchPreview,
  renderAddedDiff,
  renderLocalDiff,
  workspaceIdentity,
  type ChangeSummaryEntry,
  type PatchPreview,
  type PatchPreviewDiff,
  type PatchPreviewPrecondition,
} from "./patch-preview-contract.js";
import {
  resolveVerseShellPolicyProfile,
  VERSESHELL_PATCH_PREVIEW_DENIED_OPERATIONS,
  VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
} from "./policy-profile.js";
import type { VerseShellProcessManager } from "./process-manager.js";
import { resolveReadonlyWorkspacePath } from "./readonly-facade.js";

export * from "./patch-preview-contract.js";
export { readBaseline, type Baseline } from "./patch-preview-baseline.js";

type PatchPreviewArgs = {
  cwd: string;
  agentId?: string;
  revision?: string;
  env?: NodeJS.ProcessEnv;
  manager?: VerseShellProcessManager;
  client?: VerseShellAciClient;
  /** Host-owned parent trace; tool arguments never carry lineage. */
  trace?: DiagnosticTraceContext;
};

/** A path's state part-way through the batch, mirroring the write path's own. */
type VirtualState = {
  exists: boolean;
  text?: string;
};

/**
 * Read-only bridge from a ClawX patch to a VerseShell-observed preview.
 *
 * It computes base hashes, preconditions, a change summary and diff artifacts,
 * and it stops there. `file.apply_patch`, the direct `file.*` writers and every
 * `tx.*` frame are refused by {@link request}, so no second journal, undo stack
 * or stale-write guard can come into existence behind this adapter.
 */
export class VerseShellPatchPreviewAdapter {
  private readonly workspace: string;
  private readonly revision: string;
  private readonly policyDigest = resolveVerseShellPolicyProfile(
    VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
  ).digest;
  private clientPromise?: Promise<VerseShellAciClient>;

  constructor(private readonly options: PatchPreviewArgs) {
    this.workspace = canonicalWorkspace(options.cwd);
    this.revision = boundedRevision(options.revision);
  }

  private client(): Promise<VerseShellAciClient> {
    if (this.options.client) return Promise.resolve(this.options.client);
    this.clientPromise ??= (async () => {
      const manager = getGovernedVerseShellManager(this.options.manager);
      return manager.getClient(
        createPatchPreviewVerseShellProcessConfig({
          cwd: this.workspace,
          agentId: this.options.agentId,
          env: this.options.env,
        }),
      );
    })();
    return this.clientPromise;
  }

  /** The single gate every runtime request passes through. */
  private async request(op: string, args: JsonObject, signal?: AbortSignal): Promise<Observation> {
    if (!isPatchPreviewOperationAllowed(op)) {
      throw new PatchPreviewOperationDeniedError(op);
    }
    const observation = await (await this.client()).execute(op, args, {
      ...(signal ? { signal } : {}),
      retryable: true,
      effectful: false,
      ...(this.options.trace?.traceId ? { traceId: this.options.trace.traceId } : {}),
    });
    if (observation.op !== op) {
      throw new Error(`VerseShell preview response operation mismatch: ${observation.op}`);
    }
    normalizeAciObservation(observation);
    return observation;
  }

  /** Optimistic-concurrency read: hash first, then the bounded baseline body. */
  private baseline(target: string, needText: boolean, signal?: AbortSignal): Promise<Baseline> {
    return readBaseline({
      request: (op, args, abort) => this.request(op, args, abort),
      target,
      needText,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * One diff per path, rendered host-side and then checked against the runtime.
   *
   * The rendering is ours because the runtime caps its own at 200 lines — a cap
   * that silently defeats the entire point of a preview on any real source file,
   * while the generator the write journal already uses for full-file writes is
   * bounded three orders of magnitude higher and takes the same two inputs: the
   * hash-proven baseline and the exact post-image the commit gate will bind.
   *
   * The runtime is still asked, for the one thing only it can say: `file.diff`
   * reports the target's `content_hash` as of that moment, which is strictly
   * later than the `file.hash` the baseline was proven against. A disagreement
   * means the file changed *during* the preview, so the diff describes a state
   * that no longer exists. That is a last-moment staleness check, not a second
   * opinion on the rendering — comparing diff text would be noise, since two
   * generators differ in context and hunk heuristics without either being wrong.
   */
  private async diff(
    target: string,
    baseline: string,
    baseHash: string | null,
    newText: string,
    signal?: AbortSignal,
  ): Promise<{ diff: PatchPreviewDiff; moved: boolean }> {
    const rendered = renderLocalDiff({
      path: target,
      existed: true,
      baseline,
      postImage: newText,
    });
    const observation = await this.request("file.diff", { path: target, new_text: newText }, signal);
    if (!observation.ok) return { diff: rendered, moved: false };
    const data = observationData(observation);
    const seen = normalizeContentHash(readString(data, "content_hash"));
    const artifact = readString(data, "handle");
    return {
      diff: { ...rendered, ...(artifact ? { artifact } : {}) },
      moved: seen !== null && baseHash !== null && seen !== baseHash,
    };
  }

  /**
   * One diff per touched path, comparing the file as it is on disk against the
   * batch's final state. Rendering per path rather than per hunk keeps a
   * multi-hunk file from showing an intermediate post-image as if it were the
   * result, and a baseline we could not fully read yields no diff at all.
   */
  private async renderDiffs(
    originals: Map<string, Baseline>,
    virtual: Map<string, VirtualState>,
    signal?: AbortSignal,
  ): Promise<{ diffs: PatchPreviewDiff[]; movedDuringPreview: string[] }> {
    const diffs: PatchPreviewDiff[] = [];
    const movedDuringPreview: string[] = [];
    for (const [target, finalState] of virtual) {
      const base = originals.get(target);
      const unreadableBase = base?.exists === true && base.text === undefined;
      if (unreadableBase || (finalState.exists && finalState.text === undefined)) {
        diffs.push({ path: target, unified: "", truncated: true });
        continue;
      }
      if (base?.exists) {
        const checked = await this.diff(
          target,
          base.text ?? "",
          base.hash,
          finalState.exists ? (finalState.text ?? "") : "",
          signal,
        );
        diffs.push(checked.diff);
        if (checked.moved) movedDuringPreview.push(target);
        continue;
      }
      if (finalState.exists && finalState.text !== undefined) {
        diffs.push(renderAddedDiff(target, finalState.text));
        continue;
      }
      // A delete of a path that never existed has no diff to show; the summary
      // and the precondition's `missing-target` conflict carry that instead.
      diffs.push({ path: target, unified: "", truncated: false });
    }
    return { diffs, movedDuringPreview };
  }

  async preview(args: { patch: string }, signal?: AbortSignal): Promise<PatchPreview> {
    const patch = boundedPatch(args.patch);
    const { hunks } = parsePatchText(patch);
    if (hunks.length === 0) throw new ToolInputError("patch contains no file hunks");
    if (hunks.length > MAX_PREVIEW_PATHS) {
      throw new ToolInputError("patch exceeds the bounded preview path count");
    }

    const summary: ApplyPatchSummary = { added: [], modified: [], deleted: [] };
    const preconditions: PatchPreviewPrecondition[] = [];
    const digestEntries: ChangeSummaryEntry[] = [];
    // `originals` is each path's pre-batch identity. It is read once and never
    // revised, because that is what the write journal binds against too.
    // `virtual` carries the batch forward so a second hunk on the same path sees
    // the first hunk's result — the sequencing `precomputeHunks` performs on the
    // write side. Without it a multi-hunk patch previews a different post-image
    // than the one that would be committed.
    const originals = new Map<string, Baseline>();
    const virtual = new Map<string, VirtualState>();

    const readOriginal = async (target: string): Promise<Baseline> => {
      const cached = originals.get(target);
      if (cached) return cached;
      const base = await this.baseline(target, true, signal);
      originals.set(target, base);
      if (!virtual.has(target)) {
        virtual.set(target, {
          exists: base.exists,
          ...(base.text === undefined ? {} : { text: base.text }),
        });
      }
      return base;
    };

    for (const hunk of hunks) {
      if (signal?.aborted) throw new Error("VerseShell patch preview aborted");
      const target = resolveReadonlyWorkspacePath(this.workspace, hunk.path);
      const base = await readOriginal(target);

      if (hunk.kind === "add") {
        summary.added.push(target);
        preconditions.push({
          path: target,
          change: "add",
          exists: base.exists,
          baseHash: base.hash,
          baselineTruncated: false,
          ...(virtual.get(target)?.exists ? { conflict: "add-over-existing" as const } : {}),
        });
        virtual.set(target, { exists: true, text: hunk.contents });
        digestEntries.push({
          path: target,
          change: "add",
          baseHash: base.hash,
          postHash: contentHash(hunk.contents),
        });
        continue;
      }

      if (hunk.kind === "delete") {
        summary.deleted.push(target);
        preconditions.push({
          path: target,
          change: "delete",
          exists: base.exists,
          baseHash: base.hash,
          baselineTruncated: false,
          ...(virtual.get(target)?.exists ? {} : { conflict: "missing-target" as const }),
        });
        virtual.set(target, { exists: false });
        digestEntries.push({ path: target, change: "delete", baseHash: base.hash, postHash: null });
        continue;
      }

      const movePath = hunk.movePath
        ? resolveReadonlyWorkspacePath(this.workspace, hunk.movePath)
        : undefined;
      summary.modified.push(target);
      const sourceState = virtual.get(target);
      if (!sourceState?.exists || sourceState.text === undefined) {
        preconditions.push({
          path: target,
          change: "update",
          exists: base.exists,
          baseHash: base.hash,
          baselineTruncated: base.truncated,
          ...(base.reason ? { baselineReason: base.reason } : {}),
          ...(movePath ? { movePath } : {}),
          conflict: sourceState?.exists ? "baseline-unreadable" : "missing-target",
        });
        digestEntries.push({
          path: target,
          change: "update",
          baseHash: base.hash,
          postHash: null,
          ...(movePath ? { movePath } : {}),
        });
        continue;
      }

      const sourceText = sourceState.text;
      const postImage = await applyUpdateHunk(target, hunk.chunks, {
        readFile: async () => sourceText,
      });
      preconditions.push({
        path: target,
        change: "update",
        exists: true,
        baseHash: base.hash,
        baselineTruncated: false,
        ...(movePath ? { movePath } : {}),
      });
      if (movePath && movePath !== target) {
        virtual.set(target, { exists: false });
        await readOriginal(movePath);
        virtual.set(movePath, { exists: true, text: postImage });
      } else {
        virtual.set(target, { exists: true, text: postImage });
      }
      digestEntries.push({
        path: target,
        change: "update",
        baseHash: base.hash,
        postHash: contentHash(postImage),
        ...(movePath ? { movePath } : {}),
      });
    }

    const { diffs, movedDuringPreview } = await this.renderDiffs(originals, virtual, signal);
    const diffArtifacts = normalizeDiffArtifacts(diffs.map((entry) => entry.artifact));
    // A target whose digest changed between the baseline read and the diff read
    // moved while the preview was being taken, so this preview describes a state
    // that no longer exists. Mark it rather than let it look committable — the
    // gate would refuse it anyway, but only after taking leases.
    for (const target of movedDuringPreview) {
      const entry = preconditions.find((candidate) => candidate.path === target);
      if (entry && entry.conflict === undefined) {
        entry.baselineTruncated = true;
        entry.baselineReason = "torn-stitch";
        entry.conflict = "baseline-unreadable";
      }
    }

    const changeSummaryDigest = buildChangeSummaryDigest(digestEntries);
    const previewId = `vsp_${changeSummaryDigest.slice("sha256:".length, "sha256:".length + 32)}`;
    const workspaceId = workspaceIdentity(this.workspace);
    // A preview is only commit-eligible when every target produced a complete,
    // conflict-free identity. Anything else stays a report: the write journal
    // must refuse it rather than treat a partial observation as verification.
    const commitEligible = preconditions.every(
      (entry) => entry.conflict === undefined && !entry.baselineTruncated,
    );
    registerPatchPreview({
      previewId,
      changeSummaryDigest,
      workspaceId,
      revision: this.revision,
      policyProfile: VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
      policyDigest: this.policyDigest,
      commitEligible,
      paths: preconditions.map((entry) => entry.path),
      // AC-3: the diffs this preview stands for, kept host-side so a later commit
      // can cite them without the caller being able to name its own.
      ...(diffArtifacts.length ? { diffArtifacts } : {}),
      createdAtMs: Date.now(),
    });
    return {
      previewId,
      workspaceId,
      revision: this.revision,
      policyProfile: VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
      policyDigest: this.policyDigest,
      summary,
      preconditions,
      diffs,
      changeSummaryDigest,
      commitEligible,
      commitAuthority: "clawx-write-journal",
      verseShellTransaction: "denied",
      deniedOperations: VERSESHELL_PATCH_PREVIEW_DENIED_OPERATIONS,
    };
  }
}

const PREVIEW_PATCH_SCHEMA = Type.Object(
  {
    patch: Type.String({
      minLength: 1,
      maxLength: MAX_PATCH_BYTES,
      description: "ClawX apply_patch text. Preview only; nothing is written.",
    }),
  },
  { additionalProperties: false },
);

const PREVIEW_PATCH_DESCRIPTION =
  "Preview an apply_patch without writing: reports per-file base hashes, preconditions, " +
  "a change summary digest and unified diffs. It cannot commit, undo or delete; the ClawX " +
  "write journal remains the only commit and recovery authority.";

/** Materialize the preview bridge only when every upstream gate is ready. */
export function createVerseShellPatchPreviewTool(options: {
  cwd: string;
  agentId?: string;
  revision?: string;
  config?: unknown;
  env?: NodeJS.ProcessEnv;
  manager?: VerseShellProcessManager;
  client?: VerseShellAciClient;
  trace?: DiagnosticTraceContext;
}): AnyAgentTool | null {
  const rollout = resolveVerseShellFoundationRollout({ config: options.config });
  const required = [
    "verifiedRuntime",
    "typedAci",
    "facade",
    "governedExec",
    "artifactResults",
    "patchPreview",
  ] as const;
  if (rollout.killSwitch.engaged || required.some((flag) => !rollout.enabled[flag])) return null;

  const adapter = new VerseShellPatchPreviewAdapter(options);
  return {
    name: PREVIEW_PATCH_TOOL_NAME,
    label: PREVIEW_PATCH_TOOL_NAME,
    displaySummary: "Preview a patch without writing it.",
    description: PREVIEW_PATCH_DESCRIPTION,
    parameters: PREVIEW_PATCH_SCHEMA,
    risk: "readonly",
    execute: async (_toolCallId, raw, signal) =>
      jsonResult(await adapter.preview(raw as { patch: string }, signal)),
  } as AnyAgentTool;
}


