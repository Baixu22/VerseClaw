# DCS Stage 1 Recovery Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **2026-07-11 safety hold:** The W5-W8 source-repair prompts in this document
> are suspended. Evidence discovered that malformed UTF-8 units may also have
> swallowed adjacent delimiter or sequence bytes, so equal-length code-point
> replacements are not apply-ready. Use
> `docs/superpowers/plans/2026-07-11-runtime-utf8-recovery-window-launch-pack.md`
> for the current W0-W4 prompts. Do not create W5-W8 until W0 freezes a
> variable-length source-span manifest with zero candidate, conflict, or
> unresolved records.

**Goal:** Safely restore the pruned Runtime's committed UTF-8/build baseline,
then complete DCS Stage 1 with attributable diffs and full acceptance evidence.

**Architecture:** A read-only coordinator freezes the user's work, then four
evidence workers investigate independently. Four repair workers receive exact
pairwise-disjoint file allowlists. A Runtime integrator creates one reviewed
baseline commit before a separate DCS Stage 1 closure branch begins.

**Tech Stack:** Git worktrees, PowerShell, Node.js, pnpm, TypeScript, Vitest,
Agent Harness.

## Global Constraints

- Treat `AGENTS.md`, scoped `openclaw_runtime/AGENTS.md`, DCS v1.6, and Harness
  specs as authoritative in that order.
- Never run `git reset --hard`, `git clean`, destructive checkout, or manual
  stash against any source workspace.
- Never edit `C:\Users\27933\Desktop\clawx\ClawX`.
- Never use lossy decoding, `U+FFFD`, blanket replacement, or guessed recovery.
- Never widen DCS touchedAreas to absorb Runtime remediation.
- Never run test commands concurrently in the same worktree.
- Do not update `team/dcs/README.md` until every Stage 1 gate and independent
  review is green.

---

## Phase 0: Freeze Before Parallel Work

### Task 1: W0 Creates Immutable Recovery Evidence

**Files:**
- Create outside repositories: `C:\dcs-recovery\backups\$Stamp\**`
- Do not modify: `C:\Users\27933\Desktop\clawx\ClawX\**`

- [ ] **Step 1: Record repository identity and worktree state**

Run from PowerShell:

```powershell
$Source = 'C:\Users\27933\Desktop\clawx\ClawX'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = "C:\dcs-recovery\backups\$Stamp"
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
git -C $Source rev-parse HEAD | Out-File "$Backup\head.txt" -Encoding ascii
git -C $Source status --porcelain=v2 --branch |
  Out-File "$Backup\status.txt" -Encoding utf8
git -C $Source worktree list --porcelain |
  Out-File "$Backup\worktrees.txt" -Encoding utf8
```

Expected: `head.txt` contains
`623677ec6cda799fec6f305809ed4db37a514d70`.

- [ ] **Step 2: Back up Git objects and tracked changes**

```powershell
git -C $Source bundle create "$Backup\repository.bundle" --all
git -C $Source diff --binary --output="$Backup\tracked.patch"
git -C $Source diff --cached --binary --output="$Backup\staged.patch"
git -C $Source ls-files --others --exclude-standard |
  Out-File "$Backup\untracked-paths.txt" -Encoding utf8
```

Expected: `git bundle verify "$Backup\repository.bundle"` exits 0.

- [ ] **Step 3: Copy untracked files without flattening paths**

```powershell
$UntrackedRoot = Join-Path $Backup 'untracked'
New-Item -ItemType Directory -Force -Path $UntrackedRoot | Out-Null
git -C $Source ls-files --others --exclude-standard |
  ForEach-Object {
    $relative = $_
    $from = Join-Path $Source $relative
    $to = Join-Path $UntrackedRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
  }
```

Expected: each path in `untracked-paths.txt` exists below `untracked`.

- [ ] **Step 4: Hash all backup evidence**

```powershell
Get-ChildItem $Backup -Recurse -File |
  Where-Object Name -ne 'sha256.txt' |
  Get-FileHash -Algorithm SHA256 |
  Sort-Object Path |
  ForEach-Object { "$($_.Hash)  $($_.Path)" } |
  Out-File "$Backup\sha256.txt" -Encoding ascii
```

- [ ] **Step 5: Freeze the existing isolated closure clone separately**

Repeat Steps 1-4 with:

