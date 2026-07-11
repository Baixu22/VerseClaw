# Upstream UTF-8 Recovery Evidence

## Sources

- Historical upstream commit `e993e1c334c6ee0995106730d750d44a9320e5bb`
  (`2026.6.2`).
- Current comparison snapshot `2026.6.11`.
- Canonical local inventory from coordinator seed `addae094a`.

The snapshots are evidence only. No Runtime source was copied or modified.

## Method

For every malformed range, the analysis first checks whether an upstream file
has the same length and is byte-identical outside all inventoried damaged
ranges. Otherwise it searches for a unique alignment with exact byte context
on both sides, shrinking the context only to a minimum of eight bytes.
Candidate replacement bytes must decode as strict UTF-8.

`exact` means at least one snapshot is identical outside all damaged ranges.
`corroborated` means both independent snapshots uniquely align and return the
same bytes. A single-snapshot match remains `candidate`; conflicting or absent
matches remain unresolved.

## Result

| Status | Units |
| --- | ---: |
| Exact | 2 |
| Corroborated | 147 |
| Candidate | 3 |
| Unresolved | 1,419 |

The 149 strong records span 35 files. The two whole-file exact records are:

- `extensions/qqbot/src/engine/config/credentials.ts@94` -> `e38082`
- `extensions/qqbot/src/engine/config/setup-logic.ts@84` -> `e38082`

The three single-source candidates remain unapproved:

- `extensions/copilot/src/telemetry-bridge.ts@422`
- `extensions/qqbot/src/engine/tools/remind-logic.ts@10183`
- `extensions/slack/src/monitor/provider.ts@22723`

## Evidence Integrity

- Machine report SHA-256:
  `B1D3B8C5A6C4402F1F35A04EB82DFC901635BD62BA4AABDAF6D99C9C84AB5F4A`
- Runtime production files changed: zero.
- Ambiguous or unmatched candidates were not guessed.
