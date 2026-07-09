// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { randomUUID } from 'node:crypto';

import { shadowSafetyBoundary } from './shadow-safety-boundary-adapter.js';
import type {
  GateAuthority,
  GateChecker,
  GateCheckerResult,
  GateCheckRequest,
  GateDecision,
  GateType,
} from './types.js';

type GateEngineConfig = {
  defaultAuthority: GateAuthority;
  authorityOverrides: Record<string, GateAuthority>;
  samplingRate: number;
  mandatoryGateTypes: readonly GateType[];
};

type GateEngineConfigUpdate = Partial<GateEngineConfig>;

const DEFAULT_CONFIG: GateEngineConfig = {
  defaultAuthority: 'diagnostic_only',
  authorityOverrides: {},
  samplingRate: 0.1,
  mandatoryGateTypes: ['destructive_op', 'pre_mutation'],
};

const config: GateEngineConfig = {
  defaultAuthority: DEFAULT_CONFIG.defaultAuthority,
  authorityOverrides: { ...DEFAULT_CONFIG.authorityOverrides },
  samplingRate: DEFAULT_CONFIG.samplingRate,
  mandatoryGateTypes: DEFAULT_CONFIG.mandatoryGateTypes.slice(),
};

class GateEngine {
  private readonly checkers = new Map<string, GateChecker>();
  private readonly decisions = new Map<string, GateDecision>();

  registerChecker(checker: GateChecker): void {
    shadowSafetyBoundary.execute('gate-engine.register-checker', () => {
      this.checkers.set(checker.checkerId, checker);
    });
  }

  unregisterChecker(checkerId: string): void {
    shadowSafetyBoundary.execute('gate-engine.unregister-checker', () => {
      this.checkers.delete(checkerId);
    });
  }

  configure(update: GateEngineConfigUpdate): void {
    shadowSafetyBoundary.execute('gate-engine.configure', () => {
      if (update.defaultAuthority) {
        config.defaultAuthority = update.defaultAuthority;
      }
      if (update.authorityOverrides) {
        config.authorityOverrides = { ...update.authorityOverrides };
      }
      if (update.samplingRate !== undefined) {
        config.samplingRate = update.samplingRate;
      }
      if (update.mandatoryGateTypes) {
        config.mandatoryGateTypes = update.mandatoryGateTypes.slice();
      }
    });
  }

  resetConfig(): void {
    shadowSafetyBoundary.execute('gate-engine.reset-config', () => {
      config.defaultAuthority = DEFAULT_CONFIG.defaultAuthority;
      config.authorityOverrides = { ...DEFAULT_CONFIG.authorityOverrides };
      config.samplingRate = DEFAULT_CONFIG.samplingRate;
      config.mandatoryGateTypes = DEFAULT_CONFIG.mandatoryGateTypes.slice();
    });
  }

  async check(request: GateCheckRequest): Promise<GateDecision> {
    const gateId = request.gateId ?? randomUUID();
    const mandatory = config.mandatoryGateTypes.includes(request.gateType);
    const sampled = mandatory || Math.random() < config.samplingRate;
    const authority = config.authorityOverrides[request.gateType] ?? config.defaultAuthority;

    if (!sampled) {
      const decision: GateDecision = {
        gateId,
        gateType: request.gateType,
        entityId: request.entityId,
        entityType: request.entityType,
        authority,
        status: 'deferred',
        sampled,
        mandatory,
        checkerResults: [],
        errors: [],
        createdAt: Date.now(),
        metadata: request.metadata,
      };
      this.storeDecision(decision);
      return decision;
    }

    const checkerResults: GateCheckerResult[] = [];
    const errors: string[] = [];
    const relevantCheckers = Array.from(this.checkers.values()).filter((checker) => {
      return !checker.gateTypes || checker.gateTypes.includes(request.gateType);
    });

    for (const checker of relevantCheckers) {
      const result = await shadowSafetyBoundary.executeAsync('gate-engine.checker', async () => {
        return checker.check(request);
      });
      if (result) {
        checkerResults.push(result);
      } else {
        errors.push(`Checker failed or was swallowed: ${checker.checkerId}`);
      }
    }

    const anyFailed = checkerResults.some((result) => !result.passed);
    const status = authority === 'diagnostic_only' ? 'approved' : anyFailed ? 'blocked' : 'approved';
    const decision: GateDecision = {
      gateId,
      gateType: request.gateType,
      entityId: request.entityId,
      entityType: request.entityType,
      authority,
      status,
      sampled,
      mandatory,
      checkerResults,
      errors,
      createdAt: Date.now(),
      metadata: request.metadata,
    };

    this.storeDecision(decision);
    return decision;
  }

  getDecision(gateId: string): GateDecision | undefined {
    return this.decisions.get(gateId);
  }

  getConfig(): GateEngineConfig {
    return {
      defaultAuthority: config.defaultAuthority,
      authorityOverrides: { ...config.authorityOverrides },
      samplingRate: config.samplingRate,
      mandatoryGateTypes: config.mandatoryGateTypes.slice(),
    };
  }

  private storeDecision(decision: GateDecision): void {
    shadowSafetyBoundary.execute('gate-engine.store-decision', () => {
      this.decisions.set(decision.gateId, decision);
    });
  }
}

export const gateEngine = new GateEngine();
