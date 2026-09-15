---
id: renderer-main-boundary
title: Renderer Main Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Renderer pages and components use the existing host API and API client modules as their only backend entrypoints. Main-process IPC details stay behind those modules.

Knowledge Review Queue is a renderer projection of the existing Inbox, Draft and Proposal records. Preparing a proposal and applying it are separate explicit actions. Approval must use the selected draft's own proposal; changing selection must not display or apply another draft's proposal or steward result. Chat knowledge answers may create candidates through the existing Host API, but may not apply them automatically.
