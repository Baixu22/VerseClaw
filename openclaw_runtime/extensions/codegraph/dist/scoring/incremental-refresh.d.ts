/**
 * Incremental Refresh Manager
 *
 * Orchestrates incremental refresh of all AgentGraph computed data
 * after a sync. Hooks into the file watcher → sync pipeline.
 *
 * Flow:
 *   file change → watcher → sync() → IncrementalRefreshManager.refresh(changedFiles)
 *     ├─ ScoreCache.updateForFiles(changedFiles)
 *     ├─ Module summaries regenerate for changed files
 *     ├─ Entry points re-detect for changed files
 *     ├─ Semantic tags re-compute for changed modules
 *     └─ Flows (deferred: only re-compute on explicit agent query)
 */
import { QueryBuilder } from '../db/queries';
import { SymbolScorer } from '../scoring/symbol-scorer';
import { ModuleScorer } from '../scoring/module-scorer';
import { ScoreCache } from '../scoring/score-cache';
import { EntryPointDetector } from '../analysis/entrypoint-detector';
import { SemanticTagger } from '../semantic/tagger';
import { ContextCompressor } from '../compression/context-compressor';
export interface RefreshResult {
    filesAffected: number;
    scoresRefreshed: number;
    summariesRefreshed: number;
    tagsRefreshed: number;
    entryPointsRefreshed: boolean;
    durationMs: number;
    error?: string;
}
export interface FreshnessState {
    totalFiles: number;
    filesWithFreshScores: number;
    filesWithStaleScores: number;
    lastAnalysisAt: number | null;
    isDaemonRunning: boolean;
    pendingSyncCount: number;
}
export declare class IncrementalRefreshManager {
    private queries;
    private symbolScorer;
    private moduleScorer;
    private scoreCache;
    private entryPointDetector;
    private tagger;
    private compressor;
    constructor(queries: QueryBuilder, symbolScorer: SymbolScorer, moduleScorer: ModuleScorer, entryPointDetector: EntryPointDetector, tagger: SemanticTagger, compressor: ContextCompressor);
    /** Full analysis: compute everything from scratch */
    fullRefresh(onProgress?: (phase: string, current: number, total: number) => void): RefreshResult;
    /** Incremental refresh: only update changed files */
    incrementalRefresh(changedFilePaths: string[], _onProgress?: (phase: string, current: number, total: number) => void): RefreshResult;
    /** Get current freshness state for agent reporting */
    getFreshnessState(): FreshnessState;
    /** True if data is fresh enough for agent to trust without re-reading */
    isDataFresh(): boolean;
    getScoreCache(): ScoreCache;
}
//# sourceMappingURL=incremental-refresh.d.ts.map