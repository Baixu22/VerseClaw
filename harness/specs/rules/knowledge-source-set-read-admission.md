---
id: knowledge-source-set-read-admission
title: Source selection preserves owner admission policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
pathPatterns:
  - electron/services/knowledge-source-set-answer.ts
  - electron/services/knowledge-api.ts
requiredTests:
  - tests/unit/knowledge-source-set-answer.test.ts
  - tests/unit/knowledge-api.test.ts
---

Explicit Source Set selection does not authorize a rejected source. Lexical,
semantic, and Studio paths must use the existing SourceSet admission rules before
source text enters an answer or an embedding batch. Do not replace owner status,
trust, revision, permissions, or freshness with stronger synthesized values.

Preserve supplied version pins, return owner-bound read-range citations, and
disclose rejections, known conflicts, truncation, and unknown freshness. An empty
admitted set remains empty after every fallback. Source excerpts alone are a
partial response and must not acquire a numeric answer-confidence score.

Source reads and artifact generation do not confer apply authority. Keep the
existing review and apply boundary and label verification as agent-driven.
