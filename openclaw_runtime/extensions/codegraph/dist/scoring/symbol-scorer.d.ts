/**
 * Symbol Importance Scorer
 *
 * Computes per-symbol importance (0..1) based on graph analytics:
 * - Reference count (inbound references)
 * - Caller depth (max BFS depth of callers)
 * - Hub score (PageRank on call graph)
 * - Business proximity (inverse distance from nearest entry point)
 */
import { SymbolImportance } from '../types';
import { QueryBuilder } from '../db/queries';
export interface ScorerOptions {
    referenceWeight?: number;
    callerDepthWeight?: number;
    hubScoreWeight?: number;
    businessProximityWeight?: number;
    hubIterations?: number;
    hubDamping?: number;
    maxCallerDepth?: number;
}
export declare class SymbolScorer {
    private queries;
    private options;
    private entryPointIds;
    constructor(queries: QueryBuilder, options?: ScorerOptions);
    setEntryPointIds(ids: Set<string>): void;
    computeSymbolImportance(symbolId: string): SymbolImportance;
    computeAllSymbols(onProgress?: (current: number, total: number) => void): Map<string, SymbolImportance>;
    computeImportanceForIDs(symbolIds: string[]): Map<string, SymbolImportance>;
    private computeFactors;
    private computeFactorsForNode;
    private countReferences;
    private countImportFrequency;
    private computeCallerDepth;
    private computeBusinessProximity;
    private computeHubScores;
    private normalizeImportance;
}
//# sourceMappingURL=symbol-scorer.d.ts.map