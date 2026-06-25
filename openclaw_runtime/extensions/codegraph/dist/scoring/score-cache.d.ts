/**
 * Score Cache — persisted symbol/module importance scores
 *
 * Stores computed scores in SQLite so they survive daemon restarts.
 * Supports incremental update: when a file changes, only re-score
 * symbols in that file and their direct graph neighbors.
 */
import { SymbolImportance } from '../types';
import { QueryBuilder } from '../db/queries';
import { SymbolScorer } from '../scoring/symbol-scorer';
import { ModuleScorer } from '../scoring/module-scorer';
export declare class ScoreCache {
    private queries;
    private symbolScorer;
    private moduleScorer;
    constructor(queries: QueryBuilder, symbolScorer: SymbolScorer, moduleScorer: ModuleScorer);
    /** Persist scores to DB for fast restart (via metadata store) */
    persistScores(scores: Map<string, SymbolImportance>): void;
    /** Load scores from DB */
    loadScores(): Map<string, SymbolImportance>;
    /** Incrementally update scores for changed files */
    updateForFiles(changedFilePaths: string[]): {
        updatedSymbols: number;
        updatedModules: number;
        durationMs: number;
    };
    /** Check if scores are fresh enough */
    isFresh(symbolId: string): boolean;
    /** Get the freshest computation timestamp */
    getLastComputeTime(): number | null;
}
//# sourceMappingURL=score-cache.d.ts.map