```powershell
$Source = 'C:\dcs1v-bc74257f'
$Backup = "C:\dcs-recovery\backups\$Stamp-dcs1v"
```

Do not remove generated assets during this step.

### Task 2: W0 Creates The Recovery Seed And Worktrees

- [ ] **Step 1: Create a clean coordinator clone without changing the source**

```powershell
$Source = 'C:\Users\27933\Desktop\clawx\ClawX'
$Recovery = 'C:\dcs-recovery'
$Base = '623677ec6cda799fec6f305809ed4db37a514d70'
New-Item -ItemType Directory -Force -Path $Recovery | Out-Null
git clone --no-hardlinks $Source "$Recovery\coordinator"
git -C "$Recovery\coordinator" switch --detach $Base
git -C "$Recovery\coordinator" switch -c codex/recovery-coordinator
```

Expected: coordinator `HEAD` equals `$Base` and `git status --short` is empty.

- [ ] **Step 2: Bring only the reviewed orchestration documents into W0**

```powershell
$PlanSource = 'C:\dcs1v-bc74257f\docs\superpowers'
$PlanTarget = 'C:\dcs-recovery\coordinator\docs\superpowers'
Copy-Item "$PlanSource\specs\2026-07-11-dcs-stage1-recovery-orchestration-design.md" `
  "$PlanTarget\specs\" -Force
Copy-Item "$PlanSource\plans\2026-07-11-dcs-stage1-recovery-orchestration.md" `
  "$PlanTarget\plans\" -Force
git -C "$Recovery\coordinator" add `
  docs/superpowers/specs/2026-07-11-dcs-stage1-recovery-orchestration-design.md `
  docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md
git -C "$Recovery\coordinator" commit -m "docs: add DCS recovery orchestration"
```

Expected: one docs-only coordinator commit.

- [ ] **Step 3: Create evidence branches and worktrees from one seed**

```powershell
$Seed = git -C "$Recovery\coordinator" rev-parse HEAD
git -C "$Recovery\coordinator" branch codex/runtime-utf8-inventory $Seed
git -C "$Recovery\coordinator" branch codex/runtime-utf8-upstream-evidence $Seed
git -C "$Recovery\coordinator" branch codex/runtime-utf8-local-evidence $Seed
git -C "$Recovery\coordinator" branch codex/runtime-utf8-semantic-evidence $Seed
git -C "$Recovery\coordinator" worktree add "$Recovery\inventory" codex/runtime-utf8-inventory
git -C "$Recovery\coordinator" worktree add "$Recovery\upstream" codex/runtime-utf8-upstream-evidence
git -C "$Recovery\coordinator" worktree add "$Recovery\local-evidence" codex/runtime-utf8-local-evidence
git -C "$Recovery\coordinator" worktree add "$Recovery\semantic" codex/runtime-utf8-semantic-evidence
```

Expected: all four worktrees have the same initial HEAD and clean status.

- [ ] **Step 4: Verify worktree isolation before opening worker windows**

```powershell
git -C "$Recovery\coordinator" worktree list --porcelain
@('inventory', 'upstream', 'local-evidence', 'semantic') |
  ForEach-Object {
    git -C "$Recovery\$_" branch --show-current
    git -C "$Recovery\$_" status --short
  }
```

Do not create repair worktrees until the inventory and evidence merge is
committed.

---

## Phase 1: Read-Only Evidence In Parallel

### Task 3: W1 Builds Inventory And Guarded Recovery Tooling

W1 writes tests first. Its scanner must enumerate Git-tracked textual files,
decode with a fatal UTF-8 decoder, report exact malformed byte offsets, and
exit non-zero while invalid files remain. Its apply mode must require a
manifest preimage hash and reject unresolved records. It also creates
`harness/specs/tasks/runtime-utf8-baseline-remediation.md`, initially scoped to
inventory/tooling/evidence only.

### Task 4: W2 Correlates Upstream Snapshots

W2 compares each damaged Git blob with both known snapshots:

- historical `e993e1c334c6ee0995106730d750d44a9320e5bb`;
- current upstream version `2026.6.11`.

It writes candidate evidence only. It does not edit Runtime source files and
does not classify a candidate as exact when undamaged bytes differ.

### Task 5: W3 Searches Local Recovery Sources

W3 searches Git objects, refs, prior worktrees, build output, source maps,
package caches, editor history, and other local artifacts. It never alters the
source evidence. Reports record source path, artifact hash, recovered byte
range, and confidence.

