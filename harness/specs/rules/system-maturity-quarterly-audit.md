---
id: system-maturity-quarterly-audit
title: System Maturity Quarterly Audit and Phase Review
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
---

Quarterly maturity audits must trace every phase STATUS.json path, require risk
acceptance entries with non-expired reviewBy deadlines for Track/Accept
decisions, and automatically block release when P0 or P1 is incomplete.
Agent Dev audit grade/releaseReady must be captured as a caveat only and must
not be extrapolated to whole-system release readiness.
