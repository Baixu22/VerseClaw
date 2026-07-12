---
id: reach-readers-credential-hygiene
title: Reach Readers Credential Hygiene
type: ai-coding-rule
appliesTo:
  - agent-reach-readers-integration
pathPatterns:
  - openclaw_runtime/extensions/reach-readers/**
requiredProfiles:
  - fast
  - e2e
---

Credential resolution order is plugin configuration, resolved SecretInput,
then environment variables. YouTube transcription reuses OpenClaw
media-understanding provider credentials and must not introduce a second
OpenAI or Groq plaintext key surface.

The Browser bridge may request cookies only through
`agent_browser` command argv `["cookies"]`. It filters cookies to the target
platform domain and parses them only in plugin process memory.

Cookie values, tokens, SecretInput values, complete authenticated request
headers, and unredacted browser storage must never enter logs, diagnostics,
tool results, test snapshots, generated artifacts, or model-visible content.

Tests use synthetic credentials and a test browser profile. Live credentials
must not be committed. Authentication failures return sanitized status codes
and actionable handoff metadata without echoing credential material.
