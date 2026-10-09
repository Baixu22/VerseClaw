---
id: gateway-endpoint-single-source
title: The local Gateway endpoint has one source of truth
type: ai-coding-rule
severity: error
requiredTests:
  - tests/unit/gateway-endpoint-single-source.test.ts
---

# Gateway endpoint single source

## Rule

`shared/gateway-endpoint.ts` is the only place where the local OpenClaw Gateway
port may be written as a literal. Every host, `host:port` pair, HTTP origin,
webRequest URL filter, rule-detection regex and generated instruction line must
be derived from `OPENCLAW_GATEWAY_PORT` and the helpers next to it.

Forbidden:

- a `18789` literal in production source under `electron/`, `src/` or `shared/`
  (tests are exempt);
- rule-detection regexes in `electron/services/project-rules-api.ts` that embed
  the endpoint text directly — build them from `GATEWAY_HOST_PORT_REGEX_SOURCE`;
- user-facing or localized copy that names the port. Describe the endpoint
  generically ("the local Gateway endpoint") so the copy cannot go stale.

## Why

The port used to be duplicated across Main config defaults, the renderer stores,
the mock host bridge, the Control-UI URL filter, the project-rules detector
(regexes *and* generated `AGENTS.md` copy) and four localized settings
descriptions. Changing the port silently stopped the detector from matching
instead of failing loudly, so a security-adjacent rule quietly disappeared.

The port remains overridable per process through
`VERSE_CLAW_PORT_OPENCLAW_GATEWAY` (`getPort('OPENCLAW_GATEWAY')`); the constant
is the default, not a hard-coded runtime value.

## Enforcement

`tests/unit/gateway-endpoint-single-source.test.ts` scans `electron/`, `src/` and
`shared/` for the literal and fails on any file other than the constant module,
and it pins the derived pairs, origins, URL filters, human-readable list and
regex escaping so a port change cannot silently change their shape.
`tests/unit/project-rules-api.test.ts` keeps the detector behaviour (missing ban
warning, allowed/banned direct-Gateway statements) covered through the derived
regexes.

Documentation and Release notes may still state the default port in prose; that
is descriptive text, not a load-bearing duplicate.
