"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultRegistry = exports.PluginRegistry = void 0;
/**
 * Plugin registry manages all registered plugins.
 */
class PluginRegistry {
    plugins = new Map();
    context = null;
    register(plugin) {
        if (this.plugins.has(plugin.manifest.name)) {
            throw new Error(`Plugin '${plugin.manifest.name}' is already registered`);
        }
        this.plugins.set(plugin.manifest.name, plugin);
    }
    unregister(name) {
        return this.plugins.delete(name);
    }
    get(name) {
        return this.plugins.get(name);
    }
    list() {
        return Array.from(this.plugins.values()).map((p) => p.manifest);
    }
    setContext(context) {
        this.context = context;
    }
    getContext() {
        return this.context;
    }
    // ===== Lifecycle helpers =====
    async initializeAll() {
        if (!this.context)
            return;
        for (const plugin of this.plugins.values()) {
            if (plugin.initialize) {
                await plugin.initialize(this.context);
            }
        }
    }
    async preIndex(files) {
        if (!this.context)
            return;
        for (const plugin of this.plugins.values()) {
            if (plugin.onPreIndex) {
                await plugin.onPreIndex(files, this.context);
            }
        }
    }
    async postExtraction(nodes, edges) {
        if (!this.context)
            return { nodes, edges };
        let allNodes = nodes;
        let allEdges = edges;
        for (const plugin of this.plugins.values()) {
            if (plugin.onPostExtraction) {
                const result = await plugin.onPostExtraction(allNodes, allEdges, this.context);
                if (result?.nodes)
                    allNodes = allNodes.concat(result.nodes);
                if (result?.edges)
                    allEdges = allEdges.concat(result.edges);
            }
        }
        return { nodes: allNodes, edges: allEdges };
    }
    async postResolution(nodes, edges) {
        if (!this.context)
            return;
        for (const plugin of this.plugins.values()) {
            if (plugin.onPostResolution) {
                await plugin.onPostResolution(nodes, edges, this.context);
            }
        }
    }
    async postIndex(stats) {
        if (!this.context)
            return;
        for (const plugin of this.plugins.values()) {
            if (plugin.onPostIndex) {
                await plugin.onPostIndex(stats, this.context);
            }
        }
    }
}
exports.PluginRegistry = PluginRegistry;
exports.defaultRegistry = new PluginRegistry();
//# sourceMappingURL=types.js.map