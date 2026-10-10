---
id: telemetry-consent-lifecycle
title: Runtime telemetry consent owns SDK lifetime and outbound transport
type: ai-coding-rule
severity: error
---

# Telemetry consent lifecycle

- Apply runtime telemetry consent changes in Main through the existing settings API; do not require an application restart or add renderer-owned transports.
- Revocation must synchronously stop new captures, cancel stale initialization and prevent queued SDK events or retries from using the network. Discard the old client's queue locally; re-enable uses a fresh lifetime and cannot revive old events.
- Preserve cold-start opt-out and idempotent toggles. Do not change frozen defaults, the collector endpoint or project identifier as part of a lifecycle bug fix.
- Validate with synthetic identifiers and a no-network sink, including the real installed SDK queue. Report best-effort in-flight cancellation honestly: already delivered requests cannot be recalled.
