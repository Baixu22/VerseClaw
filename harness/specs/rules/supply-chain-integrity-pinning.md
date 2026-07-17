---
id: supply-chain-integrity-pinning
title: Supply Chain Integrity Pinning
type: ai-coding-rule
appliesTo:
  - windows-release-trust
requiredProfiles:
  - fast
---

Every external executable or archive that enters a packaged build or release
job must be identified by a tracked version, HTTPS source, byte size, and
SHA256 digest. The digest must be checked before extraction, execution, or
placement in `resources/bin`. A mismatch fails closed and leaves no installed
binary behind.

Release workflows must not execute remote installer scripts through a pipe.
Tools such as ossutil must be downloaded as a pinned archive, verified, and
then extracted into a job-local directory without `sudo` mutation.

Every external GitHub Action in `.github/workflows/**` must use a full
40-character commit SHA that matches the tracked action-pin registry. Moving
major tags are documentation only and may appear in comments, never in the
executable `uses:` ref.

Changes require focused tests for checksum mismatch denial, offline verified
download behavior, manifest coverage of bundled assets, unsafe installer
rejection, and workflow action pin scanning.
