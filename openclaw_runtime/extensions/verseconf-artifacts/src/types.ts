export const VERSECONF_ARTIFACT_API_VERSION = 1 as const;
export const ARTIFACT_KINDS = ["research-table", "slide-outline"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type SchemaIdentity = {
  schemaId: string;
  version: string;
  digest: string;
  draft: "draft-07" | "2020-12";
};

export type ArtifactContext = {
  workspaceDir: string;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  requestId: string;
};

export type ArtifactRecord = {
  artifactId: string;
  kind: ArtifactKind;
  workspaceDir: string;
  sourcePath: string;
  currentRevisionId: string;
  schemaText: string;
  schemaIdentity: SchemaIdentity;
  createdAt: number;
  updatedAt: number;
  disabledAt?: number;
};

export type ArtifactRevision = {
  revisionId: string;
  artifactId: string;
  sequence: number;
  parentRevisionId: string | null;
  sourceText: string;
  sourceSha256: string;
  schemaIdentity: SchemaIdentity;
  operationId: string;
  journalRef: string | null;
  status: "committed" | "unchanged" | "recovered";
  context: Pick<ArtifactContext, "sessionKey" | "sessionId" | "agentId">;
  createdAt: number;
};

export type ArtifactOutput = {
  outputId: string;
  artifactId: string;
  revisionId: string;
  format: "markdown" | "csv" | "xlsx" | "pptx";
  rendererVersion: string;
  path: string;
  contentSha256: string;
  bytes: number;
  journalRef: string | null;
  validationStatus: "not-run" | "passed" | "failed";
  createdAt: number;
};

export type ArtifactOperation = {
  operationId: string;
  artifactId: string;
  kind: "create" | "revise" | "restore" | "record-op" | "export" | "disable";
  state: "prepared" | "committed" | "unchanged" | "rejected" | "rolled_back" | "recovery_required";
  request: Record<string, unknown>;
  beforeSha256: string | null;
  candidateSha256: string | null;
  afterSha256: string | null;
  journalRef: string | null;
  recoveryRef: string | null;
  context: Pick<ArtifactContext, "workspaceDir" | "sessionKey" | "sessionId" | "agentId">;
  createdAt: number;
  updatedAt: number;
};

export type ArtifactListResult = {
  artifacts: Array<Pick<ArtifactRecord, "artifactId" | "kind" | "sourcePath" | "currentRevisionId" | "updatedAt" | "disabledAt">>;
};

export type ArtifactMutationResult = {
  apiVersion: 1;
  ok: boolean;
  artifactId: string;
  operationId: string;
  state: ArtifactOperation["state"];
  revision?: ArtifactRevision;
  diagnostics?: Array<{ code: string; message: string; path?: string }>;
  journalRef?: string | null;
  recoveryRef?: string | null;
};
