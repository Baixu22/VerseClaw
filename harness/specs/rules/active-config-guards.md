---
id: active-config-guards
title: Active Config Guards
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - plugin-lifecycle-management
---

Final OpenClaw runtime config must represent the resolved and validated plugin state, not raw discovery state.

Rules:

- unresolved or conflicted capabilities must not be written as active runtime owners
- allowlists and entries must agree about which package owns a single-owner capability
- disabling a bundled plugin is required when removing it from an allowlist is not sufficient to stop runtime loading
- stale plugin registrations for unconfigured capabilities must be removed during sanitize or recovery paths
- tests for config rewrites should assert the final active config, not only intermediate helper output

Retired capabilities stay unavailable through request parameters, configuration defaults,
overrides and restored execution markers. Admission must enforce retirement at the actual
execution owner. Preserve recorded historical effects while preventing new retired effects;
Developer descriptions and model recommendations use the same effective availability.
