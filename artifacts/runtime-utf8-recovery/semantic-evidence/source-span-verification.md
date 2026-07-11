# Source-Span Verification

## Preserved Inputs

- `report.json` SHA-256:
  `c25638950b8e557cb30894295edb4bedd137365103df48864b353e286196958c`
- `anchored-codepoint-report.json` SHA-256:
  `1f61e75ac07600c788c9c8e291059287db3f9ccc8466c293be0ec8b052dfc728`

Both reports are retained unchanged and marked superseded for repair
application.

## Final Evidence

- Inventory records: 1,571
- Affected files: 370
- Unique source-aligned spans: 1,504
- Corroborated records: 1,571
- Candidate records: 0
- Conflict records: 0
- Unresolved records: 0
- Expanding spans: 1,359
- Contracting spans: 0
- Net restored bytes: 1,418
- Files with complete strict-UTF-8 reconstruction: 370

The expansion count proves that equal-length code-point replacement would have
been materially incomplete.

## Independent Guarded-Apply Check

The verifier created an OS temporary directory, populated all 370 files from
the current Git blob preimages, converted the report to the W1 version 2
`source-aligned-variable-length` manifest, and invoked the actual W1
`applyRecoveryManifest` implementation.

Result:

```text
filesPrepared=370
filesApplied=370
postimageHashesMatch=true
```

The temporary path was resolved beneath the OS temporary directory before
recursive removal. No Runtime source file in any recovery or protected
worktree was written.

## Comment-Only Signature Rule

Six comment-only em-dash spans had one direct valid-history source. They were
corroborated by the independently established cross-file corruption signature
`e2803f -> e2809420`, supported by 607 records and multiple upstream/local
source IDs. The rule is tested to reject runtime strings and other
behavior-sensitive values.
