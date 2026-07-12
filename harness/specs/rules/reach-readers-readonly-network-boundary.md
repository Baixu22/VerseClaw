---
id: reach-readers-readonly-network-boundary
title: Reach Readers Read-only and Network Boundary
type: ai-coding-rule
appliesTo:
  - agent-reach-readers-integration
pathPatterns:
  - openclaw_runtime/extensions/reach-readers/**
requiredProfiles:
  - fast
  - comms
---

All Agent Reach tools and plugin contracts are read-only. The plugin must not
create, update, or delete remote content and must not create or mutate
`~/.agent-reach/config.json`.

All network reads pass through one guarded HTTP boundary using
`fetchWithSsrFGuard`, bounded redirects, timeout and AbortSignal propagation,
and a response-size limit.

User-controlled URLs use strict SSRF policy and reject loopback, link-local,
private, reserved, and redirect-to-private targets. Fixed platform requests
use explicit official-domain allowlists. Cross-origin redirects must not carry
Cookie or Authorization headers unless the destination is explicitly trusted.

All subprocesses use the public runtime command runner and Windows spawn
resolver with argv arrays, UTF-8 environment settings, timeout, AbortSignal,
and bounded output. User input must never be interpolated into a shell command.

Agent Browser is a fallback after imported API/CLI paths. An unavailable bridge
must preserve original diagnostics and add
`browserFallback: "unavailable"`. Temporary headless sessions close after the
read; visible login handoff sessions remain available for user control.
