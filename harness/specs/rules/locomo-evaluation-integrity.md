---
id: locomo-evaluation-integrity
title: LoCoMo measurement and artifact integrity
type: ai-coding-rule
severity: error
---

# LoCoMo evaluation integrity

- Resolve dataset evidence IDs to turn text before lexical context coverage scoring; empty evidence is not perfect recall and unresolved IDs must fail closed.
- Disclose all L0/L1/L2 counts and rates. Separate full-conversation fallback answers from the L0+L1 subset and disclose the subset-selection bias.
- Gate retrieval regressions independently of answer/judge changes; a temporal recall drop must not disappear behind a higher J Score.
- Publish the full judge configuration and its lenient rules. Scores from different or unknown judges are not directly comparable and cannot establish a ranking.
- Test fixtures without a complete, verified run record are not measured baselines. Do not rewrite their provenance to claim a run occurred.
- Fresh measured reports require every sampled question, exact source/dataset fingerprints, model request/usage accounting, timing, configuration and agent attribution. Missing, stale, partial or contradictory evidence fails validation.
- Every full-run question must reference its own live frozen-judge response ID. Recompute the exact request digest from that question, ground truth, predicted answer and frozen prompt, then derive the score from the retained verdict. Unrelated API receipts, duplicate IDs, altered judge prompts and cached verdicts do not establish full-run judge coverage.
- Use only authorized test-provider resources. Never log or commit credentials, read production memory databases, or change product defaults for evaluation.