### Task 6: W4 Builds Semantic Evidence

W4 correlates damaged values against tests, snapshots, locale files,
documentation, duplicated constants, protocol schemas, and runtime callers.
It records behavior-sensitive replacements separately from comments. It may
recommend a focused test but does not edit production files.

---

## Phase 2: Manifest Freeze

### Task 7: W0 Integrates Evidence And Generates Allowlists

- [ ] Merge W1-W4 evidence commits.
- [ ] Run the inventory scanner from the merged evidence commit.
- [ ] Require every malformed range to be exact, corroborated, or unresolved.
- [ ] Assign every affected file to exactly one of four repair partitions.
- [ ] Verify pairwise intersection of allowlists is empty.
- [ ] Update Runtime remediation task `touchedAreas` to the exact union of the
      frozen source allowlists, tooling, tests, and reports.
- [ ] Run Harness context and validate before any repair worker edits source.
- [ ] Commit the frozen manifest, task spec, and allowlists.

Suggested partitioning is path-based, but the generated allowlists are the
only authority:

- A: extensions and owner plugins;
- B: gateway, protocol, channels, and communication surfaces;
- C: context, memory, agents, sessions, and local path/runtime state;
- D: providers, tools, scripts, package surfaces, and all remaining paths.

---

## Phase 3: Source Repair In Parallel

### Task 8: W5-W8 Repair Their Frozen Partitions

Each worker:

1. verifies its branch base equals the manifest commit;
2. verifies current file hashes equal manifest preimages;
3. adds or updates focused tests before behavior-sensitive repair;
4. applies only exact or corroborated replacements;
5. runs the strict scanner on its allowlist;
6. runs focused owner tests sequentially;
7. writes a partition report with commands and exit codes;
8. commits only allowlisted files and its report.

If one byte range remains unresolved, the worker stops and reports it. It does
not substitute a visually plausible character.

---

## Phase 4: Runtime Integration And Acceptance

### Task 9: W9 Integrates Runtime Repair

Cherry-pick W5-W8 one at a time. After every commit, run the strict scanner and
the tests named in that partition report. Then integrate the already-developed
pruned Runtime build-contract repairs from `C:\dcs1v-bc74257f` as a separate
commit, reviewing each file rather than copying the dirty tree.

Required final proof:

```text
strict UTF-8 scanner                         exit 0, invalid=0, unresolved=0
focused owner tests                         exit 0
pnpm --dir openclaw_runtime build           exit 0
git diff --check                            exit 0
independent Runtime review                  Critical 0 / Important 0
```

Commit the accepted Runtime baseline before creating W10.

---

## Phase 5: DCS Stage 1 Closure

### Task 10: W10 Implements And Verifies Stage 1

Branch from W9's accepted Runtime baseline. First revise
`dcs-stage1-working-memory-handler.md` so its touchedAreas contain only Stage 1
source, tests, task spec, package script registration, and final DCS status
documentation. Runtime baseline repair files must not appear.

If original RED logs cannot be authenticated, recreate RED from a clean
pre-implementation Stage 1 branch. Never reconstruct or claim historical RED
evidence from memory.

Implement only:

```text
tool_result -> working-memory-handler -> BlockStore ->
Assembler pre_llm_call working_memory injection
```

Run all commands named in the Stage 1 task specification, record start/end
time and exit code, prove default-off reference identity, prove COMPASS zero
calls/imports/writes, and inspect untracked files. Update `team/dcs/README.md`
only after every command and review is green.

---

## Phase 6: Independent Review

### Task 11: W11 Reviews The Actual Final Diffs

Review Runtime remediation and DCS Stage 1 as two separate commit ranges.
Findings lead, ordered Critical, Important, Minor. Validate component
ownership, forbidden paths, test coverage, producer-coverage wording, and the
acceptance report against actual command logs. W11 must not edit files.

---

## Copy-Paste Window Prompts

### Shared Prefix For Every Window

