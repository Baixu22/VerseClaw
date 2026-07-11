# Runtime UTF-8 Recovery Window Launch Pack

> **For agentic workers:** This launch pack coordinates evidence work only.
> It does not authorize Runtime source repair or DCS Stage 1 production edits.

**Goal:** Recompute all 1,571 malformed Runtime records as source-aligned,
variable-length byte spans before any production source is changed.

**Current base:** `623677ec6cda799fec6f305809ed4db37a514d70`

**Protected workspaces:**

- `C:\Users\27933\Desktop\clawx\ClawX`
- `C:\dcs1v-bc74257f`

Both are read-only evidence. All writes remain under `C:\dcs-recovery`.

## Why The Previous Evidence Is Not Apply-Ready

The existing reports often model a malformed UTF-8 unit as an equal-length
code-point replacement. That assumption is unsafe. The corruption may also
have consumed bytes immediately after the malformed code point.

For example, the intended bytes for `"が",` include:

```text
22 e3 81 8c 22 2c
```

A damaged line can contain:

```text
22 e3 81 3f 2c
```

Replacing only `e3813f` with `e3818c` does not restore the swallowed closing
quote. The source-aligned repair may instead be:

```text
removeHex: e3813f
insertHex: e3818c22
```

Therefore `replacementHex` values in the existing W2-W4 reports are evidence
candidates only. They must not be applied to Runtime source.

## Window Topology

Open five Codex windows at most:

| Window | Worktree | Branch | May write |
| --- | --- | --- | --- |
| W0 | `C:\dcs-recovery\coordinator` | `codex/recovery-coordinator` | orchestration and integrated evidence |
| W1 | `C:\dcs-recovery\inventory` | `codex/runtime-utf8-inventory` | scanner, schema, tests, inventory artifacts |
| W2 | `C:\dcs-recovery\upstream` | `codex/runtime-utf8-upstream-evidence` | upstream evidence reports only |
| W3 | `C:\dcs-recovery\local-evidence` | `codex/runtime-utf8-local-evidence` | local evidence reports only |
| W4 | `C:\dcs-recovery\semantic` | `codex/runtime-utf8-semantic-evidence` | semantic evidence reports only |

Do not create or start W5-W8. Repair workers are blocked until W0 publishes a
frozen manifest with zero unresolved spans and pairwise-disjoint allowlists.

## Operator Preflight

Run these checks before sending any worker prompt:

```powershell
$Expected = @{
  'C:\dcs-recovery\coordinator'    = 'codex/recovery-coordinator'
  'C:\dcs-recovery\inventory'      = 'codex/runtime-utf8-inventory'
  'C:\dcs-recovery\upstream'       = 'codex/runtime-utf8-upstream-evidence'
  'C:\dcs-recovery\local-evidence' = 'codex/runtime-utf8-local-evidence'
  'C:\dcs-recovery\semantic'       = 'codex/runtime-utf8-semantic-evidence'
}

foreach ($Path in $Expected.Keys) {
  $Branch = git -C $Path branch --show-current
  $Head = git -C $Path rev-parse HEAD
  $Status = git -C $Path status --short
  [pscustomobject]@{
    Path = $Path
    ExpectedBranch = $Expected[$Path]
    ActualBranch = $Branch
    Head = $Head
    Dirty = [bool]$Status
  }
}
```

Expected starting commits:

| Window | Expected HEAD |
| --- | --- |
| W0 | the commit containing this launch pack |
| W1 | `5d55976d` |
| W2 | `afa5125b` |
| W3 | `aecefc69` |
| W4 | `addae094a` with two untracked semantic JSON reports |

W4's two untracked reports are known evidence. W4 must preserve them, mark the
code-point-only report superseded, and must not delete or overwrite them
without first recording their SHA-256 values.

Verify the two immutable backup sets and their hash inventories still exist:

```powershell
Get-ChildItem 'C:\dcs-recovery\backups\20260711-093359-main'
Get-ChildItem 'C:\dcs-recovery\backups\20260711-093359-dcs1v'
```

