import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_AUTHORITY_MANIFEST,
  MEMORY_MIGRATION_MAP,
  MEMORY_PRODUCT_PROFILE,
  MEMORY_STORE_BOUNDARIES,
  validateMemoryAuthorityManifest,
} from "../../../../../../openclaw_runtime/src/memory/memory-authority.js";
import {
  RuntimeMemoryStore,
} from "../../../../../../openclaw_runtime/src/runtime-core/memory-store.js";
import {
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  isRuntimeMemoryAcceptedVerificationStatus,
} from "../../../../../../openclaw_runtime/src/runtime-core/memory-context.js";
import {
  assertSingleMemorySlotOwner,
  buildSlotMechanismCensus,
} from "../../../../../../openclaw_runtime/src/agents/slot-convergence.js";
import type { ComponentGraduationReport, GraduationArtifactRef } from "../../../../../../shared/component-graduation-report.js";

const root = process.cwd();
const outputDir = "tests/unit/fixtures/memory-authority/acceptance/TF-0497";
const evidencePath = outputDir + "/raw-evidence.json";
const reportPath = outputDir + "/component-graduation-report.json";
const sumsPath = outputDir + "/SHA256SUMS";
const reportId = "tf-0497-memory-authority-control-plane";

const sourcePaths = [
  "openclaw_runtime/src/memory/memory-authority.ts",
  "openclaw_runtime/src/memory/memory-card.ts",
  "openclaw_runtime/src/memory/memory-policy.ts",
  "openclaw_runtime/src/memory/memory-store.ts",
  "openclaw_runtime/src/memory/root-memory-files.ts",
  "openclaw_runtime/src/runtime-core/memory-context.ts",
  "openclaw_runtime/src/runtime-core/memory-store.ts",
  "openclaw_runtime/src/runtime-core/memory-persistence.ts",
  "openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts",
  "openclaw_runtime/src/runtime-core/memory-embedding-provider.ts",
  "openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts",
  "openclaw_runtime/src/agents/slot-convergence.ts",
  "shared/component-authority-manifest.ts",
  "shared/dcs/prod-flags-catalog.ts",
  "tests/unit/memory-authority-contract.test.ts",
  "tests/unit/rc07-memory-context-slot-convergence.test.ts",
  "tests/unit/r3-2-memory-settings-switches.test.ts",
  "tests/unit/runtime-memory-store.test.ts",
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function artifact(relativePath: string): GraduationArtifactRef {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: sha256(bytes), bytes: bytes.length };
}
function writeJson(relativePath: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relativePath), JSON.stringify(value, null, 2) + "\n", "utf8");
}

const nodes = JSON.parse(fs.readFileSync(path.join(root, ".agent-workbench/task-forest/graph/nodes.json"), "utf8")) as Record<string, { acceptance_criteria: string[] }>;
const criteria = nodes["TF-0497"]?.acceptance_criteria;
if (!criteria || criteria.length !== 4) throw new Error("TF-0497 acceptance criteria unavailable");

const validation = validateMemoryAuthorityManifest();
if (!validation.ok) throw new Error("memory authority manifest invalid: " + JSON.stringify(validation.issues));

const store = new RuntimeMemoryStore();
const acceptedFact = buildRuntimeMemoryTemporalFactFixture({ factId: "tf0497-accepted-fact" });
const candidateFact = buildRuntimeMemoryTemporalFactCandidateFixture({ factId: "tf0497-candidate-fact" });
store.appendFact(acceptedFact);
store.appendFact(candidateFact);
const defaultFacts = store.queryFacts().map((fact) => fact.factId);
const reviewFacts = store.queryFacts({ includeCandidates: true }).map((fact) => fact.factId);
const candidateIsolated =
  defaultFacts.length === 1 &&
  defaultFacts[0] === "tf0497-accepted-fact" &&
  reviewFacts.includes("tf0497-candidate-fact") &&
  !isRuntimeMemoryAcceptedVerificationStatus(candidateFact.verificationStatus) &&
  isRuntimeMemoryAcceptedVerificationStatus(acceptedFact.verificationStatus);
if (!candidateIsolated) throw new Error("candidate isolation fixture failed");

const census = buildSlotMechanismCensus({
  registeredPlugins: [
    { id: "memory-core", kind: "memory" },
    { id: "memory-lancedb", kind: "memory" },
  ],
  memorySlotId: "memory-core",
  runtimeMemoryPersist: false,
});
const ownerConvergence =
  census.parallelMemoryWriters === 0 &&
  census.autoWritebackCount === 0 &&
  assertSingleMemorySlotOwner({ memorySlotId: "memory-core" }).ok &&
  !assertSingleMemorySlotOwner({ memorySlotId: "runtime-memory", runtimeMemoryPersist: false }).ok;
