"use strict";
/**
 * Score Cache — persisted symbol/module importance scores
 *
 * Stores computed scores in SQLite so they survive daemon restarts.
 * Supports incremental update: when a file changes, only re-score
 * symbols in that file and their direct graph neighbors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoreCache = void 0;
const SCORE_TTL_MS = 5 * 60 * 1000; // 5 minutes — auto-refresh old scores
class ScoreCache {
    queries;
    symbolScorer;
    moduleScorer;
    constructor(queries, symbolScorer, moduleScorer) {
        this.queries = queries;
        this.symbolScorer = symbolScorer;
        this.moduleScorer = moduleScorer;
    }
    /** Persist scores to DB for fast restart (via metadata store) */
    persistScores(scores) {
        const now = Date.now();
        // Batch persist via metadata for atomicity
        for (const [id, score] of scores) {
            try {
                this.queries.setMetadata(`score_${id}`, JSON.stringify({
                    i: score.importance,
                    rc: score.factors.referenceCount,
                    cd: score.factors.callerDepth,
                    ifr: score.factors.importFrequency,
                    hs: score.factors.hubScore,
                    bp: score.factors.businessProximity,
                    ts: now,
                }));
            }
            catch {
                // Best-effort — scores are recomputable
            }
        }
    }
    /** Load scores from DB */
    loadScores() {
        const results = new Map();
        const rows = this.queries.getRawRows('SELECT symbol_id, importance, reference_count, caller_depth, hub_score, business_proximity, computed_at FROM symbol_scores');
        for (const row of rows) {
            results.set(row.symbol_id, {
                symbolId: row.symbol_id,
                qualifiedName: '',
                importance: row.importance,
                factors: {
                    referenceCount: row.reference_count,
                    callerDepth: row.caller_depth,
                    importFrequency: 0,
                    hubScore: row.hub_score,
                    businessProximity: row.business_proximity,
                },
                computedAt: row.computed_at,
            });
        }
        return results;
    }
    /** Incrementally update scores for changed files */
    updateForFiles(changedFilePaths) {
        const startTime = Date.now();
        const affectedSymbolIds = new Set();
        // Collect symbols in changed files
        for (const filePath of changedFilePaths) {
            const nodes = this.queries.getNodesByFile(filePath);
            for (const node of nodes) {
                affectedSymbolIds.add(node.id);
            }
            // Also include direct callers/callees (their scores may shift)
            for (const node of nodes) {
                const callers = this.queries.getDirectCallers(node.id);
                const callees = this.queries.getDirectCallees(node.id);
                for (const c of callers)
                    affectedSymbolIds.add(c.id);
                for (const c of callees)
                    affectedSymbolIds.add(c.id);
            }
        }
        // Re-score affected symbols
        const newScores = this.symbolScorer.computeImportanceForIDs(Array.from(affectedSymbolIds).slice(0, 5000));
        // Persist
        this.persistScores(newScores);
        // Re-score affected modules
        const affectedModules = new Set(changedFilePaths);
        for (const [id] of newScores) {
            const node = this.queries.getNodeById(id);
            if (node)
                affectedModules.add(node.filePath);
        }
        for (const modulePath of affectedModules) {
            this.moduleScorer.computeModuleImportance(modulePath, newScores);
        }
        return {
            updatedSymbols: newScores.size,
            updatedModules: affectedModules.size,
            durationMs: Date.now() - startTime,
        };
    }
    /** Check if scores are fresh enough */
    isFresh(symbolId) {
        const rows = this.queries.getRawRows('SELECT value FROM project_metadata WHERE key = ?', [`score_${symbolId}`]);
        if (rows.length === 0)
            return false;
        try {
            const parsed = JSON.parse(rows[0]?.value);
            return (Date.now() - (parsed.ts ?? 0)) < SCORE_TTL_MS;
        }
        catch {
            return false;
        }
    }
    /** Get the freshest computation timestamp */
    getLastComputeTime() {
        const rows = this.queries.getRawRows("SELECT MAX(CAST(json_extract(value, '$.ts') AS INTEGER)) as last FROM project_metadata WHERE key LIKE 'score_%'");
        return rows[0]?.last ?? null;
    }
}
exports.ScoreCache = ScoreCache;
//# sourceMappingURL=score-cache.js.map