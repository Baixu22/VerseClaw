---
title: shared/knowledge/owner-read-contract.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: shared/knowledge/owner-read-contract.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
export type {
  ReadAdmissionContextV1,
  SourceRefV2,
  RawSourceLocator,
  OwnerReadPolicy,
  OwnerReadSnapshotV1,
  OwnerReadRejectionCode,
} from 'openclaw/plugin-sdk/memory-owner-read-types';

~~~
