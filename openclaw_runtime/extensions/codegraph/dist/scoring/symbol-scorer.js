"use strict";
/**
 * Symbol Importance Scorer
 *
 * Computes per-symbol importance (0..1) based on graph analytics:
 * - Reference count (inbound references)
 * - Caller depth (max BFS depth of callers)
 * - Hub score (PageRank on call graph)
 * - Business proximity (inverse distance from nearest entry point)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SymbolScorer = void 0;
const REFERENCE_WEIGHT = 0.30;
const CALLER_DEPTH_WEIGHT = 0.15;
const HUB_SCORE_WEIGHT = 0.25;
const BUSINESS_PROXIMITY_WEIGHT = 0.30;
const HUB_ITERATIONS = 20;
const HUB_DAMPING = 0.85;
class SymbolScorer {
    queries;
    options;
    entryPointIds = new Set();
    constructor(queries, options = {}) {
        this.queries = queries;
        this.options = {
            referenceWeight: options.referenceWeight ?? REFERENCE_WEIGHT,
            callerDepthWeight: options.callerDepthWeight ?? CALLER_DEPTH_WEIGHT,
            hubScoreWeight: options.hubScoreWeight ?? HUB_SCORE_WEIGHT,
            businessProximityWeight: options.businessProximityWeight ?? BUSINESS_PROXIMITY_WEIGHT,
            hubIterations: options.hubIterations ?? HUB_ITERATIONS,
            hubDamping: options.hubDamping ?? HUB_DAMPING,
            maxCallerDepth: options.maxCallerDepth ?? 10,
        };
    }
    setEntryPointIds(ids) {
        this.entryPointIds = ids;
    }
    computeSymbolImportance(symbolId) {
        const node = this.queries.getNodeById(symbolId);
        if (!node) {
            return {
                symbolId,
                qualifiedName: 'unknown',
                importance: 0,
                factors: { referenceCount: 0, callerDepth: 0, importFrequency: 0, hubScore: 0, businessProximity: 0 },
                computedAt: Date.now(),
            };
        }
        const factors = this.computeFactors(symbolId);
        const importance = this.normalizeImportance(factors);
        return {
            symbolId,
            qualifiedName: node.qualifiedName,
            importance,
            factors,
            computedAt: Date.now(),
        };
    }
    computeAllSymbols(onProgress) {
        const allNodes = this.queries.getAllScorableNodes();
        const results = new Map();
        const hubScores = this.computeHubScores(allNodes.map((n) => n.id));
        const maxRefCount = Math.max(1, ...allNodes.map((n) => this.countReferences(n.id)));
        const maxImportFreq = Math.max(1, ...allNodes.map((n) => this.countImportFrequency(n.id)));
        let processed = 0;
        for (const node of allNodes) {
            const factors = this.computeFactorsForNode(node.id, node.kind, hubScores, maxRefCount, maxImportFreq);
            const importance = this.normalizeImportance(factors);
            results.set(node.id, {
                symbolId: node.id,
                qualifiedName: node.qualifiedName,
                importance,
                factors,
                computedAt: Date.now(),
            });
            processed++;
            onProgress?.(processed, allNodes.length);
        }
        return results;
    }
    computeImportanceForIDs(symbolIds) {
        const results = new Map();
        for (const id of symbolIds) {
            const imp = this.computeSymbolImportance(id);
            results.set(id, imp);
        }
        return results;
    }
    computeFactors(symbolId) {
        const node = this.queries.getNodeById(symbolId);
        if (!node) {
            return { referenceCount: 0, callerDepth: 0, importFrequency: 0, hubScore: 0, businessProximity: 0 };
        }
        const referenceCount = this.countReferences(symbolId);
        const callerDepth = this.computeCallerDepth(symbolId);
        const importFrequency = this.countImportFrequency(symbolId);
        const hubScore = 0; // computed per-batch via computeHubScores
        const businessProximity = this.computeBusinessProximity(symbolId, node.filePath);
        return {
            referenceCount: Math.min(referenceCount, 100),
            callerDepth: Math.min(callerDepth, this.options.maxCallerDepth),
            importFrequency: Math.min(importFrequency, 50),
            hubScore,
            businessProximity: Math.min(businessProximity, 1),
        };
    }
    computeFactorsForNode(symbolId, _kind, hubScores, maxRefCount, maxImportFreq) {
        const node = this.queries.getNodeById(symbolId);
        if (!node) {
            return { referenceCount: 0, callerDepth: 0, importFrequency: 0, hubScore: 0, businessProximity: 0 };
        }
        const rawRefCount = this.countReferences(symbolId);
        const referenceCount = maxRefCount > 0 ? rawRefCount / maxRefCount : 0;
        const callerDepth = this.computeCallerDepth(symbolId) / this.options.maxCallerDepth;
        const rawImportFreq = this.countImportFrequency(symbolId);
        const importFrequency = maxImportFreq > 0 ? rawImportFreq / maxImportFreq : 0;
        const hubScore = hubScores.get(symbolId) ?? 0;
        const businessProximity = this.computeBusinessProximity(symbolId, node.filePath);
        return { referenceCount, callerDepth, importFrequency, hubScore, businessProximity };
    }
    countReferences(symbolId) {
        try {
            return this.queries.countIncomingRefs(symbolId);
        }
        catch {
            return 0;
        }
    }
    countImportFrequency(symbolId) {
        try {
            return this.queries.countImportFrequency(symbolId);
        }
        catch {
            return 0;
        }
    }
    computeCallerDepth(symbolId) {
        const visited = new Set();
        const queue = [{ id: symbolId, depth: 0 }];
        let maxDepth = 0;
        while (queue.length > 0) {
            const current = queue.shift();
            if (current.depth > this.options.maxCallerDepth)
                continue;
            if (visited.has(current.id))
                continue;
            visited.add(current.id);
            maxDepth = Math.max(maxDepth, current.depth);
            const callers = this.queries.getDirectCallers(current.id);
            for (const caller of callers) {
                if (!visited.has(caller.id)) {
                    queue.push({ id: caller.id, depth: current.depth + 1 });
                }
            }
        }
        return maxDepth;
    }
    computeBusinessProximity(symbolId, _filePath) {
        if (this.entryPointIds.size === 0)
            return 0;
        if (this.entryPointIds.has(symbolId))
            return 1.0;
        // BFS from symbol to nearest entry point
        const visited = new Set();
        const queue = [{ id: symbolId, depth: 0 }];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current.depth > 6)
                return 0; // too far, not business-relevant
            if (visited.has(current.id))
                continue;
            visited.add(current.id);
            if (this.entryPointIds.has(current.id)) {
                return Math.max(0, 1.0 - current.depth * 0.15);
            }
            const callees = this.queries.getDirectCallees(current.id);
            for (const callee of callees) {
                if (!visited.has(callee.id)) {
                    queue.push({ id: callee.id, depth: current.depth + 1 });
                }
            }
        }
        return 0;
    }
    computeHubScores(nodeIds) {
        const scores = new Map();
        const N = nodeIds.length;
        if (N === 0)
            return scores;
        const initialValue = 1.0 / N;
        for (const id of nodeIds) {
            scores.set(id, initialValue);
        }
        const outLinks = new Map();
        const inLinks = new Map();
        for (const id of nodeIds) {
            const callees = this.queries.getDirectCallees(id).map((n) => n.id);
            outLinks.set(id, callees.filter((cid) => scores.has(cid)));
            if (!inLinks.has(id))
                inLinks.set(id, []);
            const itsCallers = this.queries.getDirectCallers(id);
            for (const caller of itsCallers) {
                if (scores.has(caller.id)) {
                    if (!inLinks.has(id))
                        inLinks.set(id, []);
                    inLinks.get(id).push(caller.id);
                }
            }
        }
        for (let iter = 0; iter < this.options.hubIterations; iter++) {
            const newScores = new Map();
            let danglingSum = 0;
            for (const id of nodeIds) {
                const linked = outLinks.get(id);
                if (!linked || linked.length === 0) {
                    danglingSum += scores.get(id) ?? 0;
                }
            }
            for (const id of nodeIds) {
                const incoming = inLinks.get(id) ?? [];
                let rank = 0;
                for (const inId of incoming) {
                    const out = outLinks.get(inId) ?? [];
                    if (out.length > 0) {
                        rank += (scores.get(inId) ?? 0) / out.length;
                    }
                }
                rank = (1 - this.options.hubDamping) / N + this.options.hubDamping * (rank + danglingSum / N);
                newScores.set(id, rank);
            }
            for (const [id, score] of newScores) {
                scores.set(id, score);
            }
        }
        // Normalize to [0, 1]
        const allScores = Array.from(scores.values());
        const maxScore = Math.max(...allScores, Number.MIN_VALUE);
        const minScore = Math.min(...allScores, 0);
        const range = maxScore - minScore || 1;
        for (const [id, score] of scores) {
            scores.set(id, (score - minScore) / range);
        }
        return scores;
    }
    normalizeImportance(factors) {
        const raw = factors.referenceCount * this.options.referenceWeight +
            factors.callerDepth * this.options.callerDepthWeight +
            factors.hubScore * this.options.hubScoreWeight +
            factors.businessProximity * this.options.businessProximityWeight;
        return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
    }
}
exports.SymbolScorer = SymbolScorer;
//# sourceMappingURL=symbol-scorer.js.map