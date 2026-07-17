---
id: windows-release-signing-policy
title: Windows Release Signing Policy
type: ai-coding-rule
appliesTo:
  - windows-release-trust
requiredProfiles:
  - fast
---

The Windows release workflow must derive channel and signing decisions from the
tracked policy module. Stable releases require SignPath plus successful
`Get-AuthenticodeSignature` verification for every Windows executable. Alpha
and beta releases may skip signing only when they remain prerelease and do not
target the public latest channel. Unknown prerelease channels fail closed.

The build must emit exactly one version-bound signing attestation. A dedicated
pre-publish job must validate that attestation and the post-sign `latest.yml`
SHA512/size metadata before either GitHub release publication or OSS upload can
start. A gate that runs only after artifacts have been uploaded is insufficient.

Changes to the policy module or release workflow must include focused unit
coverage for channel classification, unsigned-public denial, Authenticode
attestation validation, workflow dependency anchors, and updater metadata
tamper detection.
