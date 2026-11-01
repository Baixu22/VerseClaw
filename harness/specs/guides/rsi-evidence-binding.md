---
id: rsi-evidence-binding
title: RSI evidence binding (what invalidates a sealed pack)
type: guide
appliesTo:
  - rsi
  - harness
---

# RSI evidence binding

Status: active (2026-11-01). Agent-driven record; no human verdict is claimed.

## The rule

A sealed evidence pack is invalidated by a change to **its judged inputs**, not
by "some other commit exists after it".

Bound inputs for the RSI packs:

- TF-0592 (`scripts/rsi-tf0592-statistical-adjudication.mjs`): the instrument and
  aggregation libraries, the task spec and the three boundary rules it composes,
  `harness/src/profiles.mjs`, `package.json` / `pnpm-lock.yaml`, the TF-0604
  corpus, the raw trials and the promotion policy.
- TF-0590 (`scripts/rsi-historical-task-corpus.mjs`): the corpus builder, the
  grader implementations, the calibration/task specs, the package manifests and
  the E01/E02 test oracles the historical tasks bind.

Everything else — a README edit, another node's product source, a neighbouring
evidence pack, this guide — does **not** invalidate a seal.

## Why

Before 2026-11-01 both validators rejected a pack whenever any later commit
touched a path outside a hardcoded allowlist. The allowlist could never be
complete, so the next unrelated commit turned both checks red and forced a
reseal. The result was dozens of `reseal` commits and a team habit of reading the
gates as noise — the opposite of an anti-tamper control.

## What still holds

- The candidate commit must be an ancestor of `HEAD`, and its recorded tree must
  match.
- The worktree must be clean when a final readback runs.
- Every bound input is hashed against disk, so the bytes the numbers were
  produced from are still pinned.
- `changedPathsBetween` (in `scripts/lib/evidence-binding.mjs`) reports any bound
  path that moved between the candidate commit and `HEAD`.

## Operator commands

```powershell
node scripts/rsi-tf0604-baseline.mjs --check --json
node scripts/rsi-historical-task-corpus.mjs --check
node scripts/rsi-tf0592-statistical-adjudication.mjs --check --json
```

A `dirty-candidate` / `dirty-workspace` error means the checkout is mid-edit; it
is not a judgement about the evidence. Reseal only after a bound input actually
changed:

```powershell
node scripts/rsi-historical-task-corpus.mjs --write   # corpus first
node scripts/rsi-tf0592-statistical-adjudication.mjs --write --json   # instrument last
```

Resealing in that order keeps each pack's own commit range evidence-only.

## Not authorised by this guide

Promotion, default changes, product locks, release state and any claim about
benefit. Freezing a rule is not implementing a capability.
