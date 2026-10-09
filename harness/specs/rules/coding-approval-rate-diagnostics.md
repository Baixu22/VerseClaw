---
id: coding-approval-rate-diagnostics
title: Coding approval classification diagnostics remain observational
type: ai-coding-rule
severity: error
---

- Observe only explicitly enabled runtime diagnostics; keep omitted/default configuration unchanged.
- Count destructive-tier classifications, not actual dialogs or human approvals. Preserve the cumulative counter contract.
- Bound samples and evaluate each new window once. Require two high/low windows; missing, expired or invalid clock data cannot assert health.
- Use the existing runtime diagnostic logger. Do not read a Main-process copy of the registry as runtime telemetry.
- Logs carry scope, sample count, timestamps, rate availability, reason and next action; never tool arguments/content.
- Diagnostics and their failures must not authorize, block, retry or alter tool effects. Only acknowledge a notification after the logging call succeeds.
- Preserve defaults/locks and historical evidence. Do not rehash B00 snapshots to match later implementation changes.
