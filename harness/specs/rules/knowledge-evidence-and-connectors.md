---
id: knowledge-evidence-and-connectors
title: Knowledge model output and connectors remain evidence-bound candidate producers
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
pathPatterns:
  - electron/services/knowledge-evidence-qa.ts
  - electron/services/knowledge-github-connector.ts
  - electron/services/knowledge-source-set-answer.ts
  - scripts/knowledge-quality-eval.ts
requiredTests:
  - tests/unit/knowledge-evidence-qa.test.ts
  - tests/unit/knowledge-github-connector.test.ts
  - tests/unit/knowledge-retrieval.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
---

Only admitted original source content can enter synthesis or semantic review.
Conversation and source instructions are untrusted. Model-only Gateway runs use
isolated session IDs, no tools and no delivery authority. Claims require exact
quotations from supplied source IDs; quote existence does not prove entailment.
Conflicts, incomplete reads, unknown freshness and provider failures stay visible.
Follow-up retrieval may use bounded prior user context but never assistant text
as a factual source. Steward binds findings to draft and source revisions, uses
the active reviewFocus and rejects persistence after concurrent draft changes.

Public GitHub synchronization is one explicitly bounded directory/file connector,
with no arbitrary URLs, tokens, redirects or private-repository claim. Validate
Git blob identity, source path, content budgets and complete snapshots before
inferring deletion. Successful Inbox capture precedes cursor advancement; a
failed request cannot imply deletion. Access loss produces a content-free review
candidate. Existing accepted knowledge still changes exclusively through governed
review/apply. Timers, watchers and requests have an owner and stop on shutdown.

Evaluation retains fixed corpus, raw sanitized responses, source versions and
reproducible metrics. Separate live provider inference, scripted Gateway replay,
real runtime effects, skipped inference and unmeasured cost. Record quality
failures as observed residuals; do not relabel a measured run as universal success.
All actors are labelled agent-driven and never real-human.
