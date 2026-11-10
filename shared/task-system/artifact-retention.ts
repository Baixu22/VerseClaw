import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isSharedGitRef } from '../git-native-root.js';
export type TaskArtifactReference = {
  taskNodeId: string; sourceKey: string; kind: "checkpoint" | "evidence" | "delegation_candidate";
  worktree: string; path: string; sha256: string;
};
export type TaskArtifactRetentionReceipt = {
  schemaVersion: 1; receiptId: string; source: TaskArtifactReference;
  retained: { repository: string; repositoryIdentity: string; ref: string; commitOid: string;
    path: string; blobOid: string; sizeBytes: number };
  actor: "agent"; verifiedAt: number;
};
type RepositoryBinding = { root: string; commonDir: string; identity: string; zeroOid: string };
type Blob = { bytes: Buffer; oid: string; path: string };
const MAX_SCANNED_COMMITS = 256;
const MAX_BLOB_BYTES = 32 * 1024 * 1024;
const RETENTION_PREFIX = "refs/agent-retention/tasks/";
function canonicalPath(input: string): string { return resolveWithoutNative(realpathSync.native(resolve(input))); }
function containedRel(root: string, candidate: string): string | null {
  const rel = relative(root, candidate).replace(/\\/g, "/");
  return rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel) ? rel : null;
}
function repositoryIdentity(commonDir: string): string {
  const stat = statSync(commonDir, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${commonDir}`;
}
function gitEnv(worktree?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat",
    GIT_LITERAL_PATHSPECS: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor", GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "credential.interactive", GIT_CONFIG_VALUE_2: "false",
  };
  delete env.GIT_DIR;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  if (worktree) env.GIT_WORK_TREE = worktree; else delete env.GIT_WORK_TREE;
  return env;
}
function runGit(commonDir: string, cwd: string, args: string[], worktree?: string, input?: Buffer): Buffer {
  return execFileSync("git", [`--git-dir=${commonDir}`, ...args], {
    cwd, encoding: "buffer", stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true, timeout: 15_000, env: { ...gitEnv(worktree),
      GIT_LITERAL_PATHSPECS: args[0] === 'rev-list' && process.platform === 'win32' ? '0' : '1' },
    maxBuffer: MAX_BLOB_BYTES + 1024 * 1024, input,
  });
}
function gitText(commonDir: string, cwd: string, args: string[], worktree?: string): string {
  return runGit(commonDir, cwd, args, worktree).toString("utf8").trim();
}
function openRepository(input: string): RepositoryBinding {
  const requested = canonicalPath(input), marker = join(requested, ".git");
  if (existsSync(marker) && !lstatSync(marker).isDirectory()) throw new Error("task_artifact_repository_base_required");
  const commonDir = existsSync(marker) ? canonicalPath(marker) : requested;
  gitText(commonDir, commonDir, ["rev-parse", "--git-dir"]);
  const format = gitText(commonDir, commonDir, ["rev-parse", "--show-object-format"]);
  return { root: dirname(commonDir).replace(/\\/g, "/"), commonDir, identity: repositoryIdentity(commonDir),
    zeroOid: "0".repeat(format === "sha256" ? 64 : 40) };
}
function assertSourceBinding(worktree: string, commonDir: string): string {
  const root = canonicalPath(worktree), marker = join(root, ".git");
  if (!existsSync(marker)) throw new Error("task_artifact_worktree_binding_missing");
  const markerStat = lstatSync(marker);
  if (markerStat.isDirectory()) {
    if (canonicalPath(marker) !== commonDir) throw new Error("task_artifact_worktree_binding_mismatch");
  } else if (markerStat.isFile()) {
    const match = /^gitdir:\s*(.+?)\s*$/mu.exec(readFileSync(marker, "utf8"));
    if (!match) throw new Error("task_artifact_worktree_binding_invalid");
    const privateDir = canonicalPath(resolve(root, match[1]));
    if (!containedRel(commonDir, privateDir) || !existsSync(join(privateDir, "commondir"))
      || canonicalPath(resolve(privateDir, readFileSync(join(privateDir, "commondir"), "utf8").trim())) !== commonDir) throw new Error("task_artifact_worktree_binding_mismatch");
    const backPointer = readFileSync(join(privateDir, "gitdir"), "utf8").trim();
    if (canonicalPath(dirname(resolve(privateDir, backPointer))) !== root) throw new Error("task_artifact_worktree_binding_mismatch");
  } else throw new Error("task_artifact_worktree_binding_invalid");
  if (canonicalPath(gitText(commonDir, root, ["rev-parse", "--show-toplevel"], root)) !== root) throw new Error("task_artifact_worktree_root_mismatch");
  return root;
}
function lstatIfExists(target: string) {
  try { return lstatSync(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function artifactRelativePath(source: TaskArtifactReference, worktree: string): string {
  if (!isAbsolute(source.path)) throw new Error("task_artifact_path_not_absolute");
  const lexicalRel = containedRel(worktree, resolve(source.path));
  if (!lexicalRel) throw new Error("task_artifact_path_outside_worktree");
  const entry = lstatIfExists(source.path);
  if (entry && (entry.isSymbolicLink() || !entry.isFile())) throw new Error("task_artifact_path_not_file");
  let ancestor = source.path;
  while (!lstatIfExists(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("task_artifact_parent_missing");
    ancestor = parent;
  }
  let candidate: string;
  try { candidate = resolve(canonicalPath(ancestor), relative(ancestor, source.path)); }
  catch { throw new Error("task_artifact_path_outside_worktree"); }
  if (!containedRel(worktree, candidate)) throw new Error("task_artifact_path_outside_worktree");
  return lexicalRel;
}
function refTips(commonDir: string, root: string, oidLength: number): string[] {
  const output = gitText(commonDir, root, ["for-each-ref", "--format=%(refname)\t%(objectname)\t%(objecttype)\t%(*objectname)\t%(*objecttype)"]);
  const oid = new RegExp(`^(?:[0-9a-f]{${oidLength}})$`);
  const tips: string[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const [ref, value, type, peeled, peeledType] = line.split("\t");
    if (!ref || !oid.test(value) || !isSharedGitRef(ref)) continue;
    const commit = peeledType === "commit" ? peeled : type === "commit" ? value : null;
    if (commit && oid.test(commit) && !tips.includes(commit)) tips.push(commit);
  }
  return tips.slice(0, MAX_SCANNED_COMMITS);
}
function treePath(commonDir: string, root: string, commitOid: string, pathname: string): string | null {
  const parts = pathname.split('/'), actual: string[] = []; let tree = commitOid;
  for (const [index, part] of parts.entries()) {
    const records = runGit(commonDir, root, ['ls-tree', '-z', tree]).toString('utf8').split('\0').filter(Boolean)
      .map(record => { const tab = record.indexOf('\t'), [mode, type, oid] = record.slice(0, tab).split(' '); return { mode, type, oid, name: record.slice(tab + 1) }; });
    const matches = records.filter(record => record.name.toLowerCase() === part.toLowerCase());
    if (matches.length > 1) throw new Error('task_artifact_case_ambiguous');
    const entry = matches[0];
    if (!entry || (index < parts.length - 1 ? entry.type !== 'tree' : !['100644', '100755'].includes(entry.mode))) return null;
    actual.push(entry.name); tree = entry.oid;
  }
  return actual.join('/');
}
function blobAt(commonDir: string, root: string, commitOid: string, artifactPath: string): Blob | null {
  if (process.platform === 'win32') {
    const actual = treePath(commonDir, root, commitOid, artifactPath);
    if (!actual) return null;
    artifactPath = actual;
  }
  const output = runGit(commonDir, root, ["ls-tree", "-z", "--full-tree", commitOid, "--", artifactPath]);
  const end = output.indexOf(0);
  if (end < 0) return null;
  const record = output.subarray(0, end).toString("utf8");
  const tab = record.indexOf("\t");
  const [mode, type, oid] = tab < 0 ? [] : record.slice(0, tab).split(" ");
  if (tab < 0 || record.slice(tab + 1) !== artifactPath || type !== "blob" || !oid || !["100644", "100755"].includes(mode)) return null;
  const size = Number(gitText(commonDir, root, ['cat-file', '-s', oid]));
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BLOB_BYTES) return null;
  return { oid, path: artifactPath, bytes: runGit(commonDir, root, ["cat-file", "blob", oid]) };
}

/** Batch object lookup avoids two native processes per historical commit. */
function findHistoricalBlob(repo: RepositoryBinding, commits: string[], artifactPath: string, expectedHash: string) {
  if (!commits.length) return null;
  if (/[\r\n]/u.test(artifactPath)) {
    for (const commitOid of commits) {
      const blob = blobAt(repo.commonDir, repo.root, commitOid, artifactPath);
      if (blob && sha256(blob.bytes) === expectedHash) return { commitOid, blob };
    }
    return null;
  }
  const lookupPath = process.platform === 'win32' ? treePath(repo.commonDir, repo.root, commits[0], artifactPath) ?? artifactPath : artifactPath;
  const rows = runGit(repo.commonDir, repo.root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], undefined,
    Buffer.from(commits.map(oid => `${oid}:${lookupPath}\n`).join(''))).toString('utf8').trimEnd().split('\n');
  const candidates = rows.flatMap((row, index) => {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (\d+)$/u.exec(row.trim());
    return match && Number(match[2]) <= MAX_BLOB_BYTES ? [{ oid: match[1], size: Number(match[2]), commitOid: commits[index] }] : [];
  });
  for (let index = 0; index < candidates.length;) {
    const batch = [], seen = new Set<string>(); let total = 0;
    while (index < candidates.length && (!batch.length || total + candidates[index].size <= MAX_BLOB_BYTES)) {
      const value = candidates[index++];
      if (!seen.has(value.oid)) { batch.push(value); seen.add(value.oid); total += value.size; }
    }
    const output = runGit(repo.commonDir, repo.root, ['cat-file', '--batch'], undefined,
      Buffer.from(batch.map(value => value.oid + '\n').join('')));
    let offset = 0;
    for (const value of batch) {
      const lineEnd = output.indexOf(10, offset);
      if (lineEnd < 0 || output.subarray(offset, lineEnd).toString('utf8') !== `${value.oid} blob ${value.size}`)
        throw new Error('task_artifact_batch_changed');
      offset = lineEnd + 1;
      const bytes = output.subarray(offset, offset + value.size);
      if (bytes.length !== value.size || output[offset + value.size] !== 10) throw new Error('task_artifact_batch_incomplete');
      offset += value.size + 1;
      if (sha256(bytes) === expectedHash) {
        for (const matching of candidates.filter(candidate => candidate.oid === value.oid)) {
          const blob = blobAt(repo.commonDir, repo.root, matching.commitOid, artifactPath);
          if (blob && blob.oid === value.oid && sha256(blob.bytes) === expectedHash) return { commitOid: matching.commitOid, blob };
        }
      }
    }
  }
  if (process.platform === 'win32') {
    for (const commitOid of commits.filter(commit => !candidates.some(candidate => candidate.commitOid === commit))) {
      const blob = blobAt(repo.commonDir, repo.root, commitOid, artifactPath);
      if (blob && sha256(blob.bytes) === expectedHash) return { commitOid, blob };
    }
  }
  return null;
}
function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function receiptDigest(source: TaskArtifactReference, retained: TaskArtifactRetentionReceipt["retained"], verifiedAt: number): string {
  return sha256(Buffer.from(canonicalJson({ schemaVersion: 1, source, retained, actor: "agent", verifiedAt })));
}
function retentionRef(source: TaskArtifactReference): string {
  const suffix = createHash("sha256").update(source.taskNodeId).update("\0").update(source.sourceKey)
    .update("\0").update(Buffer.from(source.sha256, "hex")).digest("hex");
  return `${RETENTION_PREFIX}${suffix}`;
}
function assertSource(source: TaskArtifactReference): void {
  const kinds = ["checkpoint", "evidence", "delegation_candidate"];
  if (!source.taskNodeId || !source.sourceKey || !kinds.includes(source.kind) || !isAbsolute(source.worktree)
    || !isAbsolute(source.path) || !/^[0-9a-f]{64}$/u.test(source.sha256)) throw new Error("task_artifact_source_invalid");
}
function buildReceipt(repo: RepositoryBinding, source: TaskArtifactReference, ref: string, commitOid: string,
  blob: Blob): TaskArtifactRetentionReceipt {
  const retained = { repository: repo.commonDir, repositoryIdentity: repo.identity, ref, commitOid,
    path: blob.path, blobOid: blob.oid, sizeBytes: blob.bytes.length };
  const verifiedAt = Date.now();
  return { schemaVersion: 1, receiptId: receiptDigest(source, retained, verifiedAt), source: { ...source },
    retained, actor: "agent", verifiedAt };
}
function existingRefBlob(repo: RepositoryBinding, ref: string, artifactPath: string): { commitOid: string; blob: Blob } | null {
  let commitOid: string;
  try { commitOid = gitText(repo.commonDir, repo.root, ["show-ref", "--verify", "--hash", ref]); } catch { return null; }
  try {
    if (gitText(repo.commonDir, repo.root, ["rev-parse", "--verify", `${ref}^{commit}`]) !== commitOid) throw new Error();
    const blob = blobAt(repo.commonDir, repo.root, commitOid, artifactPath);
    if (!blob) throw new Error();
    return { commitOid, blob };
  } catch { throw new Error("task_artifact_ref_conflict"); }
}
export function retainTaskArtifact(repository: string, source: TaskArtifactReference): TaskArtifactRetentionReceipt {
  assertSource(source);
  const repo = openRepository(repository);
  const worktree = assertSourceBinding(source.worktree, repo.commonDir);
  const artifactPath = artifactRelativePath(source, worktree);
  const ref = retentionRef(source);
  const existing = existingRefBlob(repo, ref, artifactPath);
  if (existing) {
    if (sha256(existing.blob.bytes) !== source.sha256) throw new Error("task_artifact_ref_conflict");
    return buildReceipt(repo, source, ref, existing.commitOid, existing.blob);
  }
  const tips = refTips(repo.commonDir, repo.root, repo.zeroOid.length);
  const history = tips.length > 0
    ? gitText(repo.commonDir, repo.root, ["rev-list", `--max-count=${MAX_SCANNED_COMMITS}`, ...tips, "--",
      process.platform === 'win32' ? `:(icase,literal)${artifactPath}` : artifactPath])
      .split(/\r?\n/u).filter(Boolean) : [];
  const found = findHistoricalBlob(repo, [...new Set([...tips, ...history])].slice(0, MAX_SCANNED_COMMITS), artifactPath, source.sha256);
  if (!found) throw new Error("task_artifact_not_found");
  try { gitText(repo.commonDir, repo.root, ["update-ref", ref, found.commitOid, repo.zeroOid]); }
  catch { throw new Error("task_artifact_ref_conflict"); }
  if (gitText(repo.commonDir, repo.root, ["rev-parse", "--verify", `${ref}^{commit}`]) !== found.commitOid) throw new Error("task_artifact_ref_conflict");
  return buildReceipt(repo, source, ref, found.commitOid, found.blob);
}
export function readRetainedTaskArtifact(receipt: TaskArtifactRetentionReceipt): Buffer {
  if (receipt?.schemaVersion !== 1 || receipt.actor !== "agent" || !receipt.retained || !receipt.source
    || !Number.isSafeInteger(receipt.verifiedAt)
    || receipt.receiptId !== receiptDigest(receipt.source, receipt.retained, receipt.verifiedAt)) throw new Error("task_artifact_receipt_invalid");
  assertSource(receipt.source);
  const retained = receipt.retained;
  const sourcePath = containedRel(resolveWithoutNative(receipt.source.worktree), resolveWithoutNative(receipt.source.path));
  if (!retained.ref.startsWith(RETENTION_PREFIX) || retained.ref !== retentionRef(receipt.source)
    || (process.platform === 'win32' ? sourcePath?.toLowerCase() !== retained.path.toLowerCase() : sourcePath !== retained.path)) throw new Error("task_artifact_receipt_invalid");
  const repo = openRepository(retained.repository);
  if (repo.identity !== retained.repositoryIdentity || repo.commonDir !== resolveWithoutNative(retained.repository)) throw new Error("task_artifact_repository_replaced");
  let current: string;
  try { current = gitText(repo.commonDir, repo.root, ["show-ref", "--verify", "--hash", retained.ref]); }
  catch { throw new Error("task_artifact_ref_missing"); }
  if (current !== retained.commitOid) throw new Error("task_artifact_ref_changed");
  const blob = blobAt(repo.commonDir, repo.root, retained.commitOid, retained.path);
  if (!blob) throw new Error("task_artifact_blob_missing");
  if (blob.oid !== retained.blobOid) throw new Error("task_artifact_blob_changed");
  if (blob.bytes.length !== retained.sizeBytes) throw new Error("task_artifact_size_changed");
  if (sha256(blob.bytes) !== receipt.source.sha256) throw new Error("task_artifact_hash_mismatch");
  return Buffer.from(blob.bytes);
}
function resolveWithoutNative(input: string): string {
  const actual = resolve(input).replace(/^\\\\\?\\UNC\\/u, "\\\\").replace(/^\\\\\?\\/u, "").replace(/\\/g, "/");
  return process.platform === "win32" ? actual.toLowerCase() : actual;
}
