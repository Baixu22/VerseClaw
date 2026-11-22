/** Public type-only contract for owner reads across Host and renderer boundaries. */
export type {
  ReadAdmissionContextV1,
  SourceRefV2,
  SourceDomain,
  RawSourceLocator,
  OwnerReadPolicy,
  OwnerReadSnapshotV1,
  OwnerReadRejectionCode,
  OwnerReadStage,
} from "../runtime-core/knowledge-owner-read.js";
export type {
  KnowledgeCandidatePackingV2,
  RetainedEvidenceManifestV1,
} from "../runtime-core/knowledge-packing-types.js";