Do not run package installation in the protected workspaces. Evidence workers
need only Git and the existing Node.js runtime. Run tests sequentially inside
each worktree.

## Shared Prefix For W1-W4

Paste this prefix before the role-specific prompt in each worker window:

```text
You are an evidence worker in a controlled byte-forensic recovery. Read
AGENTS.md and every scoped AGENTS.md before acting. Also read:

- docs/superpowers/specs/2026-07-11-dcs-stage1-recovery-orchestration-design.md
- docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md
- C:\dcs-recovery\coordinator\docs\superpowers\plans\2026-07-11-runtime-utf8-recovery-window-launch-pack.md

The protected workspaces C:\Users\27933\Desktop\clawx\ClawX and
C:\dcs1v-bc74257f are read-only evidence. Never run git reset --hard, git
clean, destructive checkout, manual stash, bulk encoding conversion, or a
command that writes to either protected workspace. Never use lossy decoding,
U+FFFD, guessed text, visual plausibility, wholesale upstream replacement, or
an equal-length replacement assumption.

Work only in the assigned worktree and branch. Before editing, report the
absolute path, branch, HEAD, git status, and the SHA-256 of every pre-existing
untracked evidence file. Stop if path or branch differs from the assignment.
Preserve unexpected changes as evidence. Use apply_patch for manual edits.
Do not edit Runtime production source.

The recovery unit is a source-aligned variable-length span:
- currentOffset: byte offset in the exact Git blob preimage;
- removeHex: complete current byte span to remove;
- insertHex: complete source byte span to insert, with no equal-length rule;
- leftAnchorHex and rightAnchorHex: preserved bytes bounding the span;
- source provenance, source file hash, and source offsets;
- preimageSha256 and expectedPostimageSha256;
- confidence: exact, corroborated, candidate, conflict, or unresolved.

A code point alone is not a repair. Alignment must account for swallowed
quotes, brackets, punctuation, variation selectors, zero-width joiners, and
other adjacent bytes. Return changed files, commands with exact exit codes,
commit SHA, remaining uncertainties, and proof that no out-of-scope path
changed.
```

## W1 Prompt: Schema And Guarded Apply

```text
ROLE: W1 variable-length recovery tooling owner.
WORKTREE: C:\dcs-recovery\inventory
BRANCH: codex/runtime-utf8-inventory
START HEAD: 5d55976d
WRITE ALLOWLIST:
- openclaw_runtime/scripts/runtime-utf8-inventory.mjs
- openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs
- harness/specs/tasks/runtime-utf8-baseline-remediation.md
- artifacts/runtime-utf8-recovery/inventory/**
- artifacts/runtime-utf8-recovery/tooling/**

Use strict TDD. First add RED tests proving:
1. a repair may expand bytes, for example e3813f -> e3818c22;
2. a repair may contract bytes;
3. multiple variable-length spans are applied against original offsets;
4. overlapping remove spans are rejected;
5. left/right anchor mismatch is rejected;
6. preimage hash mismatch is rejected;
7. removeHex mismatch is rejected;
8. missing expected postimage hash is rejected;
9. postimage hash mismatch is rejected;
10. candidate, conflict, and unresolved confidence cannot be applied;
11. path escape cannot be applied.

Preserve the canonical inventory counts and do not reinterpret malformed UTF-8
scanner offsets as complete source repair spans. Implement a versioned manifest
schema for source-aligned spans. Apply from descending original offsets or use
an equivalent immutable-preimage algorithm, then verify the complete
postimage SHA-256.

Do not generate repair candidates and do not edit production source. Update the
Harness task only for tooling/evidence touchedAreas; explicitly state that W0
must freeze exact source allowlists and revalidate before source repair.

Required proof:
- show the failing RED command and failure reason;
- show the GREEN command with all tooling tests passing;
- run Harness context;
- stage only allowlisted changes and run Harness validate on the real diff;
- run git diff --cached --check;
- commit and return the commit SHA.
```

## W2 Prompt: Upstream Full-Span Alignment

