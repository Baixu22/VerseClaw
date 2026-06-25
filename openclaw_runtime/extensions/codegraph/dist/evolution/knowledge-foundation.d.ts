/**
 * Knowledge Graph & Vector Retrieval Foundations
 *
 * Future integration points for:
 * - Neo4j / RDF triple store export
 * - Local embedding-based semantic search
 * - OpenTelemetry runtime tracing bridge
 * - PR/Issue analysis
 */
import { Node, Edge } from '../types';
export interface Triple {
    subject: string;
    predicate: string;
    object: string;
    graph?: string;
}
export interface GraphExportOptions {
    format: 'rdf' | 'neo4j-cypher' | 'graphml';
    includeNodeBodies?: boolean;
    maxEdges?: number;
}
export interface CodeEmbedding {
    symbolId: string;
    vector: Float32Array;
    dimensions: number;
    model: string;
    computedAt: number;
}
export interface VectorSearchResult {
    symbolId: string;
    similarity: number;
    rank: number;
}
export interface TraceSpan {
    spanId: string;
    traceId: string;
    operationName: string;
    serviceName: string;
    startTime: number;
    duration: number;
    parentSpanId?: string;
    attributes: Record<string, string>;
}
export interface RuntimeCallEdge {
    sourceSymbol: string;
    targetSymbol: string;
    callCount: number;
    avgDuration: number;
    p99Duration: number;
    errorRate: number;
    spans: TraceSpan[];
}
export interface PrAnalysisResult {
    prNumber: number;
    title: string;
    changedFiles: string[];
    affectedSymbols: string[];
    riskAssessment: 'low' | 'medium' | 'high';
    suggestedTests: string[];
}
export interface IssueAnalysisResult {
    issueNumber: number;
    title: string;
    mentionedFiles: string[];
    mentionedSymbols: string[];
    relatedPRs: number[];
}
/**
 * Knowledge graph exporter.
 * Future: converts CodeGraph nodes/edges to RDF triples or Neo4j Cypher.
 */
export declare class KnowledgeGraphExporter {
    exportAsTriples(nodes: Node[], edges: Edge[], _options?: GraphExportOptions): Triple[];
    exportAsNeo4jCypher(nodes: Node[], edges: Edge[], _options?: GraphExportOptions): string[];
}
/**
 * Vector retrieval foundation.
 * Future: integrates with local embedding model for semantic code search.
 */
export declare class VectorRetriever {
    private embeddings;
    addEmbedding(embedding: CodeEmbedding): void;
    search(queryVector: Float32Array, topK?: number): VectorSearchResult[];
    size(): number;
    clear(): void;
    private cosineSimilarity;
}
/**
 * PR/Issue analysis foundation.
 * Future: connects GitHub/GitLab APIs to map PRs/issues to code symbols.
 */
export declare class ChangeAnalysisBridge {
    analyzeChanges(changedFiles: string[], _previousGraph?: {
        nodes: Node[];
        edges: Edge[];
    }, _currentGraph?: {
        nodes: Node[];
        edges: Edge[];
    }): PrAnalysisResult;
    linkIssueToSymbols(_issueBody: string, _symbolNames: string[]): IssueAnalysisResult;
}
export declare const knowledgeGraphExporter: KnowledgeGraphExporter;
export declare const vectorRetriever: VectorRetriever;
export declare const changeAnalysisBridge: ChangeAnalysisBridge;
//# sourceMappingURL=knowledge-foundation.d.ts.map