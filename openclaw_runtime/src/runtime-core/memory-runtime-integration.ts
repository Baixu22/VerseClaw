import {
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  resolveRuntimeMemoryFeatureFlags,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemoryFactRelation,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryInvalidationReason,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
} from "./memory-context.js";
import {
  createRuntimeMemoryPersistenceStore,
  type RuntimeMemoryPersistenceAccessResult,
  type RuntimeMemoryPersistenceLoadResult,
  type RuntimeMemoryPersistenceMigrationResult,
  type RuntimeMemoryPersistenceOptions,
  type RuntimeMemoryPersistenceRelationResult,
  type RuntimeMemoryPersistenceWriteResult,
} from "./memory-persistence.js";
import { RuntimeMemoryStore, type RuntimeMemoryStoreOptions } from "./memory-store.js";
import {
  decideAUDN,
  DEFAULT_WRITE_CURATION_CONFIG,
  type WriteCurationConfig,
} from "./memory-write-curation.js";

export type RuntimeMemoryRuntimeIntegrationPort = {
  migrate(): RuntimeMemoryPersistenceMigrationResult;
  appendEpisode(
    episode: RuntimeMemoryEpisodeRecord,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryEpisodeRecord>;
  appendFact(
    fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryQueryableFact>;
  invalidateFact(
    proposal: RuntimeMemoryInvalidationProposal,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryInvalidationProposal>;
  persistRelation(
    relation: Omit<RuntimeMemoryFactRelation, "relationId" | "createdAt">,
  ): RuntimeMemoryPersistenceRelationResult;
  recordFactAccess(factId: string): RuntimeMemoryPersistenceAccessResult;
  loadStore(): RuntimeMemoryPersistenceLoadResult;
};

export type RuntimeMemoryCurationOptions = {
  enabled: boolean;
  config?: WriteCurationConfig;
};

export type RuntimeMemoryRuntimeIntegrationOptions =
  RuntimeMemoryPersistenceOptions & {
    persistence?: RuntimeMemoryRuntimeIntegrationPort;
    curation?: RuntimeMemoryCurationOptions;
  };

export function createRuntimeMemoryRuntimeIntegration(
  options: RuntimeMemoryRuntimeIntegrationOptions = {},
): RuntimeMemoryRuntimeIntegration {
  return new RuntimeMemoryRuntimeIntegration(options);
}

export class RuntimeMemoryRuntimeIntegration {
  readonly #config: unknown;
  readonly #persistence: RuntimeMemoryRuntimeIntegrationPort;
  readonly #storeOptions: RuntimeMemoryStoreOptions;
  readonly #curationEnabled: boolean;
  readonly #curationConfig: WriteCurationConfig;

  constructor(options: RuntimeMemoryRuntimeIntegrationOptions = {}) {
    this.#config = options.config;
    this.#storeOptions = storeOptionsFrom(options);
    this.#persistence = options.persistence ??
      createRuntimeMemoryPersistenceStore(persistenceOptionsFrom(options));
    this.#curationEnabled = options.curation?.enabled === true;
    this.#curationConfig = options.curation?.config ?? DEFAULT_WRITE_CURATION_CONFIG;
  }

  migrate(): RuntimeMemoryPersistenceMigrationResult {
    if (!this.persistEnabled()) {
      return disabledMigrationResult();
    }
    return this.#persistence.migrate();
  }

  appendEpisode(
    episode: RuntimeMemoryEpisodeRecord,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryEpisodeRecord> {
    if (!this.persistEnabled()) {
      return disabledWriteResult();
    }
    return this.#persistence.appendEpisode(episode);
  }

  appendFact(
    fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryQueryableFact> {
    if (!this.persistEnabled()) {
      return disabledWriteResult();
    }

    // AUDN curation only applies to incoming candidates. Already-verified
    // facts bypass curation (they were curated at proposal time).
    if (!this.#curationEnabled || !isRuntimeMemoryTemporalFactCandidate(fact)) {
      return this.#persistence.appendFact(fact);
    }

    return this.appendFactWithCuration(fact);
  }

  private appendFactWithCuration(
    candidate: RuntimeMemoryTemporalFactCandidate,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryQueryableFact> {
    const loadResult = this.#persistence.loadStore();
    const store = loadResult.store;

    const existingFacts = store
      .queryFacts({ subject: candidate.subject })
      .filter(isRuntimeMemoryTemporalFact)
      .filter((f) => f.invalid_at === undefined);

    const decision = decideAUDN(candidate, existingFacts, this.#curationConfig);

    switch (decision.action) {
      case "NONE":
        return {
          status: "skipped",
          reason: "flag_disabled",
          persisted: false,
        };

      case "ADD":
        return this.#persistence.appendFact(candidate);

      case "UPDATE": {
        const invalidation = buildSupersedeInvalidation(
          decision.supersedes,
          candidate,
        );
        const invResult = this.#persistence.invalidateFact(invalidation);
        if (invResult.status === "rejected") {
          return invResult;
        }
        const appendResult = this.#persistence.appendFact(candidate);
        if (appendResult.status === "persisted") {
          this.#persistence.persistRelation({
            sourceFactId: candidate.factId,
            targetFactId: decision.supersedes,
            relationType: "supersedes",
            confidence: 0.9,
          });
        }
        return appendResult;
      }

      case "SUPERSEDE": {
        const invalidation = buildSupersedeInvalidation(
          decision.supersedes,
          candidate,
          "contradicted",
        );
        const invResult = this.#persistence.invalidateFact(invalidation);
        if (invResult.status === "rejected") {
          return invResult;
        }
        const appendResult = this.#persistence.appendFact(candidate);
        if (appendResult.status === "persisted") {
          this.#persistence.persistRelation({
            sourceFactId: candidate.factId,
            targetFactId: decision.supersedes,
            relationType: "supersedes",
            confidence: 1.0,
          });
          this.#persistence.persistRelation({
            sourceFactId: candidate.factId,
            targetFactId: decision.supersedes,
            relationType: "contradicts",
            confidence: 0.8,
          });
        }
        return appendResult;
      }

      case "DELETE": {
        const invalidation = buildDeleteInvalidation(
          decision.targetFactId,
          decision.reason,
          candidate,
        );
        const invResult = this.#persistence.invalidateFact(invalidation);
        if (invResult.status === "rejected") {
          return invResult;
        }
        // DELETE appends no new fact; the target was invalidated above.
        return {
          status: "skipped",
          reason: "flag_disabled",
          persisted: false,
        };
      }
    }
  }

  invalidateFact(
    proposal: RuntimeMemoryInvalidationProposal,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryInvalidationProposal> {
    if (!this.persistEnabled()) {
      return disabledWriteResult();
    }
    return this.#persistence.invalidateFact(proposal);
  }

  persistRelation(
    relation: Omit<RuntimeMemoryFactRelation, "relationId" | "createdAt">,
  ): RuntimeMemoryPersistenceRelationResult {
    if (!this.persistEnabled()) {
      return { status: "skipped", reason: "flag_disabled", persisted: false };
    }
    return this.#persistence.persistRelation(relation);
  }

  recordFactAccess(factId: string): RuntimeMemoryPersistenceAccessResult {
    if (!this.persistEnabled()) {
      return { status: "skipped", reason: "flag_disabled", persisted: false };
    }
    return this.#persistence.recordFactAccess(factId);
  }

  loadStore(): RuntimeMemoryPersistenceLoadResult {
    if (!this.persistEnabled()) {
      return {
        status: "skipped",
        reason: "flag_disabled",
        store: new RuntimeMemoryStore(this.#storeOptions),
      };
    }
    return this.#persistence.loadStore();
  }

  private persistEnabled(): boolean {
    return resolveRuntimeMemoryFeatureFlags(this.#config).persist;
  }
}

function persistenceOptionsFrom(
  options: RuntimeMemoryRuntimeIntegrationOptions,
): RuntimeMemoryPersistenceOptions {
  const persistenceOptions: RuntimeMemoryPersistenceOptions = {
    ...storeOptionsFrom(options),
  };
  if (options.config !== undefined) {
    persistenceOptions.config = options.config;
  }
  if (options.database !== undefined) {
    persistenceOptions.database = options.database;
  }
  if (options.now !== undefined) {
    persistenceOptions.now = options.now;
  }
  if (options.openDatabase !== undefined) {
    persistenceOptions.openDatabase = options.openDatabase;
  }
  return persistenceOptions;
}

function storeOptionsFrom(
  options: RuntimeMemoryRuntimeIntegrationOptions,
): RuntimeMemoryStoreOptions {
  const storeOptions: RuntimeMemoryStoreOptions = {};
  if (options.maxEpisodes !== undefined) {
    storeOptions.maxEpisodes = options.maxEpisodes;
  }
  if (options.maxFacts !== undefined) {
    storeOptions.maxFacts = options.maxFacts;
  }
  if (options.maxInvalidations !== undefined) {
    storeOptions.maxInvalidations = options.maxInvalidations;
  }
  if (options.evictionPolicy !== undefined) {
    storeOptions.evictionPolicy = options.evictionPolicy;
  }
  return storeOptions;
}

function disabledMigrationResult(): RuntimeMemoryPersistenceMigrationResult {
  return {
    status: "skipped",
    reason: "flag_disabled",
    migrated: false,
  };
}

function disabledWriteResult<T>(): RuntimeMemoryPersistenceWriteResult<T> {
  return {
    status: "skipped",
    reason: "flag_disabled",
    persisted: false,
  };
}

function buildSupersedeInvalidation(
  supersededFactId: string,
  candidate: RuntimeMemoryTemporalFactCandidate,
  reason: RuntimeMemoryInvalidationReason = "superseded",
): RuntimeMemoryInvalidationProposal {
  return {
    schemaVersion: 1,
    invalidationId: `${supersededFactId}-${reason}-by-${candidate.factId}`,
    factId: supersededFactId,
    reason,
    invalid_at: candidate.proposedAt,
    reference_time: candidate.reference_time,
    proposedBy: "deterministic_rule",
    verificationStatus: "deterministic_rule",
    sourceEpisodeRefs: candidate.sourceEpisodeRefs,
    evidenceRefs: candidate.evidenceRefs,
    replacementFactId: candidate.factId,
  };
}

function buildDeleteInvalidation(
  targetFactId: string,
  reason: RuntimeMemoryInvalidationReason,
  candidate: RuntimeMemoryTemporalFactCandidate,
): RuntimeMemoryInvalidationProposal {
  return {
    schemaVersion: 1,
    invalidationId: `${targetFactId}-deleted-by-${candidate.factId}`,
    factId: targetFactId,
    reason,
    invalid_at: candidate.proposedAt,
    reference_time: candidate.reference_time,
    proposedBy: "deterministic_rule",
    verificationStatus: "deterministic_rule",
    sourceEpisodeRefs: candidate.sourceEpisodeRefs,
    evidenceRefs: candidate.evidenceRefs,
  };
}
