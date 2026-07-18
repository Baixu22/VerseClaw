---
id: system-maturity-privacy-controls
title: System Maturity Privacy and Sensitive Capture Controls
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
---

Third-party data flows (model, OAuth, MCP, update, telemetry, sensitive capture)
must remain inventoried with source, destination, data classes, minimization,
user control, and retention. Clipboard, screenshot, and desktop automation
capture must honor a kill switch and grant policy. UI ErrorBoundary surfaces
must never render stack frames or secret-shaped content.