```text
You are one worker in a controlled recovery. Read AGENTS.md and every scoped
AGENTS.md before acting. The user's workspace
C:\Users\27933\Desktop\clawx\ClawX is read-only evidence. Never run git
reset --hard, git clean, destructive checkout, manual stash, or bulk encoding
conversion. Never use U+FFFD, lossy decoding, guessed replacement text,
wholesale upstream overwrite, an empty compatibility shell, a blanket skip,
or weakened build/test gates.

Work only in the assigned worktree and branch. Before editing, print the
absolute worktree path, branch, HEAD, and git status. Stop if they differ from
the assignment. Edit only your explicit write allowlist. Unexpected changes
are user evidence: do not revert them. Use apply_patch for manual edits.
Tests run sequentially within this worktree. Commit only your files. Return:
root cause/evidence, files changed, tests with exact exit codes, commit SHA,
remaining uncertainties, and confirmation that no out-of-scope file changed.
```

### W0 Coordinator Prompt

```text
ROLE: W0 recovery coordinator. You are the only worker allowed to create the
recovery seed, worktrees, frozen manifest, and integration order.

First execute Phase 0 of
docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md.
Do not edit the user's source workspace. Verify both backup bundles and hash
inventories before creating C:\dcs-recovery\coordinator from base
623677ec6cda799fec6f305809ed4db37a514d70.

Create W1-W4 from one immutable seed. Do not create W5-W8 until evidence is
merged, every damaged range is classified, exact file allowlists are frozen,
pairwise intersections are empty, and
harness/specs/tasks/runtime-utf8-baseline-remediation.md passes both Harness
context and validate without --no-diff.

You do not repair source bytes. Your outputs are backup verification, branch
map, manifest commit SHA, exact allowlists, Harness logs, and ordered
cherry-pick instructions.
```

### W1 Inventory And Tooling Prompt

```text
ROLE: W1 UTF-8 inventory/tooling owner.
BRANCH: codex/runtime-utf8-inventory.
WRITE SCOPE: the Runtime UTF-8 scanner, its tests, manifest schema/tooling,
inventory artifacts, and the Runtime remediation Harness task only.

Use TDD. First prove the scanner rejects isolated malformed byte sequences,
reports deterministic byte offsets/context, ignores binary files by an
explicit tested classification rule, and rejects apply operations when the
preimage hash differs or confidence is unresolved. Then implement the minimum
tooling. Scan Git-tracked Runtime textual sources from Git blobs as well as the
worktree, and record whether they differ.

Do not repair any production source. The initial Harness task is an inventory
phase task; state that W0 must replace touchedAreas with the exact frozen
repair allowlist and revalidate before source repair. Return RED and GREEN
commands, exit codes, inventory totals, and commit SHA.
```

### W2 Upstream Evidence Prompt

```text
ROLE: W2 upstream evidence analyst.
BRANCH: codex/runtime-utf8-upstream-evidence.
WRITE SCOPE: artifacts/runtime-utf8-recovery/upstream-evidence/** only.

Compare damaged blobs against historical upstream commit
e993e1c334c6ee0995106730d750d44a9320e5bb and the extracted 2026.6.11
snapshot. For each malformed range, record candidate bytes, surrounding
unchanged-byte agreement, upstream file hash/version, and whether the pruned
local file diverges elsewhere. Exact means the undamaged local bytes establish
an unambiguous alignment; filename and visual plausibility are insufficient.

Do not edit Runtime source, task specs, scanner code, or another worker's
report. Return counts by exact/corroborating/ambiguous/no-match and commit SHA.
```

### W3 Local Evidence Prompt

```text
ROLE: W3 local artifact recovery analyst.
BRANCH: codex/runtime-utf8-local-evidence.
WRITE SCOPE: artifacts/runtime-utf8-recovery/local-evidence/** only.

Read-only search targets include Git refs/objects, existing worktrees,
dist/source maps, pnpm/npm caches, editor local history, OS temp artifacts,
and prior generated bundles. Never modify or normalize a source artifact.
Hash every evidence source before extracting candidate bytes. Record the exact
artifact path, provenance, corresponding source path/range, candidate bytes,
and confidence reason. Treat generated JavaScript as semantic evidence unless
source-map mapping and unchanged context make the source bytes exact.

Return recoverable-range counts, unresolved ranges, searched locations, and
commit SHA.
```

### W4 Semantic Evidence Prompt

