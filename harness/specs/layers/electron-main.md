---
id: electron-main
title: Electron Main Layer
type: layer-spec
pathPatterns:
  - electron/main/**
  - electron/services/**
  - electron/gateway/**
  - electron/preload/**
  - electron/utils/**
---

Electron Main owns host integration, IPC handlers, Gateway supervision, local process launch, filesystem access, and OS credential/keychain boundaries.

Renderer-facing behavior must be exposed through typed host-api/api-client surfaces. Gateway transport selection, retries, readiness, and protocol fallback stay in Main-owned services.

When changing this layer, prefer focused unit tests for service contracts and add E2E coverage when user-visible desktop behavior changes.
