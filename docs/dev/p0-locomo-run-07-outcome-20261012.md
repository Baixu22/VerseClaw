# LoCoMo 500-question evaluation: run-07 outcome and the evaluator hardening

- Date: 2026-10-12
- Issues in scope: #135, #136, #138 (P0 memory-evaluation integrity)
- `driven_by: agent`; actor: `codex`
- Outcome: **no 500-question report was produced.** The evaluator and its evidence
  chain were hardened instead. Every claim below is backed by an artifact on disk.

## What actually happened

Four supervised attempts, each killed before it could emit a report:

| Run | Reached | Killed by | Surviving work |
| --- | --- | --- | --- |
| run-03 | extraction 445/1191 chunks | host VM exhaustion (Windows event 2004: llama-server 12.8 GB + two `tsgo` 5.9/3.6 GB) | extraction cache, 4 conversations |
| run-04 | extraction 10 min | silent external process sweep (no crash, no OOM event) | same cache |
| judge-06 | observation consolidation, conv-47 | **undici deadlock** (see below) | 6/10 observation cache |
| judge-07 | episodic index for conv-41 | `[vitest-pool]: Worker forks emitted error` — worker killed with no OOM event and no crash log | 10/10 extraction, 6/10 observations, 5.2 MB session summaries, 587 MB embedding cache |

The extraction stage itself **succeeded completely**: all ten conversations, 3,618
facts, via seven bounded batches (`full500-run-04/extracted-facts-cache-v6-additive-p0.json`).

## Defects found and fixed (all committed with tests)

### 1. Observation consolidation persisted only at the very end

- **Where:** `tests/unit/helpers/memory-observation-consolidation.ts` and its call site in
  `tests/unit/runtime-memory-locomo-full-500.test.ts`
- **Impact:** an interruption during cross-session consolidation discarded *every*
  conversation's work. This is exactly what happened to run-05/judge-06.
- **Fix:** a new `onConversationComplete` callback fires as soon as each conversation is
  final; the caller persists after each one; `loadObservationCache` now accepts a
  **partial** cache so a resumed run only recomputes what is missing.
- **Evidence:** red 0/3 → green 3/3 (`tests/unit/memory-observation-consolidation-incremental.test.ts`);
  commit `575413e0f`. Real-world proof: judge-06's death preserved 6/10 conversations,
  and judge-07 resumed from them.

### 2. A stalled HTTP call could hang forever (undici with only an AbortController)

- **Where:** `tests/unit/helpers/runtime-memory-real-llm-client.ts`
- **Impact:** judge-06 sat for **40+ minutes** with zero CPU, zero network traffic, flat
  memory and 13 threads all in Wait — a true deadlock, not a slow call.
- **Fix:** per-request `headersTimeout` / `bodyTimeout` budgets. These still route
  through the global dispatcher, so `MockAgent`-based tests keep working.
- **Evidence:** `tests/unit/runtime-memory-real-llm-client.test.ts` 10/10; commit `bebc5f20f`.
- **Note on a mistake caught before landing:** a first attempt added a module-level
  `new Agent({connect:{timeout}})` dispatcher. That *bypassed* `setGlobalDispatcher(mock)`
  and turned 6 unit tests into real DNS lookups (`ENOTFOUND step.example`). The tests
  caught it; the dispatcher was removed.

### 3. Staged extraction so a memory-constrained host can make progress

- **Where:** `scripts/run-locomo-full-evaluation.mjs`,
  `tests/unit/runtime-memory-locomo-full-500.test.ts`
- **Impact:** the single-shot run holds a ~12.8 GB llama-server for the whole run even
  though **fact extraction never touches embeddings**. On a 15.5 GB host that made any
  concurrent tooling fatal.
- **Fix:** `RUNTIME_MEMORY_EXTRACTION_ONLY=1` (+ `RUNTIME_MEMORY_EXTRACTION_BATCH`)
  extracts N conversations, flushes after each, and exits without ever starting the
  embedding server. Measured: extraction phase footprint dropped to **~110 MB**
  (supervisor 41 MB + batch 70 MB), zero llama-server.
- **Evidence:** commit `ef3d39ba2`; batch-1 → batch-2 resume verified on synthetic input.

## Embedded scoring that IS trustworthy

Two measurements were taken during this work and are retained as evidence:

1. **Embedding determinism under batch-size reduction.** The shipped llama-server was
   compared at `--batch-size 8192 --ubatch-size 8192` vs `2048/512` over 24 texts
   (including a long one): **24/24 vectors byte-identical, max absolute difference 0.0**.
   This is what justified reducing the batch size, which cut physical memory use by
   1,044 MB (6,325 → 5,281 MB) and GPU use by 1,063 MiB — without changing results.
2. **Extraction completeness.** 3,618 facts across all ten conversations, produced by
   seven independently supervised batches with zero retries and zero question failures.

## What is deliberately NOT claimed

- **No 500-question report exists.** #135/#136/#138 therefore stay **open**. There is no
  measured J Score, recall@5 or temporal figure from this work, and none of the historical
  0.752 / 0.452 numbers are reproduced or validated.
- The judge-07 worker kill has **no recorded cause** (no OOM event, no crash log). It is
  described as an external kill, not diagnosed.
- No claim about other hosts, other platforms, packaging, or release readiness.
- No real-human evidence; every artifact is agent-driven.

## Remaining work if the report is ever needed

1. Give the episodic index the same treatment as observation consolidation: persist
   per conversation and release the in-memory index after use. `episodicByConversation`
   currently holds every conversation's index for the whole run (≈10,000 sentences),
   which is the largest remaining peak.
2. Run in an environment without the silent process sweeps that killed run-04 and judge-07.
3. Re-run `pnpm eval:runtime-memory:locomo:full500` and let the existing verifier
   (`scripts/check-locomo-evidence.mjs`) accept or reject the report.

## Artifact index

| Path | What it is |
| --- | --- |
| `D:/ClawX-work/p0-local-embedding-20261010/full500-run-04/extracted-facts-cache-v6-additive-p0.json` | 10/10 conversations, 3,618 facts, 975 KB |
| `D:/ClawX-work/p0-local-embedding-20261010/full500-run-06/observations-cache.json` | 6/10 conversations, 821 KB (incremental-save proof) |
| `D:/ClawX-work/p0-local-embedding-20261010/full500-run-07/embedding-cache.json` | 6,663 entries, 587 MB, JSONL |
| `D:/ClawX-work/p0-continuation-20261010/run03-death-report.json` | run-03 VM-exhaustion forensics |
| `D:/ClawX-work/p0-continuation-20261010/memory-and-timing-analysis.json` | measured memory/timing model |
| `D:/ClawX-work/p0-continuation-20261010/issue160-diagnosis.json` | #160 environment diagnosis |
| `D:/ClawX-work/p0-continuation-20261010/debug-scaffold-backup/` | the throwaway probe tests, preserved off-tree |