```text
ROLE: W4 semantic evidence analyst.
BRANCH: codex/runtime-utf8-semantic-evidence.
WRITE SCOPE: artifacts/runtime-utf8-recovery/semantic-evidence/** only.

For unresolved ranges, inspect callers, callees, tests, snapshots, locales,
docs, duplicated constants, schemas, regex consumers, and protocol contracts.
Separate comments from behavior-sensitive strings, regexes, identifiers, BOM
constants, CJK vocabularies, and emoji lists. A behavior-sensitive candidate
needs two independent evidence sources or remains unresolved. Name the focused
test that must protect each accepted behavioral repair.

Do not edit tests or production source. Return corroborated and unresolved
records, recommended focused tests, and commit SHA.
```

### W5 Repair Partition A Prompt

```text
ROLE: Runtime UTF-8 repair worker A.
BRANCH: codex/runtime-utf8-repair-a.
WRITE SCOPE: only paths listed in
artifacts/runtime-utf8-recovery/allowlists/partition-a.txt and your
partition result report.

Verify HEAD equals the frozen manifest commit and every assigned file matches
its preimage hash. Stop on mismatch. For behavior-sensitive entries, first add
or confirm the focused regression test named by the manifest and record RED
where the malformed source prevents parsing/building or causes wrong behavior.
Apply only exact or corroborated manifest replacements, in descending byte
offset order against original bytes. Re-scan after every file and run owner
tests sequentially.

Do not touch another partition, generated assets, lockfiles, DCS files, or
build configuration unless explicitly listed. Zero unresolved assigned ranges
is required for commit. Return pre/post hashes, commands/exits, commit SHA, and
git diff --name-only proof matching the allowlist.
```

### W6 Repair Partition B Prompt

```text
ROLE: Runtime UTF-8 repair worker B.
BRANCH: codex/runtime-utf8-repair-b.
WRITE SCOPE: only paths listed in
artifacts/runtime-utf8-recovery/allowlists/partition-b.txt and your
partition result report.

Verify HEAD equals the frozen manifest commit and every assigned file matches
its preimage hash. Stop on mismatch. For behavior-sensitive entries, first add
or confirm the focused regression test named by the manifest and record RED
where the malformed source prevents parsing/building or causes wrong behavior.
Apply only exact or corroborated manifest replacements, in descending byte
offset order against original bytes. Re-scan after every file and run owner
tests sequentially.

Do not touch another partition, generated assets, lockfiles, DCS files, or
build configuration unless explicitly listed. Zero unresolved assigned ranges
is required for commit. Return pre/post hashes, commands/exits, commit SHA, and
git diff --name-only proof matching the allowlist.
```

### W7 Repair Partition C Prompt

```text
ROLE: Runtime UTF-8 repair worker C.
BRANCH: codex/runtime-utf8-repair-c.
WRITE SCOPE: only paths listed in
artifacts/runtime-utf8-recovery/allowlists/partition-c.txt and your
partition result report.

Verify HEAD equals the frozen manifest commit and every assigned file matches
its preimage hash. Stop on mismatch. For behavior-sensitive entries, first add
or confirm the focused regression test named by the manifest and record RED
where the malformed source prevents parsing/building or causes wrong behavior.
Apply only exact or corroborated manifest replacements, in descending byte
offset order against original bytes. Re-scan after every file and run owner
tests sequentially.

Do not touch another partition, generated assets, lockfiles, DCS files, or
build configuration unless explicitly listed. Zero unresolved assigned ranges
is required for commit. Return pre/post hashes, commands/exits, commit SHA, and
git diff --name-only proof matching the allowlist.
```

### W8 Repair Partition D Prompt

```text
ROLE: Runtime UTF-8 repair worker D.
BRANCH: codex/runtime-utf8-repair-d.
WRITE SCOPE: only paths listed in
artifacts/runtime-utf8-recovery/allowlists/partition-d.txt and your
partition result report.

Verify HEAD equals the frozen manifest commit and every assigned file matches
its preimage hash. Stop on mismatch. For behavior-sensitive entries, first add
or confirm the focused regression test named by the manifest and record RED
where the malformed source prevents parsing/building or causes wrong behavior.
Apply only exact or corroborated manifest replacements, in descending byte
offset order against original bytes. Re-scan after every file and run owner
tests sequentially.

Do not touch another partition, generated assets, lockfiles, DCS files, or
build configuration unless explicitly listed. Zero unresolved assigned ranges
is required for commit. Return pre/post hashes, commands/exits, commit SHA, and
git diff --name-only proof matching the allowlist.
```

### W9 Runtime Integrator Prompt

