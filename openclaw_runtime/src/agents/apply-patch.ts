/**
 * Runtime apply_patch tool and parser.
 * Parses OpenAI-style patch envelopes and applies add/update/delete/move hunks
 * through guarded host or sandbox filesystem operations.
 */
import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { openRootFile, type RootFileOpenResult } from "../infra/boundary-file-read.js";
import { root as fsRoot } from "../infra/fs-safe.js";
import { PATH_ALIAS_POLICIES, type PathAliasPolicy } from "../infra/path-alias-guards.js";
import {
  applyPreparedBatch,
  preflightPatch,
  type ApplyPatchJournalEvidence,
  type PatchBatchState,
} from "./apply-patch-preflight.js";
import { toRelativeSandboxPath, resolvePathFromInput } from "./path-policy.js";
import type { AgentToolWithMeta } from "./tools/common.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import { decodeTextFile } from "./sessions/tools/text-file-codec.js";
import type {
  ApplyPatchBatchOptions,
  ApplyPatchJournalOptions,
  ApplyPatchSummary,
  Hunk,
  PatchFileOps,
  UpdateFileChunk,
} from "./apply-patch-types.js";

export type {
  AddFileHunk,
  ApplyPatchSummary,
  DeleteFileHunk,
  Hunk,
  PatchFileOps,
  UpdateFileChunk,
  UpdateFileHunk,
} from "./apply-patch-types.js";

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

export type ApplyPatchResult = {
  summary: ApplyPatchSummary;
  text: string;
  batchState: "committed";
  modifiedFiles: string[];
  journal?: ApplyPatchJournalEvidence;
};

type ApplyPatchToolDetails = {
  summary: ApplyPatchSummary;
  batchState: "committed";
  modifiedFiles: string[];
  write_journal?: ApplyPatchJournalEvidence;
  working_memory?: {
    result_summary: string;
    significance: "high" | "medium" | "low";
  };
};

type SandboxApplyPatchConfig = {
  root: string;
  bridge: SandboxFsBridge;
};

export type ApplyPatchOptions = ApplyPatchBatchOptions & {
  cwd: string;
  sandbox?: SandboxApplyPatchConfig;
  /** Restrict patch paths to the workspace root (cwd). Default: true. Set false to opt out. */
  workspaceOnly?: boolean;
};

type CreateApplyPatchToolOptions = {
  cwd?: string;
  sandbox?: SandboxApplyPatchConfig;
  workspaceOnly?: boolean;
  journal?: Omit<ApplyPatchJournalOptions, "requestId">;
};

const applyPatchSchema = Type.Object({
  input: Type.String({
    description: "Patch content using the *** Begin Patch/End Patch format.",
  }),
});

/** Create the agent tool wrapper for applying patch-envelope input. */
export function createApplyPatchTool(
  options: CreateApplyPatchToolOptions = {},
): AgentToolWithMeta<typeof applyPatchSchema, ApplyPatchToolDetails> {
  const cwd = options.cwd ?? process.cwd();
  const sandbox = options.sandbox;
  const workspaceOnly = options.workspaceOnly !== false;

  return {
    name: "apply_patch",
    label: "apply_patch",
    description:
      "Apply a patch to one or more files using the apply_patch format. The input should include *** Begin Patch and *** End Patch markers.",
    // A1 Stage 2 (acceptance 2.1): apply_patch can add/update/delete/move
    // files — destructive (irreversible file removals).
    risk: "destructive",
    writeRiskProfile: { kind: "dynamic_writes", requiresApproval: true },
    parameters: applyPatchSchema,
    execute: async (toolCallId, args, signal) => {
      const params = args as { input?: string };
      const input = typeof params.input === "string" ? params.input : "";
      if (!input.trim()) {
        throw new Error("Provide a patch input.");
      }
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      const result = await applyPatch(input, {
        cwd,
        sandbox,
        workspaceOnly,
        signal,
        ...(options.journal
          ? {
              journal: {
                ...options.journal,
                ...(toolCallId ? { requestId: toolCallId } : {}),
              },
            }
          : {}),
      });

      return {
        content: [{ type: "text", text: result.text }],
        details: {
          summary: result.summary,
          batchState: result.batchState,
          modifiedFiles: result.modifiedFiles,
          ...(result.journal ? { write_journal: result.journal } : {}),
          working_memory: {
            result_summary:
              `Patched: +${result.summary.added.length} ~${result.summary.modified.length} -${result.summary.deleted.length}`.slice(
                0,
                100,
              ),
            significance: "high",
          },
        },
      };
    },
  };
}

