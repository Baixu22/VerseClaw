// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readRetainedTaskArtifact,
  retainTaskArtifact,
} from '../../shared/task-system/artifact-retention';
import type {
  TaskArtifactReference,
  TaskArtifactRetentionReceipt,
} from '../../shared/task-system/artifact-retention';

vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
const artifactPath = 'artifacts/checkpoint.bin';

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function createRepository(): string {
  const fixture = mkdtempSync(join(tmpdir(), 'task-artifact-retention-'));
  roots.push(fixture);
  const repo = join(fixture, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '--quiet');
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(repo, 'config', 'user.name', 'Retention Fixture');
  git(repo, 'config', 'user.email', 'retention@example.invalid');
  return repo;
}

function writeArtifact(repo: string, bytes: Buffer): string {
  const target = join(repo, ...artifactPath.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return target;
}

function commitArtifact(repo: string, message: string): string {
  git(repo, 'add', '--', artifactPath);
  git(repo, 'commit', '--quiet', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function sourceFor(repo: string, bytes: Buffer, target = writeArtifact(repo, bytes)): TaskArtifactReference {
  return {
    taskNodeId: 'TF0867',
    sourceKey: 'retention-git-helper',
    kind: 'checkpoint',
    worktree: repo,
    path: target,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function receiptClone(receipt: TaskArtifactRetentionReceipt): TaskArtifactRetentionReceipt {
  const clone = JSON.parse(JSON.stringify(receipt)) as TaskArtifactRetentionReceipt;
  clone.receiptId = digest(Buffer.from(canonicalJson({
    schemaVersion: 1,
    source: clone.source,
    retained: clone.retained,
    actor: 'agent',
    verifiedAt: clone.verifiedAt,
  })));
  return clone;
}

function createBoundedHistory(repo: string, targetBytes: Buffer): void {
  const chunks: Buffer[] = [];
  const text = (value: string) => chunks.push(Buffer.from(value));
  const data = (value: Buffer) => {
    text(`data ${value.length}\n`);
    chunks.push(value, Buffer.from('\n'));
  };
  text('blob\nmark :1\n');
  data(targetBytes);
  text('commit refs/heads/main\nmark :2\n');
  text('author Fixture <fixture@example.invalid> 1700000000 +0000\n');
  text('committer Fixture <fixture@example.invalid> 1700000000 +0000\n');
  data(Buffer.from('target\n'));
  text(`M 100644 :1 ${artifactPath}\n\n`);
  let parentMark = 2;
  for (let index = 0; index < 257; index++) {
    const blobMark = 3 + index * 2;
    const commitMark = blobMark + 1;
    text(`blob\nmark :${blobMark}\n`);
    data(Buffer.from(`replacement-${index}`));
    text(`commit refs/heads/main\nmark :${commitMark}\n`);
    text(`author Fixture <fixture@example.invalid> ${1700000001 + index} +0000\n`);
    text(`committer Fixture <fixture@example.invalid> ${1700000001 + index} +0000\n`);
    data(Buffer.from(`bounded-${index}\n`));
    text(`from :${parentMark}\nM 100644 :${blobMark} ${artifactPath}\n\n`);
    parentMark = commitMark;
  }
  text('done\n');
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, input: Buffer.concat(chunks) });
  git(repo, 'reset', '--hard', '--quiet', 'main');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('task artifact Git retention', () => {
  it.each(['refs/agent-retention/proof', 'refs/worktree/temporary'])('uses the same shared-ref classification as checkout cleanup (%s)', ref => {
    const repo = createRepository(), bytes = Buffer.from('retained through native ref');
    const source = sourceFor(repo, bytes), head = commitArtifact(repo, 'native ref');
    git(repo, 'checkout', '--detach', head); git(repo, 'update-ref', ref, head); git(repo, 'update-ref', '-d', 'refs/heads/main');
    if (ref.startsWith('refs/worktree/')) expect(() => retainTaskArtifact(repo, source)).toThrow('task_artifact_not_found');
    else expect(readRetainedTaskArtifact(retainTaskArtifact(repo, source))).toEqual(bytes);
  });
  it.skipIf(process.platform !== 'win32').each([false, true])('resolves canonical lowercase Task paths to historical Git spelling (removed=%s)', removed => {
    const repo = createRepository(), bytes = Buffer.from('Mixed-case historical artifact');
    const target = join(repo, 'Artifacts', 'Result.bin'); mkdirSync(dirname(target)); writeFileSync(target, bytes);
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'mixed-case');
    const source: TaskArtifactReference = { taskNodeId: 'case-task', sourceKey: 'checkpoint:1', kind: 'checkpoint',
      worktree: repo.toLowerCase(), path: target.toLowerCase(), sha256: digest(bytes) };
    if (removed) { git(repo, 'rm', 'Artifacts/Result.bin'); git(repo, 'commit', '-qm', 'remove current artifact'); }
    const receipt = retainTaskArtifact(repo, source);
    expect(receipt.retained.path).toBe('Artifacts/Result.bin');
    expect(readRetainedTaskArtifact(receipt)).toEqual(bytes);
  });
  it('retains a binary artifact larger than the default child-process buffer', () => {
    const repo = createRepository(), bytes = Buffer.alloc(2 * 1024 * 1024, 173);
    bytes[0] = 0; bytes[bytes.length - 1] = 255;
    const source = sourceFor(repo, bytes); commitArtifact(repo, 'large binary');
    const receipt = retainTaskArtifact(repo, source);
    expect(receipt.retained.sizeBytes).toBe(bytes.length);
    expect(readRetainedTaskArtifact(receipt)).toEqual(bytes);
  });
  it('retains an older binary blob when the live file already contains different bytes', () => {
    const repo = createRepository();
    const oldBytes = Buffer.from([0, 255, 13, 10, 128, 1, 2, 3]);
    const source = sourceFor(repo, oldBytes);
    const oldCommit = commitArtifact(repo, 'old checkpoint');
    writeArtifact(repo, Buffer.from('checkpoint v2\r\n', 'utf8'));
    const head = commitArtifact(repo, 'new checkpoint');

    const receipt = retainTaskArtifact(repo, source);

    expect(receipt.schemaVersion).toBe(1);
    expect(receipt.actor).toBe('agent');
    expect(receipt.source).toEqual(source);
    expect(receipt.retained.ref).toMatch(/^refs\/agent-retention\/tasks\/[0-9a-f]{64}$/);
    expect(receipt.retained.commitOid).toBe(oldCommit);
    expect(receipt.retained.commitOid).not.toBe(head);
    expect(receipt.retained.path).toBe(artifactPath);
    expect(readRetainedTaskArtifact(receipt)).toEqual(oldBytes);
  });

  it('retains historical bytes when the live artifact has already been deleted', () => {
    const repo = createRepository();
    const bytes = Buffer.from('historical checkpoint');
    const source = sourceFor(repo, bytes);
    commitArtifact(repo, 'historical checkpoint');
    unlinkSync(source.path);

    const receipt = retainTaskArtifact(repo, source);

    expect(readRetainedTaskArtifact(receipt)).toEqual(bytes);
  });

  it('reads through the canonical common-dir after a linked checkout is removed', () => {
    const repo = createRepository();
    const bytes = Buffer.from('linked worktree bytes');
    writeArtifact(repo, bytes);
    commitArtifact(repo, 'linked base');
    const linked = join(roots[roots.length - 1]!, 'linked');
    git(repo, 'worktree', 'add', '--quiet', '--detach', linked, 'HEAD');
    const source = sourceFor(linked, bytes);

    const receipt = retainTaskArtifact(repo, source);
    expect(receipt.retained.repository.endsWith('/.git')).toBe(true);
    git(repo, 'worktree', 'remove', '--force', linked);

    expect(readRetainedTaskArtifact(receipt)).toEqual(bytes);
  });

  it('reuses the existing ref before scanning identical bytes at a newer commit', () => {
    const repo = createRepository();
    const bytes = Buffer.from('same bytes in two commits');
    const source = sourceFor(repo, bytes);
    const firstCommit = commitArtifact(repo, 'first identical blob');
    const first = retainTaskArtifact(repo, source);

    writeFileSync(join(repo, 'other.txt'), 'second commit\n');
    git(repo, 'add', '--', 'other.txt');
    git(repo, 'commit', '--quiet', '-m', 'same artifact bytes');
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(firstCommit);
    const retry = retainTaskArtifact(repo, source);

    expect(retry.retained.ref).toBe(first.retained.ref);
    expect(retry.retained.commitOid).toBe(firstCommit);
    expect(readRetainedTaskArtifact(retry)).toEqual(bytes);
  });

  it('rejects a missing ref and a retention ref moved to another commit', () => {
    const repo = createRepository();
    const source = sourceFor(repo, Buffer.from([1, 2, 3, 4]));
    commitArtifact(repo, 'checkpoint');
    const receipt = retainTaskArtifact(repo, source);

    git(repo, 'update-ref', '-d', receipt.retained.ref);
    expect(() => readRetainedTaskArtifact(receipt)).toThrow(/task_artifact_ref_missing/);

    const restored = retainTaskArtifact(repo, source);
    writeArtifact(repo, Buffer.from('a newer commit'));
    const newer = commitArtifact(repo, 'new ref target');
    git(repo, 'update-ref', restored.retained.ref, newer);
    expect(() => readRetainedTaskArtifact(restored)).toThrow(/task_artifact_ref_changed/);
  });

  it('does not overwrite a conflicting existing retention ref', () => {
    const repo = createRepository();
    const source = sourceFor(repo, Buffer.from('older bytes'));
    commitArtifact(repo, 'older bytes');
    const receipt = retainTaskArtifact(repo, source);
    writeArtifact(repo, Buffer.from('conflicting head'));
    const conflicting = commitArtifact(repo, 'conflicting head');
    git(repo, 'update-ref', receipt.retained.ref, conflicting);

    expect(() => retainTaskArtifact(repo, source)).toThrow(/task_artifact_ref_conflict/);
    expect(git(repo, 'rev-parse', receipt.retained.ref)).toBe(conflicting);
  });

  it('rejects corrupted receipt metadata, blob identity, and source hash mismatches', () => {
    const repo = createRepository();
    const source = sourceFor(repo, Buffer.from('verified bytes'));
    commitArtifact(repo, 'verified bytes');
    const receipt = retainTaskArtifact(repo, source);

    const corruptMetadata = JSON.parse(JSON.stringify(receipt)) as TaskArtifactRetentionReceipt;
    corruptMetadata.verifiedAt += 1;
    expect(() => readRetainedTaskArtifact(corruptMetadata)).toThrow(/task_artifact_receipt_invalid/);

    const changedBlob = receiptClone(receipt);
    changedBlob.retained.blobOid = '0'.repeat(changedBlob.retained.blobOid.length);
    expect(() => readRetainedTaskArtifact(receiptClone(changedBlob))).toThrow(/task_artifact_blob_changed/);

    const changedHash = receiptClone(receipt);
    changedHash.source.sha256 = digest(Buffer.from('different bytes'));
    changedHash.retained.ref = `refs/agent-retention/tasks/${createHash('sha256')
      .update(changedHash.source.taskNodeId).update('\0')
      .update(changedHash.source.sourceKey).update('\0')
      .update(Buffer.from(changedHash.source.sha256, 'hex')).digest('hex')}`;
    const sealedHash = receiptClone(changedHash);
    git(repo, 'update-ref', sealedHash.retained.ref, sealedHash.retained.commitOid);
    expect(() => readRetainedTaskArtifact(sealedHash)).toThrow(/task_artifact_hash_mismatch/);
  });

  it('ignores a misbound core.worktree and preserves the live native bytes and config', () => {
    const repo = createRepository();
    const bytes = Buffer.from('native worktree bytes');
    const source = sourceFor(repo, bytes);
    commitArtifact(repo, 'native bytes');
    const neighbor = join(roots[roots.length - 1]!, 'neighbor');
    mkdirSync(neighbor);
    const neighborArtifact = writeArtifact(neighbor, Buffer.from('neighbor bytes'));
    git(repo, 'config', 'core.worktree', neighbor);
    const configPath = join(repo, '.git', 'config');
    const configBefore = readFileSync(configPath, 'utf8');

    const receipt = retainTaskArtifact(repo, source);

    expect(readRetainedTaskArtifact(receipt)).toEqual(bytes);
    expect(readFileSync(source.path)).toEqual(bytes);
    expect(readFileSync(neighborArtifact)).toEqual(Buffer.from('neighbor bytes'));
    expect(readFileSync(configPath, 'utf8')).toBe(configBefore);
  });

  it('rejects paths outside the worktree and a different source repository', () => {
    const repo = createRepository();
    const outside = join(roots[roots.length - 1]!, 'outside.bin');
    writeFileSync(outside, Buffer.from('outside'));
    const outsideSource = sourceFor(repo, Buffer.from('outside'), outside);
    expect(() => retainTaskArtifact(repo, outsideSource)).toThrow(/task_artifact_path_outside_worktree/);

    const source = sourceFor(repo, Buffer.from('inside'));
    commitArtifact(repo, 'inside');
    const other = createRepository();
    expect(() => retainTaskArtifact(other, source)).toThrow(/task_artifact_worktree_binding_mismatch/);
  });

  it('detects repository replacement at the retained common-dir', () => {
    const repo = createRepository();
    const source = sourceFor(repo, Buffer.from('repository identity'));
    commitArtifact(repo, 'identity');
    const receipt = retainTaskArtifact(repo, source);

    renameSync(repo, `${repo}-moved`);
    mkdirSync(repo);
    git(repo, 'init', '--quiet');
    expect(() => readRetainedTaskArtifact(receipt)).toThrow(/task_artifact_repository_replaced/);
  });

  it('bounds lookup to 256 ref-tip and historical commits', () => {
    const repo = createRepository();
    const targetBytes = Buffer.from('target beyond history bound');
    const source = sourceFor(repo, targetBytes);
    createBoundedHistory(repo, targetBytes);

    expect(() => retainTaskArtifact(repo, source)).toThrow(/task_artifact_not_found/);
  }, 180_000);
});
