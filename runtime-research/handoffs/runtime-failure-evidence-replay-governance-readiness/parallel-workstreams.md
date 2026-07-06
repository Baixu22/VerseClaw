# Parallel Workstreams

The five lanes should not be developed as five isolated projects. Use three workstreams with explicit handoff contracts.

## Workstream A: Runtime Event And Decision Signals

Owns:

- `FailureEvent`
- classifier taxonomy
- recoverability and suggested action
- future repair/handoff summaries
- future governance decision input

Must provide to Workstream B:

- sanitized failure summary payload
- failure event id
- confidence
- evidence refs
- source/provenance metadata

Must provide to Workstream C:

- fixtureable failure events
- stable expected classifications
- unknown fallback cases

Must not own:

- evidence envelope validation
- replay runner
- scorecard scoring
- active tool blocking before governance specs

## Workstream B: Evidence And Context Safety

Owns:

- `EvidenceEnvelope`
- fail-closed validation
- redaction state
- TTL and scope
- confidence thresholding
- future evidence slots

Must provide to Workstream A:

- accept/reject result shape
- rejection reasons
- envelope id/ref format

Must provide to Workstream C:

- fixtureable accepted/rejected envelopes
- deterministic envelope validation report
- prompt budget metadata if a future prompt slot is accepted

Must not own:

- runtime decisions
- tool governance policy
- task completion scoring
- checkpoint/lifecycle authority state

## Workstream C: Replay And Evaluation

Owns:

- `ReplayCase`
- provider/tool/workspace fixtures
- replay report
- baseline compare
- `TaskOutcomeScorecard`

Must provide to Workstream A:

- repeated failure examples
- timeout examples
- user interruption examples
- classification regressions

Must provide to Workstream B:

- envelope accept/reject corpus
- payload budget regression examples
- redaction failure examples

Must not own:

- active runtime behavior
- default-on gates
- provider transport
- live-provider capture by default

## Integration Cadence

Use two-week vertical integration checkpoints:

1. Week 1-2: schema contracts compile and validators fail closed.
2. Week 3-4: failure events can be wrapped as rejected/accepted evidence.
3. Week 5-6: replay core can replay the first two cases.
4. Week 7-8: first five replay cases produce reports.
5. Week 9-10: scorecard consumes replay reports.
6. Week 11-12: governance advisory rules are measured by scorecard deltas.

At each checkpoint, publish:

- updated task spec
- focused unit test result
- replay result if applicable
- boundary scan result
- rollback statement
- current synthesis status

## Parallelization Rules

Safe to parallelize:

- taxonomy refinement and schema validator tests
- evidence envelope validator and replay fixture authoring
- scorecard schema and replay report extensions
- separate advisory governance rule prototypes

Do not parallelize without a frozen contract:

- scorecard implementation before replay report fields stabilize
- active governance before replay/scorecard thresholds exist
- prompt evidence slots before envelope fail-closed validation
- any Gateway/provider transport change before local replay proof
