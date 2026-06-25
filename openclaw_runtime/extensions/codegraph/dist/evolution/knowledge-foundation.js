"use strict";
/**
 * Knowledge Graph & Vector Retrieval Foundations
 *
 * Future integration points for:
 * - Neo4j / RDF triple store export
 * - Local embedding-based semantic search
 * - OpenTelemetry runtime tracing bridge
 * - PR/Issue analysis
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.changeAnalysisBridge = exports.vectorRetriever = exports.knowledgeGraphExporter = exports.ChangeAnalysisBridge = exports.VectorRetriever = exports.KnowledgeGraphExporter = void 0;
/**
 * Knowledge graph exporter.
 * Future: converts CodeGraph nodes/edges to RDF triples or Neo4j Cypher.
 */
class KnowledgeGraphExporter {
    exportAsTriples(nodes, edges, _options) {
        const triples = [];
        for (const node of nodes) {
            const nodeUri = `<codegraph://${node.id}>`;
            triples.push({ subject: nodeUri, predicate: '<rdf:type>', object: `<codegraph:${node.kind}>` });
            triples.push({ subject: nodeUri, predicate: '<codegraph:name>', object: `"${node.name}"` });
            triples.push({ subject: nodeUri, predicate: '<codegraph:file>', object: `"${node.filePath}"` });
            triples.push({ subject: nodeUri, predicate: '<codegraph:language>', object: `"${node.language}"` });
        }
        for (const edge of edges) {
            const sourceUri = `<codegraph://${edge.source}>`;
            const targetUri = `<codegraph://${edge.target}>`;
            triples.push({ subject: sourceUri, predicate: `<codegraph:${edge.kind}>`, object: targetUri });
        }
        return triples;
    }
    exportAsNeo4jCypher(nodes, edges, _options) {
        const statements = [];
        for (const node of nodes) {
            const escapedName = node.name.replace(/"/g, '\\"');
            const escapedFile = node.filePath.replace(/\\/g, '\\\\');
            statements.push(`CREATE (n:Symbol {id: "${node.id}", kind: "${node.kind}", name: "${escapedName}", file: "${escapedFile}"})`);
        }
        for (const edge of edges) {
            statements.push(`MATCH (a:Symbol {id: "${edge.source}"}), (b:Symbol {id: "${edge.target}"}) CREATE (a)-[:${edge.kind.toUpperCase()} {provenance: "${edge.provenance ?? 'tree-sitter'}"}]->(b)`);
        }
        return statements;
    }
}
exports.KnowledgeGraphExporter = KnowledgeGraphExporter;
/**
 * Vector retrieval foundation.
 * Future: integrates with local embedding model for semantic code search.
 */
class VectorRetriever {
    embeddings = new Map();
    addEmbedding(embedding) {
        this.embeddings.set(embedding.symbolId, embedding);
    }
    search(queryVector, topK = 10) {
        const results = [];
        for (const [id, embedding] of this.embeddings) {
            const similarity = this.cosineSimilarity(queryVector, embedding.vector);
            results.push({ symbolId: id, similarity, rank: 0 });
        }
        results.sort((a, b) => b.similarity - a.similarity);
        for (let i = 0; i < results.length; i++) {
            results[i].rank = i + 1;
        }
        return results.slice(0, topK);
    }
    size() {
        return this.embeddings.size;
    }
    clear() {
        this.embeddings.clear();
    }
    cosineSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
            normA += (a[i] ?? 0) * (a[i] ?? 0);
            normB += (b[i] ?? 0) * (b[i] ?? 0);
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
}
exports.VectorRetriever = VectorRetriever;
/**
 * PR/Issue analysis foundation.
 * Future: connects GitHub/GitLab APIs to map PRs/issues to code symbols.
 */
class ChangeAnalysisBridge {
    analyzeChanges(changedFiles, _previousGraph, _currentGraph) {
        // Foundation: file-level analysis only for now.
        // Future: diff-level symbol change detection.
        return {
            prNumber: 0,
            title: '',
            changedFiles,
            affectedSymbols: [],
            riskAssessment: changedFiles.length > 10 ? 'high' : changedFiles.length > 5 ? 'medium' : 'low',
            suggestedTests: changedFiles
                .filter((f) => f.includes('.test.') || f.includes('test') || f.includes('spec'))
                .slice(0, 20),
        };
    }
    linkIssueToSymbols(_issueBody, _symbolNames) {
        return {
            issueNumber: 0,
            title: '',
            mentionedFiles: [],
            mentionedSymbols: _symbolNames,
            relatedPRs: [],
        };
    }
}
exports.ChangeAnalysisBridge = ChangeAnalysisBridge;
exports.knowledgeGraphExporter = new KnowledgeGraphExporter();
exports.vectorRetriever = new VectorRetriever();
exports.changeAnalysisBridge = new ChangeAnalysisBridge();
//# sourceMappingURL=knowledge-foundation.js.map