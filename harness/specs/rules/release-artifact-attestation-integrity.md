---
id: release-artifact-attestation-integrity
title: Release Artifact Attestation and Runtime Integrity
type: ai-coding-rule
appliesTo:
  - windows-release-trust
requiredProfiles:
  - fast
---

Every public release must produce a CycloneDX SBOM and an in-toto/SLSA-shaped
provenance statement whose subjects are the exact SHA256 digests of the files
entering publication. Metadata with missing, duplicate, extra, or changed
subjects fails before GitHub or OSS publication.

The release workflow must create GitHub artifact attestations for build
provenance and the SBOM using immutable Action commit pins. The portable SBOM
and provenance files must be uploaded with the release artifacts so they can be
inspected without trusting the build workspace.

Electron packaging must keep ASAR enabled and set both
`enableEmbeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar`. Packaged
binary verification must inspect the actual fuse wire. A disabled critical fuse
or changed ASAR digest fails closed. Compatibility fuses such as RunAsNode or
NodeOptions must not be changed without proving that the existing OpenClaw CLI
and utility-process paths no longer depend on them.

Changes require focused tests for SBOM subject binding, independent provenance
verification, metadata tampering, fuse policy tampering, and packaged fuse-wire
inspection behavior.
