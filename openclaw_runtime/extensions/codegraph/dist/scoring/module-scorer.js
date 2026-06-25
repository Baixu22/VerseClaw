"use strict";
/**
 * Module Importance Scorer
 *
 * Aggregates symbol-level importance scores into module (file/directory) level.
 * Helps agents prioritize which files to read first.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModuleScorer = void 0;
class ModuleScorer {
    queries;
    symbolScorer;
    constructor(queries, symbolScorer) {
        this.queries = queries;
        this.symbolScorer = symbolScorer;
    }
    computeModuleImportance(modulePath, symbolScores) {
        const nodeMap = this.getModuleSymbols(modulePath);
        const allScores = symbolScores ?? this.symbolScorer.computeImportanceForIDs(Array.from(nodeMap.keys()));
        const scores = [];
        let totalImportance = 0;
        for (const [id] of nodeMap) {
            const score = allScores.get(id);
            if (score) {
                scores.push(score);
                totalImportance += score.importance;
            }
        }
        const count = scores.length || 1;
        const avgImportance = totalImportance / count;
        // Boost for files containing high-importance symbols
        const maxImportance = scores.length > 0 ? Math.max(...scores.map((s) => s.importance)) : 0;
        const importance = Math.round((avgImportance * 0.6 + maxImportance * 0.4) * 100) / 100;
        const topSymbols = scores
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 15);
        const isEntryPoint = this.isModuleEntryPoint(modulePath);
        return {
            modulePath,
            importance,
            topSymbols,
            symbolCount: nodeMap.size,
            isEntryPointModule: isEntryPoint,
            computedAt: Date.now(),
        };
    }
    computeAllModules(onProgress) {
        const allFiles = this.queries.getAllFiles();
        const results = new Map();
        // Compute all symbol scores first (one pass)
        const allScorable = this.queries.getAllScorableNodes();
        const symbolScores = this.symbolScorer.computeImportanceForIDs(allScorable.map((n) => n.id));
        let processed = 0;
        for (const file of allFiles) {
            const moduleImp = this.computeModuleImportance(file.path, symbolScores);
            results.set(file.path, moduleImp);
            processed++;
            onProgress?.(processed, allFiles.length);
        }
        return results;
    }
    getTopModules(topN, onProgress) {
        const allModules = this.computeAllModules(onProgress);
        return Array.from(allModules.values())
            .sort((a, b) => b.importance - a.importance)
            .slice(0, topN);
    }
    getModulesByImportance(threshold, onProgress) {
        const allModules = this.computeAllModules(onProgress);
        return Array.from(allModules.values())
            .filter((m) => m.importance >= threshold)
            .sort((a, b) => b.importance - a.importance);
    }
    getModuleSymbols(filePath) {
        const nodes = this.queries.getNodesByFile(filePath);
        const scorable = new Map();
        for (const node of nodes) {
            if (this.isScorableKind(node.kind)) {
                scorable.set(node.id, node);
            }
        }
        return scorable;
    }
    isScorableKind(kind) {
        return ['function', 'method', 'class', 'struct', 'interface', 'trait', 'protocol', 'enum', 'variable', 'constant', 'route', 'component', 'entry_point'].includes(kind);
    }
    isModuleEntryPoint(filePath) {
        try {
            const nodes = this.queries.getNodesByFile(filePath);
            return nodes.some((n) => n.kind === 'entry_point');
        }
        catch {
            return false;
        }
    }
}
exports.ModuleScorer = ModuleScorer;
//# sourceMappingURL=module-scorer.js.map