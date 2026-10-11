# P1 batch 2: telemetry, environment, MCP and renderer security boundaries

- Date: 2026-10-10
- Issues: #86, #87, #107, #108, #126, #127, #128, #129
- driven_by: agent
- actor: codex-p1-batch2
- Base: `origin/main = 578817dd902365fa4ead04911a5d11f456aff782`

## Implemented behavior

1. **#108** - secret-adjacent memory is passed through the mandatory tools-mode
   redactor before context assembly, with explicit Bearer/token handling.
2. **#126** - host env inheritance and overrides reject credential-shaped keys
   such as provider API keys, custom provider keys and gateway tokens; required
   OS/runtime variables remain available.
3. **#128** - MCP transport creation rejects `networkPolicy=disabled` and
   remote `localOnly` endpoints before the SDK can initialize.
4. **#129** - runtime telemetry opt-out shuts down the initialized client and
   blocks subsequent captures; re-enabling initializes a fresh lifecycle.
5. **#107** - role filesystem=read/network=none emits capability sentinels at
   the final effective-tool-policy boundary. Dynamic MCP tools are removed
   unless the server is explicitly configured read-only; network=none is
   conservative for all dynamic MCP tools.
6. **#127** - HTTP(S) image targets are not renderable transcript resources and
   renderer CSP `img-src` now allows only self/data/blob.
7. **#87** - OfficeCLI installer URLs are pinned to commit
   `699cafbc8f0b8a7841c6cca53dafd0c24e982f56` and verified against SHA-256
   before execution.
8. **#86** - the PostHog ingest key is no longer hardcoded. Deployment must
   provide `VERSE_CLAW_POSTHOG_API_KEY` (and optionally
   `VERSE_CLAW_POSTHOG_HOST`); missing configuration disables telemetry.

## Verification boundary

Tests use synthetic credentials, fake MCP capability metadata, local loopback
fixtures and command-string assertions. They do not execute a remote installer,
send real telemetry, use a real provider key, or claim a paid-provider or
human-verified acceptance. OfficeCLI hash values were fetched read-only from the
live mirror/GitHub and are pinned in source.
