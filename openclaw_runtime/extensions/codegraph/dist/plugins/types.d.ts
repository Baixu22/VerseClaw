/**
 * AgentGraph Plugin System
 *
 * Extensibility foundation for third-party plugins.
 * Plugins can hook into:
 * - Indexing lifecycle (pre/post extraction)
 * - Analysis (custom analyzers)
 * - Search (custom search providers)
 * - Graph enrichment (custom edge synthesis)
 */
import { Node, Edge, SearchResult } from '../types';
export interface PluginManifest {
    name: string;
    version: string;
    description?: string;
    author?: string;
}
export type PluginHookPhase = 'preIndex' | 'postExtraction' | 'postResolution' | 'postIndex' | 'preSearch' | 'postSearch' | 'preAnalysis';
export interface PluginContext {
    projectRoot: string;
    dbPath: string;
    phase: PluginHookPhase;
}
export interface PluginAnalyzeInput {
    symbolId: string;
    query?: string;
    options?: Record<string, unknown>;
}
export interface PluginAnalyzeOutput {
    findings: Array<{
        type: string;
        severity: 'info' | 'warning' | 'error';
        message: string;
        location?: {
            file: string;
            line: number;
        };
    }>;
    suggestions: string[];
    metadata?: Record<string, unknown>;
}
export interface PluginSearchInput {
    query: string;
    limit?: number;
}
export interface PluginSearchOutput {
    results: SearchResult[];
    totalFound: number;
}
/**
 * Core plugin interface. Implement this to create an AgentGraph plugin.
 */
export interface AgentGraphPlugin {
    /** Plugin metadata */
    manifest: PluginManifest;
    /** Initialize plugin with project context */
    initialize?(context: PluginContext): Promise<void> | void;
    /** Teardown plugin */
    destroy?(): Promise<void> | void;
    /** Called before indexing starts */
    onPreIndex?(files: string[], context: PluginContext): Promise<void> | void;
    /** Called after extraction, before resolution. Can add nodes/edges. */
    onPostExtraction?(nodes: Node[], edges: Edge[], context: PluginContext): Promise<{
        nodes?: Node[];
        edges?: Edge[];
    }> | {
        nodes?: Node[];
        edges?: Edge[];
    };
    /** Called after reference resolution */
    onPostResolution?(nodes: Node[], edges: Edge[], context: PluginContext): Promise<void> | void;
    /** Called after indexing completes */
    onPostIndex?(stats: {
        nodeCount: number;
        edgeCount: number;
        fileCount: number;
    }, context: PluginContext): Promise<void> | void;
    /** Analyze a symbol and return findings */
    analyze?(input: PluginAnalyzeInput, context: PluginContext): Promise<PluginAnalyzeOutput> | PluginAnalyzeOutput;
    /** Custom search provider */
    search?(input: PluginSearchInput, context: PluginContext): Promise<PluginSearchOutput> | PluginSearchOutput;
}
/**
 * Plugin registry manages all registered plugins.
 */
export declare class PluginRegistry {
    private plugins;
    private context;
    register(plugin: AgentGraphPlugin): void;
    unregister(name: string): boolean;
    get(name: string): AgentGraphPlugin | undefined;
    list(): PluginManifest[];
    setContext(context: PluginContext): void;
    getContext(): PluginContext | null;
    initializeAll(): Promise<void>;
    preIndex(files: string[]): Promise<void>;
    postExtraction(nodes: Node[], edges: Edge[]): Promise<{
        nodes: Node[];
        edges: Edge[];
    }>;
    postResolution(nodes: Node[], edges: Edge[]): Promise<void>;
    postIndex(stats: {
        nodeCount: number;
        edgeCount: number;
        fileCount: number;
    }): Promise<void>;
}
export declare const defaultRegistry: PluginRegistry;
//# sourceMappingURL=types.d.ts.map