```text
ROLE: W2 upstream source-alignment analyst.
WORKTREE: C:\dcs-recovery\upstream
BRANCH: codex/runtime-utf8-upstream-evidence
START HEAD: afa5125b
WRITE ALLOWLIST:
- artifacts/runtime-utf8-recovery/upstream-evidence/**

Treat the existing report as superseded code-point evidence, not an apply
manifest. Preserve its SHA-256 in the new report.

Recompute all 1,571 records against:
- historical upstream e993e1c334c6ee0995106730d750d44a9320e5bb;
- current upstream snapshot 2026.6.11.

Use byte-level sequence alignment bounded by preserved anchors. For every
record determine the full current remove span and full source insert span.
Alignment must include source bytes swallowed after the malformed sequence,
including delimiters, punctuation, variation selectors, and ZWJ sequences.
Record source blob SHA-256, source offsets, unchanged prefix/suffix lengths,
left/right anchors, and whether both snapshots independently agree.

Classify:
- exact only when undamaged local bytes provide one unambiguous alignment;
- corroborated only when two independent source snapshots agree on the full
  insert span and anchors;
- candidate when only one source supports the full span;
- conflict when sources yield different full spans;
- unresolved when no bounded alignment is defensible.

Add self-checks that reconstruct a candidate postimage in memory and verify:
strict UTF-8, preserved bytes outside remove spans, no overlap, deterministic
ordering, and source anchors. Do not write reconstructed production files.
Commit only the new report, summary, and any report-local analysis script.
Return counts totaling exactly 1,571 and the commit SHA.
```

## W3 Prompt: Local Full-Span Evidence

```text
ROLE: W3 local full-span evidence analyst.
WORKTREE: C:\dcs-recovery\local-evidence
BRANCH: codex/runtime-utf8-local-evidence
START HEAD: aecefc69
WRITE ALLOWLIST:
- artifacts/runtime-utf8-recovery/local-evidence/**

Treat the existing report as superseded code-point evidence, not an apply
manifest. Preserve its SHA-256 in the new report.

Revisit all locally recoverable records using complete source spans. Search
reachable Git history/refs, the initial import ac5a0683, checkpoint 80044162,
verified backup bundles, and already-indexed local artifacts. Do not repeat
editor-history searches already proven empty unless new evidence exists.

For each match, align exact blob bytes around stable left/right anchors and
derive currentOffset, removeHex, insertHex, source offsets, preimage hash, and
candidate postimage hash. Detect bytes swallowed after the malformed UTF-8
unit. A whole-file match outside all damaged regions may be exact; a unique
context match is only as strong as its provenance and full-span alignment.

Hash every source artifact before use. Flag conflicts instead of choosing one.
Add report consistency checks: records total 1,571, no overlapping spans per
file, anchors match the current preimage, reconstructed content is strict
UTF-8, and bytes outside declared spans are unchanged.

Do not edit scanner code, task specs, tests, or production source. Commit only
allowlisted evidence and return exact/corroborated/candidate/conflict/
unresolved counts plus the commit SHA.
```

## W4 Prompt: Semantic Resolution And Alignment Audit

```text
ROLE: W4 semantic and behavior-sensitive evidence analyst.
WORKTREE: C:\dcs-recovery\semantic
BRANCH: codex/runtime-utf8-semantic-evidence
START HEAD: addae094a
KNOWN UNTRACKED EVIDENCE:
- artifacts/runtime-utf8-recovery/semantic-evidence/report.json
- artifacts/runtime-utf8-recovery/semantic-evidence/anchored-codepoint-report.json
WRITE ALLOWLIST:
- artifacts/runtime-utf8-recovery/semantic-evidence/**

First hash and preserve the two known reports. Mark both as superseded for
repair application because they model code points rather than complete
source-aligned spans.

Build a new full-span semantic report. Start with the 32 records previously
classified as candidate/conflict/unresolved, but audit all 1,571 records for
swallowed adjacent bytes. Use tests, duplicate constants, protocol schemas,
locale data, callers, regex consumers, source snapshots, and valid historical
blobs as independent evidence.

Pay special attention to:
- imessage/src/monitor/reaction-context.ts@733: questioned should be tested
  against the actual reaction mapping; do not choose between question and
  heart from English intuition alone;
- concept-vocabulary.ts: recover complete quoted vocabulary tokens and their
  delimiters, not only CJK code points;
- Telegram emoji lists: preserve complete string delimiters, variation
  selectors, and list punctuation;
- Slack technologist emoji: preserve the complete ZWJ sequence;
- iMessage approval comments/strings: distinguish non-behavioral comments
  from values consumed at runtime;
- the six em-dash candidates: comments still need exact source-span evidence.

For each accepted span name two independent evidence sources and the focused
test that would protect a future source repair. If two sources do not support
the same full insert span, leave it conflict or unresolved.

Do not edit tests or production source. Commit the old hashed reports plus the
new report, summary, and report-local scripts. Return counts totaling exactly
1,571, a list of every non-exact record, and the commit SHA.
```

