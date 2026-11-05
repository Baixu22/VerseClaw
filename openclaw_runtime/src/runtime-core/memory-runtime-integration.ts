import {
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  isRuntimeMemoryAcceptedVerificationStatus,
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

type CurationWriteFailure = Extract<RuntimeMemoryPersistenceWriteResult<unknown> | RuntimeMemoryPersistenceRelationResult, { persisted: false }>;

export type RuntimeMemoryFactWriteResult =
  | RuntimeMemoryPersistenceWriteResult<RuntimeMemoryQueryableFact>
  | CurationWriteFailure
  | { status: "applied" | "already_applied"; action: "DELETE"; persisted: true; factId: string };

class CurationWriteAborted extends Error {
  constructor(readonly result: CurationWriteFailure) {
    super(result.status === "rejected" ? result.message : `persistence skipped (${result.reason})`);
  }
}

function requirePersisted(result: RuntimeMemoryFactWriteResult | RuntimeMemoryPersistenceWriteResult<RuntimeMemoryInvalidationProposal> | RuntimeMemoryPersistenceRelationResult): void {
  if (result.status === "persisted") return;
  if (result.status === "skipped" || result.status === "rejected") throw new CurationWriteAborted(result);
  throw new Error("Curation deleted a fact instead of appending its replacement.");
}

export type RuntimeMemoryRuntimeIntegrationPort = {
  /** Required for multi-write mutations; missing support rejects before effects. */
  runAtomic?<T>(operation: () => T): T;
  migrate(): RuntimeMemoryPersistenceMigrationResult;
  appendEpisode(
    episode: RuntimeMemoryEpisodeRecord,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryEpisodeRecord>;
  appendFact(
    fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate,
  ): RuntimeMemoryFactWriteResult;
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
  ): RuntimeMemoryFactWriteResult {
    if (!this.persistEnabled()) {
      return disabledWriteResult();
    }

    // AUDN curation only applies to incoming candidates. Already-verified
    // facts bypass curation (they were curated at proposal time).
    if (!this.#curationEnabled || !isRuntimeMemoryTemporalFactCandidate(fact)) {
      return this.#persistence.appendFact(fact);
    }

    try {
      return this.runAtomic(() => this.appendFactWithCuration(fact));
    } catch (error) {
      if (error instanceof CurationWriteAborted) return error.result;
      throw error;
    }
  }

  runAtomic<T>(operation: () => T): T {
    if (!this.persistEnabled()) throw new Error("persistence skipped (flag_disabled)");
    if (!this.#persistence.runAtomic) throw new Error("Atomic memory persistence is unsupported; no writes performed.");
    return this.#persistence.runAtomic(operation);
  }

  private appendFactWithCuration(
    candidate: RuntimeMemoryTemporalFactCandidate,
  ): RuntimeMemoryFactWriteResult {
    const loadResult = this.#persistence.loadStore();
    if (loadResult.status === "skipped") {
      throw new CurationWriteAborted({ status: "skipped", reason: loadResult.reason, persisted: false });
    }
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

      case "UPDATE":
      case "SUPERSEDE": {
        const invalidation = buildSupersedeInvalidation(
          decision.supersedes,
          candidate,
          decision.action === "SUPERSEDE" ? "contradicted" : "superseded",
        );
        requirePersisted(this.#persistence.invalidateFact(invalidation));
        const appendResult = this.#persistence.appendFact(candidate);
        requirePersisted(appendResult);
        requirePersisted(this.#persistence.persistRelation({
            sourceFactId: candidate.factId,
            targetFactId: decision.supersedes,
            relationType: "supersedes",
            confidence: decision.action === "SUPERSEDE" ? 1.0 : 0.9,
          }));
        if (decision.action === "SUPERSEDE") {
          requirePersisted(this.#persistence.persistRelation({
            sourceFactId: candidate.factId,
            targetFactId: decision.supersedes,
            relationType: "contradicts",
            confidence: 0.8,
          }));
        }
        return appendResult;
      }

      case "DELETE": {
        const alreadyInvalid = store.listInvalidations().some(value =>
          value.factId === decision.targetFactId && isRuntimeMemoryAcceptedVerificationStatus(value.verificationStatus)
          && value.invalid_at <= candidate.proposedAt);
        const fact = store.getFactById(decision.targetFactId);
        if (!fact) {
          return { status: "rejected", reason: "invalid_fact", message: `DELETE target not found: ${decision.targetFactId}.`, persisted: false };
        }
        if (alreadyInvalid || (fact?.invalid_at !== undefined && fact.invalid_at <= candidate.proposedAt)) {
          return { status: "already_applied", action: "DELETE", factId: decision.targetFactId, persisted: true };
        }
        const invalidation = buildDeleteInvalidation(
          decision.targetFactId,
          decision.reason,
          candidate,
        );
        requirePersisted(this.#persistence.invalidateFact(invalidation));
        // DELETE appends no new fact; the target was invalidated above.
        return {
          status: "applied",
          action: "DELETE",
          factId: decision.targetFactId,
          persisted: true,
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
