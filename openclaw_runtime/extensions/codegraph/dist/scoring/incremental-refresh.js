"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IncrementalRefreshManager = void 0;
const score_cache_1 = require("../scoring/score-cache");
class IncrementalRefreshManager {
    queries;
    symbolScorer;
    moduleScorer;
    scoreCache;
    entryPointDetector;
    tagger;
    compressor;
    constructor(queries, symbolScorer, moduleScorer, entryPointDetector, tagger, compressor) {
        this.queries = queries;
        this.symbolScorer = symbolScorer;
        this.moduleScorer = moduleScorer;
        this.scoreCache = new score_cache_1.ScoreCache(queries, symbolScorer, moduleScorer);
        this.entryPointDetector = entryPointDetector;
        this.tagger = tagger;
        this.compressor = compressor;
    }
    /** Full analysis: compute everything from scratch */
    fullRefresh(onProgress) {
        const startTime = Date.now();
        try {
            // 1. Score all symbols
            onProgress?.('scoring', 0, 1);
            const allScores = this.symbolScorer.computeAllSymbols();
            this.scoreCache.persistScores(allScores);
            // 2. Module scores
            onProgress?.('modules', 0, 1);
            const allModules = this.moduleScorer.computeAllModules();
            // 3. Summaries (lazy — only top modules)
            onProgress?.('summaries', 0, 1);
            let summariesRefreshed = 0;
            for (const [modulePath] of allModules) {
                this.compressor.generateModuleSummary(modulePath);
                summariesRefreshed++;
            }
            // 4. Tags
            onProgress?.('tags', 0, 1);
            const tags = this.tagger.tagAll();
            // 5. Entry points
            onProgress?.('entrypoints', 0, 1);
            this.entryPointDetector.detectAll();
            return {
                filesAffected: allModules.size,
                scoresRefreshed: allScores.size,
                summariesRefreshed,
                tagsRefreshed: tags.size,
                entryPointsRefreshed: true,
                durationMs: Date.now() - startTime,
            };
        }
        catch (err) {
            return {
                filesAffected: 0,
                scoresRefreshed: 0,
                summariesRefreshed: 0,
                tagsRefreshed: 0,
                entryPointsRefreshed: false,
                durationMs: Date.now() - startTime,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    /** Incremental refresh: only update changed files */
    incrementalRefresh(changedFilePaths, _onProgress) {
        const startTime = Date.now();
        if (changedFilePaths.length === 0) {
            return {
                filesAffected: 0,
                scoresRefreshed: 0,
                summariesRefreshed: 0,
                tagsRefreshed: 0,
                entryPointsRefreshed: false,
                durationMs: Date.now() - startTime,
            };
        }
        try {
            // 1. Incremental scores for changed files + neighbors
            const scoreResult = this.scoreCache.updateForFiles(changedFilePaths);
            // 2. Summaries for changed files only
            let summariesRefreshed = 0;
            for (const filePath of changedFilePaths.slice(0, 100)) {
                this.compressor.generateModuleSummary(filePath);
                summariesRefreshed++;
            }
            // 3. Tags for changed modules
            let tagsRefreshed = 0;
            for (const filePath of changedFilePaths.slice(0, 200)) {
                const assignment = this.tagger.tagModule(filePath);
                if (assignment.tags.length > 0)
                    tagsRefreshed++;
            }
            // 4. Entry points: only re-check if route/controller files changed
            const needsEntryPointRefresh = changedFilePaths.some((f) => /controller|route|handler|main|cmd|cli/i.test(f) ||
                /urls\.py|routes\./i.test(f));
            if (needsEntryPointRefresh) {
                this.entryPointDetector.detectAll();
            }
            return {
                filesAffected: changedFilePaths.length,
                scoresRefreshed: scoreResult.updatedSymbols,
                summariesRefreshed,
                tagsRefreshed,
                entryPointsRefreshed: needsEntryPointRefresh,
                durationMs: Date.now() - startTime,
            };
        }
        catch (err) {
            return {
                filesAffected: changedFilePaths.length,
                scoresRefreshed: 0,
                summariesRefreshed: 0,
                tagsRefreshed: 0,
                entryPointsRefreshed: false,
                durationMs: Date.now() - startTime,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    /** Get current freshness state for agent reporting */
    getFreshnessState() {
        const allFiles = this.queries.getAllFiles();
        const lastCompute = this.scoreCache.getLastComputeTime();
        let freshCount = 0;
        let staleCount = 0;
        // Quick sample check (first 200 files)
        for (const file of allFiles.slice(0, 200)) {
            const nodes = this.queries.getNodesByFile(file.path);
            const topNode = nodes[0];
            if (topNode && this.scoreCache.isFresh(topNode.id)) {
                freshCount++;
            }
            else {
                staleCount++;
            }
        }
        // Estimate for total
        const ratio = allFiles.length > 0 ? freshCount / Math.min(200, allFiles.length) : 0;
        return {
            totalFiles: allFiles.length,
            filesWithFreshScores: Math.round(ratio * allFiles.length),
            filesWithStaleScores: Math.round((1 - ratio) * allFiles.length),
            lastAnalysisAt: lastCompute,
            isDaemonRunning: true,
            pendingSyncCount: 0,
        };
    }
    /** True if data is fresh enough for agent to trust without re-reading */
    isDataFresh() {
        const lastCompute = this.scoreCache.getLastComputeTime();
        if (!lastCompute)
            return false;
        // Fresh if computed within last 10 minutes
        return (Date.now() - lastCompute) < 10 * 60 * 1000;
    }
    getScoreCache() {
        return this.scoreCache;
    }
}
exports.IncrementalRefreshManager = IncrementalRefreshManager;
//# sourceMappingURL=incremental-refresh.js.map