```text
ROLE: W9 Runtime baseline integrator.
BRANCH: codex/runtime-baseline-integration.
WRITE SCOPE: integration conflict resolution, explicitly approved pruned
Runtime build-contract files, focused tests, and Runtime acceptance report.

Cherry-pick W5-W8 in coordinator order, one at a time. After each, verify
strict UTF-8 inventory and that partition's tests. Never resolve a conflict by
choosing an entire side; compare manifest evidence and owner behavior.

Then migrate the reviewed build-contract work from
C:\dcs1v-bc74257f file by file: retained src/entry.ts bootstrap, conditional
CLI metadata ownership, valid tsdown retained entries, real plugin-sdk/health,
gateway session schema boundary repair, and status summary runtime mapping.
Do not restore or handwrite banner.ts, weaken dist/entry.js checks, delete the
retained health SDK, externalize business dependencies, or copy generated
assets.

Require invalid UTF-8=0, unresolved=0, focused tests green, Runtime build exit
0, git diff --check exit 0, clean attribution, and independent Critical 0 /
Important 0 review. Commit Runtime remediation independently from DCS.
```

### W10 DCS Stage 1 Prompt

```text
ROLE: W10 DCS Stage 1 closure owner.
BRANCH: codex/dcs-stage1-final, based only on accepted W9 Runtime baseline.

Read authorities in the exact order required by the user. Revise and validate
harness/specs/tasks/dcs-stage1-working-memory-handler.md before production
edits; its touchedAreas must not include Runtime baseline remediation.

Use strict TDD. If authentic prior RED logs are absent, recreate RED from the
pre-Stage-1 baseline and preserve command output. Implement only the
tool_result -> working-memory-handler -> BlockStore -> Assembler pre_llm_call
working_memory loop. Enforce high/medium admission, low observability-only,
missing significance rejection, deterministic maximum-five eviction of oldest
medium then oldest high, exact heading ## Recent Actions, default-false flag
with reference identity pass-through, and zero COMPASS calls.

Honor producer/handler/BlockStore/Assembler/hook/observability ownership.
Do not touch Renderer/Main/Gateway transport, legacy prompt builders, COMPASS,
task_state, knowledge, notes, or handoff. Run every required acceptance
command with timestamp and exit code. Obtain independent Critical 0 /
Important 0 review before updating team/dcs/README.md. Report production
producer coverage honestly: edit/write/apply_patch producers remain Coding
Runtime P0 unless genuinely implemented in this diff.
```

### W11 Independent Reviewer Prompt

```text
ROLE: W11 independent read-only reviewer. Do not edit, stage, or commit.

Review two ranges separately:
1. base 623677ec6..accepted Runtime baseline;
2. accepted Runtime baseline..DCS Stage 1 candidate.

Read whole changed modules plus callers, callees, sibling owners, tests, scoped
AGENTS.md, DCS v1.6, Harness specs, and command logs. Verify every repaired byte
against manifest evidence, all allowlists and pre/post hashes, no lossy
replacement, retained pruned capabilities, and real Runtime build proof.

For Stage 1 verify exact touchedAreas, feature flag default false and reference
identity, low/rejection observability without writes, deterministic window,
same-session ordering, real BlockStore boundary, Assembler read-only behavior,
COMPASS zero imports/calls/writes, forbidden paths, test registration,
untracked files, and honest producer coverage.

Findings first, ordered Critical then Important then Minor, each with file and
line. Explicitly state Critical count and Important count. Green tests are not
a substitute for ownership or semantic review.
```

---

## Acceptance Log Template

```markdown
| Gate | Commit | Started | Finished | Exit | Log SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| strict UTF-8 inventory | | | | | |
| focused tests | | | | | |
| pnpm run typecheck | | | | | |
| pnpm run lint | | | | | |
| pnpm test | | | | | |
| pnpm run test:dcs | | | | | |
| pnpm --dir openclaw_runtime db:kysely:check | | | | | |
| pnpm run harness:ci | | | | | |
| Stage 1 Harness validate | | | | | |
| Stage 1 Harness run | | | | | |
| pnpm contract:check | | | | | |
| pnpm run comms:replay | | | | | |
| pnpm run comms:compare | | | | | |
| pnpm --dir openclaw_runtime build | | | | | |
```

The final report also lists changed files by commit, ownership proof,
authenticated RED/GREEN evidence, default-off identity evidence, COMPASS zero
call evidence, producer coverage, independent review counts, and untracked
file inspection.