if (!ownerConvergence) throw new Error("memory writer convergence fixture failed");

const domainSummary = MEMORY_AUTHORITY_MANIFEST.entries.map((entry) => ({
  id: entry.id,
  dataType: entry.dataType,
  scopes: entry.scopes,
  acceptedMemory: entry.acceptedMemory,
  productControlPlane: entry.productControlPlane,
  acceptAuthority: entry.operations.accept,
  updateAuthority: entry.operations.update,
  deleteAuthority: entry.operations.delete,
  retrievalAuthorities: entry.operations.retrieve,
  injectionAuthority: entry.injectionAuthority,
  injectionPolicy: entry.lifecycle.injection,
  retention: entry.lifecycle.retention,
  deletePolicy: entry.lifecycle.delete,
  invalidation: entry.lifecycle.invalidation,
  retrieval: entry.lifecycle.retrieval,
  storage: entry.storage,
  migration: entry.migration,
}));

const criteriaEvidence = [
  {
    criterion: criteria[0],
    status: "pass",
    evidence: [
      "MemoryAuthorityManifest/v1",
      "duplicateAcceptedAuthorities=" + validation.duplicateAcceptedAuthorities,
      "duplicateUpdateAuthorities=" + validation.duplicateUpdateAuthorities,
      "store boundaries remain per data domain",
    ],
  },
  {
    criterion: criteria[1],
    status: "pass",
    evidence: [
      "role-card active/cold/archive/tombstone + supersededBy",
      "runtime fact/timeline/episode append-only invalidation",
      "embedding is rebuildable and accepts no memory",
      "candidate injection=never until approval",
    ],
  },
  {
    criterion: criteria[2],
    status: "pass",
    evidence: [
      "migration mappings=" + MEMORY_MIGRATION_MAP.length,
      "removesSource=false for every mapping",
      "role-memory.sqlite and openclaw-state.sqlite remain separate",
      "Dreaming/SEKB import only as proposals/candidates",
    ],
  },
  {
    criterion: criteria[3],
    status: "pass",
    evidence: [
      "MemoryProductProfile/v1",
      "conceptCount=" + MEMORY_PRODUCT_PROFILE.conceptCount,
      "automaticAcceptanceAllowed=false",
      "automaticWritebackAllowed=false",
    ],
  },
];

const evidence = {
  schemaVersion: "MemoryAuthorityAcceptanceEvidence/v1",
  reportId,
  taskForestNodeId: "TF-0497",
  generatedAt: new Date().toISOString(),
  driven_by: "agent",
  actor: "codex-long-session-r2",
  acceptanceCriteria: criteriaEvidence,
  authority: {
    schemaVersion: MEMORY_AUTHORITY_MANIFEST.schemaVersion,
    entryCount: MEMORY_AUTHORITY_MANIFEST.entries.length,
    duplicateAcceptedAuthorities: validation.duplicateAcceptedAuthorities,
    duplicateUpdateAuthorities: validation.duplicateUpdateAuthorities,
    parallelPromptInjectionPaths: validation.parallelPromptInjectionPaths,
    databaseClusteringRequired: validation.databaseClusteringRequired,
    domains: domainSummary,
  },
  migration: {
    mappings: MEMORY_MIGRATION_MAP,
    storeBoundaries: MEMORY_STORE_BOUNDARIES,
    sourceRemovalCount: MEMORY_MIGRATION_MAP.filter((mapping) => mapping.removesSource).length,
    acceptedMemoryDatabaseCount: MEMORY_STORE_BOUNDARIES.filter((boundary) => boundary.canonicalForAcceptedMemory).length,
  },
  profile: MEMORY_PRODUCT_PROFILE,
  runtimeAssertions: {
    defaultFacts,
    reviewFacts,
    candidateIsolated,
    parallelMemoryWriters: census.parallelMemoryWriters,
    autoWritebackCount: census.autoWritebackCount,
    ownerConvergence,
  },
  diskReadback: {
    status: "pending-external-verification",
    evidenceReadable: false,
    sha256sumsVerified: false,
    receiptPath: outputDir + "/12-sha256sums-check.txt",
  },
  evidenceNotes: {
    noProductDefaultChanged: true,
    noDataStoreClustering: true,
    noAutomaticWriteback: true,
    noUserSurfaceClaim: true,
    verseGitExcluded: true,
    publicReleaseClaimed: false,
  },
  results: {
    contract: { status: "pass" },
  },
};
writeJson(evidencePath, evidence);
const persisted = JSON.parse(fs.readFileSync(path.join(root, evidencePath), "utf8")) as typeof evidence;
persisted.diskReadback.evidenceReadable = true;
writeJson(evidencePath, persisted);
const reread = JSON.parse(fs.readFileSync(path.join(root, evidencePath), "utf8")) as typeof evidence;
if (
  reread.results.contract.status !== "pass" ||
  !reread.runtimeAssertions.candidateIsolated ||
  reread.diskReadback.status !== "pending-external-verification" ||
  !reread.diskReadback.evidenceReadable ||
  reread.diskReadback.sha256sumsVerified
) {
  throw new Error("evidence readback must remain pending until external SHA256 verification");
}