## W0 Prompt: Integration And Freeze

W0 starts now only as a monitor. It must not cherry-pick partial W1-W4 work.
After all four workers return committed evidence, send:

```text
ROLE: W0 evidence integrator and manifest freezer.
WORKTREE: C:\dcs-recovery\coordinator
BRANCH: codex/recovery-coordinator
START HEAD: the commit containing this launch pack

Read all W1-W4 summaries and inspect every commit before integration. Cherry-
pick one commit at a time. After each cherry-pick, verify git diff --check and
that the commit changes only its worker allowlist.

Normalize evidence into the W1 versioned source-span schema. Do not silently
upgrade candidate evidence. For each of the 1,571 records require:
- exact preimage SHA-256;
- currentOffset and complete removeHex;
- complete insertHex;
- matching preserved left/right anchors;
- source provenance and source hash;
- expected postimage SHA-256;
- exact or corroborated confidence;
- no overlap with another span in the same file.

Run an in-memory dry reconstruction of all 370 affected files. Require strict
UTF-8, exact preservation outside declared spans, deterministic output, and
zero unresolved/candidate/conflict records. Also run parser/type-oriented
checks selected by each owner report where possible without writing source.

If any record remains candidate, conflict, or unresolved, stop. Publish a
blocking report and dispatch a narrowly scoped evidence follow-up; do not
create repair branches.

Only after all records pass:
1. generate exact file allowlists with pairwise-empty intersections;
2. update Runtime remediation Harness touchedAreas to their exact union;
3. run Harness context and validate on the staged real diff;
4. commit the frozen manifest and allowlists;
5. create W5-W8 branches/worktrees from that exact commit;
6. publish each worker's immutable branch, worktree, HEAD, and file allowlist.

Do not edit Runtime production source and do not begin DCS Stage 1.
```

## Worker Return Template

Each worker returns:

```markdown
## Worker Result

- Worktree:
- Branch:
- Start HEAD:
- End HEAD:
- Commit:
- Status before:
- Status after:
- Files changed:
- Out-of-scope files changed: none / list and stop reason

## Evidence

- Previous report SHA-256:
- New report SHA-256:
- Total records: 1571
- Exact:
- Corroborated:
- Candidate:
- Conflict:
- Unresolved:

## Commands

| Command | Started | Finished | Exit |
| --- | --- | --- | ---: |
| | | | |

## Remaining Risks

- ...
```

## Gate To Start Source Repair

W5-W8 remain blocked unless every line below is proven:

```text
records total                              1,571
affected files                             370
candidate                                  0
conflict                                   0
unresolved                                 0
all spans have preimage/postimage hashes   yes
all spans have matching anchors            yes
all spans are non-overlapping              yes
in-memory reconstruction strict UTF-8      yes
bytes outside spans unchanged              yes
partition allowlist intersections          empty
Harness context                            exit 0
Harness validate on real staged diff       exit 0
frozen manifest commit                     recorded
```

The Runtime build repair and DCS Stage 1 remain later, sequential phases.
Evidence work can run in parallel; Runtime integration, Runtime acceptance,
DCS Stage 1 implementation, full gates, and independent review cannot be
declared complete in parallel.