/** Parse and apply a patch envelope to the configured filesystem target. */
export async function applyPatch(
  input: string,
  options: ApplyPatchOptions,
): Promise<ApplyPatchResult> {
  const parsed = parsePatchText(input);
  if (parsed.hunks.length === 0) {
    throw new Error("No files were modified.");
  }

  const fileOps = resolvePatchFileOps(options);

  // UAS-04: preflight phase — parse, resolve, pre-read, pre-compute every hunk
  // before any filesystem mutation. A preflight failure returns an error with
  // zero files touched.
  const prepared = await preflightPatch(parsed.hunks, options, fileOps, {
    resolvePath: (filePath, aliasPolicy) => resolvePatchPath(filePath, options, aliasPolicy),
    assertParentPath: (filePath) => assertPatchParentPath(filePath, options),
  });

  // UAS-04: batch apply with state machine and rollback
  const batchResult = await applyPreparedBatch(prepared, options, fileOps);

  // If the batch was rolled back or requires recovery, throw so the caller
  // knows the patch did not commit. The batch state and recoveryRef are
  // attached to the error for observability.
  if (batchResult.batchState !== "committed") {
    const err = new Error(batchResult.text);
    Object.assign(err, {
      batchState: batchResult.batchState satisfies Exclude<PatchBatchState, "committed">,
      recoveryRef: batchResult.recoveryRef,
      modifiedFiles: batchResult.modifiedFiles,
      summary: batchResult.summary,
      journal: batchResult.journal,
    });
    throw err;
  }

  return {
    summary: batchResult.summary,
    text: batchResult.text,
    batchState: "committed",
    modifiedFiles: batchResult.modifiedFiles,
    ...(batchResult.journal ? { journal: batchResult.journal } : {}),
  };
}

function resolvePatchFileOps(options: ApplyPatchOptions): PatchFileOps {
  if (options.sandbox) {
    const { root, bridge } = options.sandbox;
    return {
      exists: async (filePath) => (await bridge.stat({ filePath, cwd: root }))?.type === "file",
      readFile: async (filePath) => {
        const buf = await bridge.readFile({ filePath, cwd: root });
        return decodeTextFile(buf, filePath);
      },
      writeFile: (filePath, content) => bridge.writeFile({ filePath, cwd: root, data: content }),
      remove: (filePath) => bridge.remove({ filePath, cwd: root, force: false }),
      mkdirp: (dir) => bridge.mkdirp({ filePath: dir, cwd: root }),
    };
  }
  const workspaceOnly = options.workspaceOnly !== false;
  const rootPromise = workspaceOnly ? fsRoot(options.cwd) : undefined;
  return {
    exists: async (filePath) => {
      try {
        return (await fs.stat(filePath)).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }
        throw error;
      }
    },
    readFile: async (filePath) => {
      if (!workspaceOnly) {
        return decodeTextFile(await fs.readFile(filePath), filePath);
      }
      const opened = await openRootFile({
        absolutePath: filePath,
        rootPath: options.cwd,
        boundaryLabel: "workspace root",
      });
      assertBoundaryRead(opened, filePath);
      try {
        return decodeTextFile(syncFs.readFileSync(opened.fd), filePath);
      } finally {
        syncFs.closeSync(opened.fd);
      }
    },
    writeFile: async (filePath, content) => {
      if (!workspaceOnly) {
        if (typeof content === "string") {
          await fs.writeFile(filePath, content, "utf8");
        } else {
          await fs.writeFile(filePath, content);
        }
        return;
      }
      const relative = toRelativeSandboxPath(options.cwd, filePath);
      const root = await rootPromise;
      if (!root) {
        return;
      }
      if (typeof content === "string") {
        await root.write(relative, content, { encoding: "utf8" });
      } else {
        await root.write(relative, content);
      }
    },
    remove: async (filePath) => {
      if (!workspaceOnly) {
        await fs.rm(filePath);
        return;
      }
      const relative = toRelativeSandboxPath(options.cwd, filePath);
      await (await rootPromise)?.remove(relative);
    },
    mkdirp: async (dir) => {
      if (!workspaceOnly) {
        await fs.mkdir(dir, { recursive: true });
        return;
      }
      const relative = toRelativeSandboxPath(options.cwd, dir, { allowRoot: true });
      const root = await rootPromise;
      if (!root) {
        return;
      }
      if (relative === "" || relative === ".") {
        await root.ensureRoot();
        return;
      }
      await root.mkdir(relative);
    },
  };
}

