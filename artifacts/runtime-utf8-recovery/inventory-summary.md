# Runtime UTF-8 Inventory Summary

## Identity

- Coordinator seed: `addae094ab8419baef1e890f769ba3b581cdeff7`
- Original repository base: `623677ec6cda799fec6f305809ed4db37a514d70`
- Git object format: SHA-1
- Inventory source: Git index blob bytes
- Worktree comparison: Git clean-filter-aware blob identity

## Result

The strict baseline command exited 1 as required while malformed UTF-8
remains:

```text
trackedFiles=11275
textFiles=11245
binaryFiles=30
invalidFiles=370
invalidUnits=1571
worktreeMismatches=0
```

All 1,571 malformed units currently have reason `invalid-continuation`.
The most common byte prefixes are:

| Prefix | Count |
| --- | ---: |
| `e2803f` | 729 |
| `e2863f` | 298 |
| `e3803f` | 77 |
| `efbc3f` | 60 |
| `e29c3f` | 38 |
| `e29d3f` | 25 |

The largest affected path groups are:

| Path group | Files | Units |
| --- | ---: | ---: |
| `openclaw_runtime/extensions/qqbot` | 90 | 699 |
| `openclaw_runtime/extensions/msteams` | 27 | 88 |
| `openclaw_runtime/extensions/oc-path` | 19 | 86 |
| `openclaw_runtime/extensions/memory-core` | 9 | 80 |
| `openclaw_runtime/extensions/imessage` | 22 | 78 |
| `openclaw_runtime/extensions/telegram` | 25 | 77 |
| `openclaw_runtime/extensions/copilot` | 11 | 45 |
| `openclaw_runtime/extensions/discord` | 17 | 43 |

## Interpretation

The zero mismatch count proves the malformed units belong to the committed Git
blobs rather than checkout conversion or uncommitted user edits. Distribution
across behavior-sensitive plugin and protocol surfaces rules out blanket
replacement or wholesale upstream restoration. Every repair requires a
preimage hash, exact or corroborated evidence, and a frozen owner allowlist.

## Evidence Files

- `inventory.json`: per-file Git object identity, SHA-256, byte length,
  malformed ranges, and bounded byte context.
- `baseline-scan.log`: real RED showing the initial large-index `ENOBUFS`.
- `baseline-scan-git-blobs.log`: strict Git-blob inventory result.
- `red-green/*.log`: W1 test-first evidence.
