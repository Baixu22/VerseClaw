---
id: rsi-candidate-evolution-boundary
title: Isolate candidate generation, validation selection and final evaluation
type: ai-coding-rule
severity: error
appliesTo:
  - scripts/lib/rsi-candidate-evolution*.mjs
  - scripts/rsi-candidate-evolution*.mjs
  - scripts/lib/rsi-benefit-eval.mjs
---

Freeze disjoint training, validation and final held-out identities and content commitments before generation. Pass only parent prompt and explicitly bound training observations to the generator. Final held-out payloads and outcomes belong to the evaluator and never influence generation or screening.

Preserve every candidate's parent id/version, source summaries, attribution, original failures, first attempts and budget. Persist a reservation before invoking a generator. Duplicate or interrupted attempts consume their reservation and cannot redispatch under the same identity.

Use the existing paired-ablation instrument and frozen promotion-policy.v2 thresholds. Selection requires sufficient complete validation pairs, known token and tool-call costs, positive effect and interval, and passing safety/anchor gates. Fixture evidence and unknown usage remain ineligible for promotion. Keep rejected versions and their original results.

Freeze the staging rule before generation: choose the first generation that clears every validation gate for final measurement. Record this measurement choice separately from product adoption. A fixture can select a staged experimental input while its product decision remains hold.

Exercise prompt candidates only through an explicit evaluation switch whose off state restores the prior prompt bytes. Candidate generation cannot change SEKB defaults, retrieval weights, evaluators, permissions or code self-modification admission. Exported candidates and final benefit plans must bind the same candidate digest and final held-out commitment.
