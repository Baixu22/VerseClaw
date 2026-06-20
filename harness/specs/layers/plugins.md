---
id: plugins
title: Plugin Layer
type: layer-spec
pathPatterns:
  - resources/openclaw-plugins/**
  - openclaw_runtime/extensions/**
---

Plugin behavior should stay owned by plugin contracts unless a generic ClawX or OpenClaw core seam is missing.

Do not hardcode individual plugin identities in shared runtime paths when manifest, registry, or capability contracts can express the behavior.

Plugin lifecycle work should reference `plugin-lifecycle-management` and keep install, recovery, rollback, and validation behavior covered by harness specs.
