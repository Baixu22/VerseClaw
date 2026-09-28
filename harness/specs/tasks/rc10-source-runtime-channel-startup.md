---
id: rc10-source-runtime-channel-startup
title: RC-10 Source Runtime Channel Startup
taskType: runtime-bridge
intent: >
  Make the source-runtime gateway actually start the channels the desktop configured.
  Two independent gaps blocked it: (1) the desktop launch path hardcoded
  OPENCLAW_SKIP_CHANNELS=1 for runtimeMode 'source' and never synced the channels block
  into the isolated source config, so the sandboxed gateway had nothing to start even
  though the npm runtime starts channels from the same config; (2) the vendored source
  runtime's startGatewaySidecars never invoked startChannels() at all -- it only logged
  "skipping channel start (channel gateway handlers disabled)" -- while the upstream
  openclaw build wires startChannels() plus a 'sidecars.channel-start' startup trace and
  a channel-startup error log. Restore both so RC-10's H-02..H-06 can observe a real
  channel effect on the engineering-accepted runtime.
ownedPaths:
  - harness/specs/tasks/rc10-source-runtime-channel-startup.md
  - electron/gateway/config-sync.ts
  - tests/unit/config-sync-source-runtime.test.ts
  - openclaw_runtime/src/gateway/server-startup-post-attach.ts
  - openclaw_runtime/src/gateway/server-startup-post-attach.channel-start.test.ts
touchedAreas:
  - harness/specs/**
  - electron/**
  - openclaw_runtime/**
  - tests/unit/**
  - artifacts/runtime-authority-convergence/**
  - docs/dev/unified-agent-system/runtime-convergence/**
requiredProfiles:
  - fast
requiredRules:
  - runtime-authority-convergence-boundary
  - active-config-guards
  - backend-communication-boundary
expectedUserBehavior:
  - With no channel configured the gateway still launches with channel startup skipped (unchanged).
  - With a channel configured the source-runtime gateway starts it, the desktop channel view reports connected, and the channel peer observes the real connection.
  - The isolated source config carries the user's channels block on first write and on later syncs, and its sandboxed plugins switch no longer blocks explicitly configured channels.
  - Product locks stay false and no default value flips.
forbiddenPatterns:
  - starting channels for the source runtime when no channel is configured
  - writing channel credentials into any evidence or tracked file
  - changing product locks or default-on behavior
acceptance:
  - Unit coverage proves the channels block is merged into the isolated source config on first write and on later syncs, and that an explicitly configured channel turns the sandbox plugins switch back on while a disabled/absent channel does not.
  - Unit coverage proves startGatewaySidecars invokes startChannels when startup is not skipped and does not when OPENCLAW_SKIP_CHANNELS / OPENCLAW_SKIP_PROVIDERS is set.
  - A live probe connects a real channel (self-hosted IRC peer) through the product path: channels.configured lists it, the gateway starts it, and the peer observes registration/join.
docs:
  required: false
---
