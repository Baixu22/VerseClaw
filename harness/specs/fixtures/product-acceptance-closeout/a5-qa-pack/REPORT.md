# Personal-agent QA acceptance

Agent-driven Windows x64 source-host/mock-provider evidence for TF-0578.

- Clean source candidate: 480e683c68e9f83231eb423ce23b541598f5425f; tree c6ea08aac607f99b54590b3bf4f15085123ad9a1.
- Selected/executed: 10/10; passed 10; failed/skipped 0.
- QA focused: 21/21; root focused: 56/56; type/lint/Harness/comms gates exit 0.
- Preflight: one actual reminder delivered and removed.
- Missing fixture and empty catalog exit 1. Deliberate false final-state oracle exits 1 with one failure and one completed subsequent task; controller exit 0.
- Approval record is accepted, delivered to the agent observer, resolved deny, and forbidden file remains absent. Failure-recovery contains a real tool failure and distinct later run.
- Build identity: 12734 copied files, digest 3f9975d6ebb63eeb7926a953dd9acab6ebf1a6e8ed15df506ea0f0b486216f8d.

The exact commands, raw results, effects and source hashes are in receipt.json and recovery-index.json. Dependencies are reused; mock results do not prove live-model quality, packaged behavior, release approval or real-human evidence. Product locks remain false.
