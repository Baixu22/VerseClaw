# P2 issue fixes: receipt decisions and transcript call identity

Scope: issues #111 and #112. This record is agent-authored; it does not claim
human execution or human data.

## #111 - candidate decision reasons in ContextReceipt

- `ReceiptContent` now carries an optional bounded `candidateDecisions` object:
  `complete` plus up to 64 decisions. Each decision contains only a canonical
  `ref`, public `sourceId`/`channel`, disposition, reason, and requested/applied
  character counts.
- `runtime_receipts.candidate_decisions_json` stores the projection. The
  additive schema migration leaves old rows readable with `NULL`.
- The decision projection participates in content-sensitive idempotency, so two
  receipts with identical refs/budget but different reasons cannot silently
  overwrite each other.
- The RC-03 seal hook projects the real candidate lineage before collection
  cleanup. Missing legacy lineage fields fall back to a conservative
  applied/skip/empty projection instead of dropping the candidate.

## #112 - transcript entry to producing model call

- Provider stream resolution records an observational call identity only when a
  receipt/seal path is active: session/run/provider/adapter/model, attempt index,
  model call index, optional wire attempt index, and correlation digest.
- The identity travels on an out-of-band symbol and is persisted on the
  `SessionMessageEntry` as `modelCall`. Provider message JSON does not contain it.
- Assistant entries receive the producing call. Tool-result entries inherit the
  observation of the assistant tool call identified by `toolCallId`.
- Calls that produce no persisted entry are drained at `agent_end` into an
  ignored `openclaw.model_call_correlation` custom entry with
  `producedEntryId: null`.
- In-process state is keyed by session id, so parallel sessions cannot cross
  attribute calls. Old transcripts without the optional field retain existing
  replay behavior.

## Verification commands

```text
pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/model-call-observations.test.ts src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/rc03-entry-transitions.acceptance.test.ts
pnpm --dir openclaw_runtime run db:kysely:check
```

The broader `rc03-entry-transitions.acceptance.test.ts` suite remains a
required gate; its first `fit` case is reported separately if the local
60-second timeout is exceeded.