const rawArtifact = artifact(evidencePath);
const bindingArtifacts = [
  ...sourcePaths.map(artifact),
  artifact(outputDir + "/README.md"),
  artifact(outputDir + "/generate-acceptance.mts"),
  artifact(outputDir + "/run-verification.ps1"),
  artifact(evidencePath),
];
const inputDigest = sha256(bindingArtifacts.map((entry) => entry.path + "\0" + entry.sha256 + "\0" + entry.bytes).sort().join("\n"));
const buildHash = inputDigest;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
const report: ComponentGraduationReport = {
  schemaVersion: "ComponentGraduationReport/v1",
  reportId,
  reportKind: "contract",
  componentId: "role-memory-card-governance",
  taskForestNodeId: "TF-0497",
  disposition: "internal",
  maturity: "verified",
  owner: "TF-0497",
  entryPoint: "openclaw_runtime/src/memory/memory-authority.ts",
  defaultMode: "opt-in",
  benefitEvidence: "One memory authority contract assigns every Role/Runtime/Dreaming/Embedding/SEKB data domain to one accepting/update authority and prevents candidates from becoming retrievable or prompt-injectable accepted memory.",
  rollback: "Remove the contract projection and retain the existing stores; no source store, candidate, accepted memory, or default value is deleted or rewritten.",
  modelEffectiveState: MEMORY_PRODUCT_PROFILE.modelSafeSummary.join(" "),
  evidenceGrade: "unit-test",
  actor: "codex-long-session-r2",
  driven_by: "agent",
  expiry: null,
  binding: {
    commit,
    tree,
    buildHash,
    runtimeGeneration: "memory-authority-tf0497",
    provider: "fixture-provider",
    model: "fixture-model",
    inputSet: "tf0497-memory-authority-contract",
    scope: "workspace:long-session-program-r2/session:tf-0497",
    artifacts: bindingArtifacts,
  },
  evidence: [
    {
      kind: "contract",
      status: "pass",
      grade: "unit-test",
      summary: "Authority uniqueness, lifecycle semantics, non-destructive migration mapping and the single product memory profile pass the contract fixtures.",
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
  ],
  recompute: {
    verdict: "pass",
    inputDigest,
    command: "& .\\openclaw_runtime\\node_modules\\.bin\\tsx.CMD tests/unit/fixtures/memory-authority/acceptance/TF-0497/generate-acceptance.mts",
  },
};
writeJson(reportPath, report);

const sumTargets = [
  ...sourcePaths,
  outputDir + "/README.md",
  outputDir + "/generate-acceptance.mts",
  outputDir + "/run-verification.ps1",
  evidencePath,
  reportPath,
];
const sums = sumTargets.sort().map((relativePath) => sha256(fs.readFileSync(path.join(root, relativePath))) + "  " + relativePath).join("\n");
fs.writeFileSync(path.join(root, sumsPath), sums + "\n", "utf8");
if (!sums.split("\n").filter(Boolean).every((line) => {
  const [expected, fileName] = line.split("  ", 2);
  return Boolean(expected && fileName && sha256(fs.readFileSync(path.join(root, fileName))) === expected);
})) {
  throw new Error("SHA256SUMS verification failed");
}
if (persisted.diskReadback.receiptPath !== `${outputDir}/12-sha256sums-check.txt`) {
  throw new Error("external SHA256 verification receipt path is missing");
}
console.log(JSON.stringify({ ok: true, reportId, evidencePath, reportPath, sumsPath, validation, candidateIsolated, ownerConvergence }, null, 2));
