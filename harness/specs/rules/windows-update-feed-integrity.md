---
id: windows-update-feed-integrity
title: Windows Update Feed Integrity
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
---

Packaged Windows update checks must use a Main-owned, HTTPS-only feed derived
from the installed release channel. Renderer code must not choose a feed URL,
channel, provider, or transport.

Stable, alpha, and beta channels must resolve to their explicit OSS directories
and electron-updater metadata names. Unknown channels, non-HTTPS sources,
cross-origin redirects, wrong-channel metadata, missing SHA512, and package
hash/size mismatches fail closed before installation.

The release workflow and the client policy must share auditable source/channel
constants. Changes require focused tests for correct feed selection plus
tampered metadata/package and wrong source/channel rejection.