export async function ensureDir(filePath: string, ops: PatchFileOps) {
  const parent = path.dirname(filePath);
  if (!parent || parent === ".") {
    return;
  }
  await ops.mkdirp(parent);
}

export async function assertPatchParentPath(filePath: string, options: ApplyPatchOptions) {
  if (options.workspaceOnly === false || options.sandbox) {
    return;
  }
  const parent = path.dirname(filePath);
  if (!parent || parent === ".") {
    return;
  }
  await assertSandboxPath({
    filePath: parent,
    cwd: options.cwd,
    root: options.cwd,
  });
  await assertNoExistingParentAliases({
    parentPath: resolvePathFromInput(parent, options.cwd),
    rootPath: options.cwd,
  });
}

async function assertNoExistingParentAliases(params: { parentPath: string; rootPath: string }) {
  const rootPath = path.resolve(params.rootPath);
  const parentPath = path.resolve(params.parentPath);
  const relative = path.relative(rootPath, parentPath);
  if (!relative || relative === "" || relativePathEscapesRoot(relative)) {
    return;
  }

  let current = rootPath;
  for (const segment of relative.split(path.sep)) {
    if (!segment) {
      continue;
    }
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (!stat) {
      return;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Path alias under sandbox root: ${path.relative(rootPath, current)}`);
    }
  }
}

export async function resolvePatchPath(
  filePath: string,
  options: ApplyPatchOptions,
  aliasPolicy: PathAliasPolicy = PATH_ALIAS_POLICIES.strict,
): Promise<{ resolved: string; display: string }> {
  if (options.sandbox) {
    const resolved = options.sandbox.bridge.resolvePath({
      filePath,
      cwd: options.cwd,
    });
    if (options.workspaceOnly !== false && resolved.hostPath) {
      await assertSandboxPath({
        filePath: resolved.hostPath,
        cwd: options.cwd,
        root: options.cwd,
        allowFinalSymlinkForUnlink: aliasPolicy.allowFinalSymlinkForUnlink,
        allowFinalHardlinkForUnlink: aliasPolicy.allowFinalHardlinkForUnlink,
      });
    }
    return {
      resolved: resolved.hostPath ?? resolved.containerPath,
      display: resolved.relativePath || resolved.containerPath,
    };
  }

  const workspaceOnly = options.workspaceOnly !== false;
  const resolved = workspaceOnly
    ? (
        await assertSandboxPath({
          filePath,
          cwd: options.cwd,
          root: options.cwd,
          allowFinalSymlinkForUnlink: aliasPolicy.allowFinalSymlinkForUnlink,
          allowFinalHardlinkForUnlink: aliasPolicy.allowFinalHardlinkForUnlink,
        })
      ).resolved
    : resolvePathFromInput(filePath, options.cwd);
  return {
    resolved,
    display: toDisplayPath(resolved, options.cwd),
  };
}

function assertBoundaryRead(
  opened: RootFileOpenResult,
  targetPath: string,
): asserts opened is Extract<RootFileOpenResult, { ok: true }> {
  if (opened.ok) {
    return;
  }
  const reason = opened.reason === "validation" ? "unsafe path" : "path not found";
  throw new Error(`Failed boundary read for ${targetPath} (${reason})`);
}

function toDisplayPath(resolved: string, cwd: string): string {
  const relative = path.relative(cwd, resolved);
  if (!relative || relative === "") {
    return path.basename(resolved);
  }
  if (relativePathEscapesRoot(relative)) {
    return resolved;
  }
  return relative;
}

function relativePathEscapesRoot(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    path.isAbsolute(relativePath)
  );
}

export function parsePatchText(input: string): { hunks: Hunk[]; patch: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Invalid patch: input is empty.");
  }

  const lines = trimmed.split(/\r?\n/);
  const validated = checkPatchBoundariesLenient(lines);
  const hunks: Hunk[] = [];

  const lastLineIndex = validated.length - 1;
  let remaining = validated.slice(1, lastLineIndex);
  let lineNumber = 2;

  while (remaining.length > 0) {
    const { hunk, consumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    lineNumber += consumed;
    remaining = remaining.slice(consumed);
  }

  return { hunks, patch: validated.join("\n") };
}

function checkPatchBoundariesLenient(lines: string[]): string[] {
  const strictError = checkPatchBoundariesStrict(lines);
  if (!strictError) {
    return lines;
  }

  if (lines.length < 4) {
    throw new Error(strictError);
  }
  const first = lines[0];
  const last = lines.at(-1);
  if (
    last &&
    (first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
    last.endsWith("EOF")
  ) {
    const inner = lines.slice(1, -1);
    const innerError = checkPatchBoundariesStrict(inner);
    if (!innerError) {
      return inner;
    }
    throw new Error(innerError);
  }

  throw new Error(strictError);
}

function checkPatchBoundariesStrict(lines: string[]): string | null {
  const firstLine = lines[0]?.trim();
  const lastLine = lines[lines.length - 1]?.trim();

  if (firstLine === BEGIN_PATCH_MARKER && lastLine === END_PATCH_MARKER) {
    return null;
  }
  if (firstLine !== BEGIN_PATCH_MARKER) {
    return "The first line of the patch must be '*** Begin Patch'";
  }
  return "The last line of the patch must be '*** End Patch'";
}

function parseOneHunk(lines: string[], lineNumber: number): { hunk: Hunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: empty hunk`);
  }
  const firstLine = lines[0].trim();
  if (firstLine.startsWith(ADD_FILE_MARKER)) {
    const targetPath = firstLine.slice(ADD_FILE_MARKER.length);
    let contents = "";
    let consumed = 1;
    for (const addLine of lines.slice(1)) {
      if (addLine.startsWith("+")) {
        contents += `${addLine.slice(1)}\n`;
        consumed += 1;
      } else {
        break;
      }
    }
    return {
      hunk: { kind: "add", path: targetPath, contents },
      consumed,
    };
  }

  if (firstLine.startsWith(DELETE_FILE_MARKER)) {
    const targetPath = firstLine.slice(DELETE_FILE_MARKER.length);
    return {
      hunk: { kind: "delete", path: targetPath },
      consumed: 1,
    };
  }

  if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
    const targetPath = firstLine.slice(UPDATE_FILE_MARKER.length);
    let remaining = lines.slice(1);
    let consumed = 1;
    let movePath: string | undefined;

    const moveCandidate = remaining[0]?.trim();
    if (moveCandidate?.startsWith(MOVE_TO_MARKER)) {
      movePath = moveCandidate.slice(MOVE_TO_MARKER.length);
      remaining = remaining.slice(1);
      consumed += 1;
    }

    const chunks: UpdateFileChunk[] = [];
    while (remaining.length > 0) {
      if (remaining[0].trim() === "") {
        remaining = remaining.slice(1);
        consumed += 1;
        continue;
      }
      if (remaining[0].startsWith("***")) {
        break;
      }
      const { chunk, consumed: chunkLines } = parseUpdateFileChunk(
        remaining,
        lineNumber + consumed,
        chunks.length === 0,
      );
      chunks.push(chunk);
      remaining = remaining.slice(chunkLines);
      consumed += chunkLines;
    }

    if (chunks.length === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber}: Update file hunk for path '${targetPath}' is empty`,
      );
    }

    return {
      hunk: {
        kind: "update",
        path: targetPath,
        movePath,
        chunks,
      },
      consumed,
    };
  }

  throw new Error(
    `Invalid patch hunk at line ${lineNumber}: '${lines[0]}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
  );
}

function parseUpdateFileChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdateFileChunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Update hunk does not contain any lines`,
    );
  }

  let changeContext: string | undefined;
  let startIndex = 0;
  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1;
  } else if (lines[0].startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else if (!allowMissingContext) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Expected update hunk to start with a @@ context marker, got: '${lines[0]}'`,
    );
  }

  if (startIndex >= lines.length) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber + 1}: Update hunk does not contain any lines`,
    );
  }

  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
  };

  let parsedLines = 0;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new Error(
          `Invalid patch hunk at line ${lineNumber + 1}: Update hunk does not contain any lines`,
        );
      }
      chunk.isEndOfFile = true;
      parsedLines += 1;
      break;
    }

    const marker = line[0];
    if (!marker) {
      chunk.oldLines.push("");
      chunk.newLines.push("");
      parsedLines += 1;
      continue;
    }

    if (marker === " ") {
      const content = line.slice(1);
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      parsedLines += 1;
      continue;
    }
    if (marker === "+") {
      chunk.newLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }
    if (marker === "-") {
      chunk.oldLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }

    if (parsedLines === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber + 1}: Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
      );
    }
    break;
  }

  return { chunk, consumed: parsedLines + startIndex };
}
