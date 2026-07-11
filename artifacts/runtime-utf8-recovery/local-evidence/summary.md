# Local UTF-8 Recovery Evidence

## Sources

- All reachable refs and unique historical blobs in the user's main Git
  repository.
- Initial Verse Claw import
  `ac5a068305391b5b561f8b2b06e6036a48c0d8db`.
- Checkpoint
  `80044162564c8366c06f0d1d81300f04c808de8d`.
- Verified main and DCS recovery backups.
- VS Code and Trae local-history indexes.

The main workspace and every local artifact were read-only.

## Method

For each affected path, the analysis enumerates reachable historical commits,
deduplicates their Git blobs, rejects invalid UTF-8 historical blobs, and
compares valid versions with the canonical damaged Git blob. A record is
`exact` only when a valid historical blob is byte-identical outside all
inventoried damaged ranges. A unique context match remains a candidate.

## Result

| Status | Units |
| --- | ---: |
| Exact | 5 |
| Candidate | 148 |
| Conflict | 0 |
| Unresolved | 1,418 |

No VS Code or Trae history entry referenced
`openclaw_runtime/extensions/**`. Generated build output was retained as
possible semantic evidence but was not treated as exact source-byte evidence.

The initial import proves that at least some later-damaged QQBot files had
valid UTF-8 before checkpoint `800441625`, but most files also changed outside
the damaged ranges. Those versions therefore cannot be copied wholesale.

Machine report SHA-256:
`3281751D874563389801732AB1473977E7A69880E196C203CD473AE3ADFB291E`.

## Safety Conclusion

Local history independently confirms several upstream candidates, but fixed
context cannot resolve lines containing multiple nearby damaged units. Those
records remain unresolved pending multi-range line alignment and semantic
review.
