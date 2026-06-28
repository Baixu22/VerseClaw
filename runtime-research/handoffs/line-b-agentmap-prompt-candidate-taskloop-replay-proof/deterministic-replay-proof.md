# Deterministic Replay Proof

Status: accepted

Determinism is proven by replaying the same explicit pilot input twice with a fixed `generatedAt` value and comparing:

- `reviewerPrompt`
- diagnostic code sequence
- candidate metadata

Expected result:

```text
repeated replay deterministic output: pass
```

Default-off determinism is covered by the same legacy prompt byte-parity assertions used for partial gates, invalid inputs, budget exhaustion, empty candidates, prompt-present exclusion, and realistic TaskLoop states.

Allowed nondeterminism: none in the asserted replay fields. Timestamps are fixed in explicit replay cases and are not used to approve default behavior.
