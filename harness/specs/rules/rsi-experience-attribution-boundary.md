---
id: rsi-experience-attribution-boundary
title: Preserve experience identity, provenance and observed outcome boundaries
type: ai-coding-rule
appliesTo:
  - rsi-experience-adoption-attribution
---

Record retrieval, citation, adoption and outcome separately. Bind adopted experience to its recalled content digest and the same task/run/session, with explicit experiment/arm/repeat coordinates when supplied by the executor. Do not derive those coordinates from task text or agent tool arguments.

An adoption record needs a matching exposure and observed operation in that run. Deduplicate and update metrics atomically in the existing SQLite owner. Reject conflicting replays, unexposed identities and drifted versions with readable diagnostics. Preserve unknown outcomes and missing linkage without assigning success or an experimental case.

Agent attribution and operational completion are observable evidence with named sources. Independently graded task success and paired causal benefit require their own evidence. Attribution feedback does not silently change retrieval, retention, selection, confirmation permissions or frozen defaults.
