# Frozen Manifest Evidence

## TDD

Initial command:

```text
node --test artifacts/runtime-utf8-recovery/manifest/freeze-manifest.test.mjs
```

Exit: `1`

Expected failure: `freeze-manifest.mjs` did not exist.

After the first implementation, the package-atomic partition test exposed a
real scheduling imbalance: the `qqbot` package alone owned 655 spans while the
other partitions had 283 each. A new RED required file-level ownership and
proved the package remained confined to one partition (`1 !== 2`).

Final focused command: same Node test command.

Exit: `0`

Result: `3/3` tests passed for merged-span deduplication, complete
pairwise-disjoint file partitioning, workload balance, and refusal to freeze
incomplete evidence.

## Frozen Result

```text
files=370 spans=1504 records=1571
partition=a files=80 spans=376
partition=b files=95 spans=376
partition=c files=97 spans=376
partition=d files=98 spans=376
```

Files are the smallest write-ownership unit. One file appears in exactly one
allowlist. Extension packages may appear in more than one worktree, but workers
cannot edit the same file and run tests only inside their own isolated
worktree.

## Preconditions

- Source-span evidence schema: version 2
- Span model: `source-aligned-variable-length`
- Candidate records: 0
- Conflict records: 0
- Unresolved records: 0
- Every file has preimage and expected postimage SHA-256
- Every replacement has remove bytes, insert bytes, left/right anchors,
  inventory record IDs, and nonempty evidence IDs
- File-local replacement spans do not overlap
