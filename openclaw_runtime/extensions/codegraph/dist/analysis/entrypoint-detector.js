"use strict";
/**
 * Entry Point Detector
 *
 * Automatically identifies application entry points:
 * - HTTP API entries (route nodes + annotated controllers)
 * - CLI entries (main functions, CLI command registrations)
 * - Scheduled tasks (cron/scheduled annotations)
 * - Message queue consumers
 * - WebSocket handlers
 * - RPC service methods
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntryPointDetector = void 0;
const path = __importStar(require("path"));
class EntryPointDetector {
    queries;
    constructor(queries) {
        this.queries = queries;
    }
    detectAll() {
        const startTime = Date.now();
        const entryPoints = [];
        // Layer 1: Framework-emitted route nodes (already indexed)
        entryPoints.push(...this.detectRouteEntries());
        // Layer 2: Annotation/decorator-driven entries
        entryPoints.push(...this.detectAnnotationEntries());
        // Layer 3: Naming convention entries
        entryPoints.push(...this.detectConventionEntries());
        // Layer 4: CLI entry detection
        entryPoints.push(...this.detectCLIEntries());
        // Deduplicate
        const unique = this.deduplicate(entryPoints);
        const byType = {
            http_api: 0,
            cli: 0,
            scheduled_task: 0,
            message_queue: 0,
            websocket: 0,
            rpc: 0,
            event_handler: 0,
        };
        for (const ep of unique) {
            byType[ep.type]++;
        }
        return {
            entryPoints: unique,
            totalCount: unique.length,
            byType,
            durationMs: Date.now() - startTime,
        };
    }
    getEntryPointsByType(type) {
        return this.detectAll().entryPoints.filter((ep) => ep.type === type);
    }
    getEntryPointsForSymbol(symbolName) {
        return this.detectAll().entryPoints.filter((ep) => ep.controller.includes(symbolName) ||
            ep.serviceChain.some((s) => s.includes(symbolName)) ||
            ep.entrypoint.includes(symbolName));
    }
    getEntryPointIds() {
        const ids = new Set();
        for (const ep of this.detectAll().entryPoints) {
            ids.add(ep.controllerId);
        }
        return ids;
    }
    detectRouteEntries() {
        const entries = [];
        const routeNodes = this.queries.getNodesByKind('route');
        for (const route of routeNodes) {
            const callees = this.queries.getDirectCallees(route.id);
            const chain = [];
            for (const callee of callees) {
                chain.push(callee.name);
                // Follow one level deeper for service chain
                const subCallees = this.queries.getDirectCallees(callee.id);
                for (const sub of subCallees.slice(0, 5)) {
                    if (!chain.includes(sub.name)) {
                        chain.push(sub.name);
                    }
                }
            }
            entries.push({
                id: `entry_${route.id}`,
                type: 'http_api',
                entrypoint: route.name || route.qualifiedName,
                controller: callees[0]?.qualifiedName ?? route.name,
                controllerId: callees[0]?.id ?? route.id,
                serviceChain: chain.slice(0, 10),
                filePath: route.filePath,
                line: route.startLine,
                language: route.language,
                metadata: { source: 'route_node' },
            });
        }
        return entries;
    }
    detectAnnotationEntries() {
        const entries = [];
        const scorableNodes = this.queries.getAllScorableNodes();
        const annotationPatterns = [
            { pattern: /@Scheduled|@Schedule|@cron/i, type: 'scheduled_task' },
            { pattern: /@MessagePattern|@EventPattern|@RabbitListener|@KafkaListener|@SqsListener|@Queue/i, type: 'message_queue' },
            { pattern: /@SubscribeMessage|@WebSocketGateway/i, type: 'websocket' },
            { pattern: /@GrpcMethod|@GrpcService/i, type: 'rpc' },
            { pattern: /@EventListener|@EventHandler/i, type: 'event_handler' },
        ];
        for (const node of scorableNodes) {
            const decorators = node.decorators ?? [];
            if (decorators.length === 0)
                continue;
            for (const decorator of decorators) {
                for (const pattern of annotationPatterns) {
                    if (pattern.pattern.test(decorator)) {
                        entries.push({
                            id: `entry_anno_${node.id}`,
                            type: pattern.type,
                            entrypoint: decorator,
                            controller: node.qualifiedName,
                            controllerId: node.id,
                            serviceChain: this.buildServiceChain(node.id),
                            filePath: node.filePath,
                            line: node.startLine,
                            language: node.language,
                            framework: pattern.framework,
                            metadata: { source: 'annotation', decorator },
                        });
                    }
                }
            }
        }
        return entries;
    }
    detectConventionEntries() {
        const entries = [];
        const scorableNodes = this.queries.getAllScorableNodes();
        for (const node of scorableNodes) {
            const basename = path.basename(node.filePath, path.extname(node.filePath)).toLowerCase();
            const name = node.name.toLowerCase();
            // Detect CLI entries via naming convention
            if (basename === 'main' ||
                basename === 'cli' ||
                basename === 'cmd' ||
                name.startsWith('main') ||
                name === 'run' ||
                name === 'execute' ||
                name === 'start') {
                // Check if it has command-line argument parsing patterns
                const hasCLISignal = this.hasCLISignal(node);
                if (hasCLISignal) {
                    entries.push({
                        id: `entry_cli_${node.id}`,
                        type: 'cli',
                        entrypoint: node.qualifiedName,
                        controller: node.qualifiedName,
                        controllerId: node.id,
                        serviceChain: this.buildServiceChain(node.id),
                        filePath: node.filePath,
                        line: node.startLine,
                        language: node.language,
                        metadata: { source: 'convention' },
                    });
                }
            }
            // Detect task/worker entries
            if (name.includes('worker') ||
                name.includes('consumer') ||
                name.includes('handler') ||
                name.includes('task')) {
                const isMQConsumer = node.decorators?.some((d) => /queue|consumer|listener|handler|subscribe/i.test(d)) ?? false;
                if (isMQConsumer) {
                    entries.push({
                        id: `entry_mq_${node.id}`,
                        type: 'message_queue',
                        entrypoint: node.qualifiedName,
                        controller: node.qualifiedName,
                        controllerId: node.id,
                        serviceChain: this.buildServiceChain(node.id),
                        filePath: node.filePath,
                        line: node.startLine,
                        language: node.language,
                        metadata: { source: 'convention' },
                    });
                }
            }
        }
        return entries;
    }
    detectCLIEntries() {
        const entries = [];
        const scorableNodes = this.queries.getAllScorableNodes();
        for (const node of scorableNodes) {
            // Python CLI signals
            if (node.language === 'python') {
                const hasClickOrArgparse = this.queries.hasFileImport(node.filePath, /click|argparse|typer|fire|commander/i);
                if (hasClickOrArgparse && node.kind === 'function') {
                    entries.push({
                        id: `entry_pycli_${node.id}`,
                        type: 'cli',
                        entrypoint: node.qualifiedName,
                        controller: node.qualifiedName,
                        controllerId: node.id,
                        serviceChain: this.buildServiceChain(node.id),
                        filePath: node.filePath,
                        line: node.startLine,
                        language: node.language,
                        metadata: { source: 'python_cli' },
                    });
                }
            }
            // Go CLI signals
            if (node.language === 'go') {
                const hasCobra = this.queries.hasFileImport(node.filePath, /cobra|urfave\/cli|pflag|flag/i);
                if (hasCobra) {
                    entries.push({
                        id: `entry_gocli_${node.id}`,
                        type: 'cli',
                        entrypoint: node.qualifiedName,
                        controller: node.qualifiedName,
                        controllerId: node.id,
                        serviceChain: this.buildServiceChain(node.id),
                        filePath: node.filePath,
                        line: node.startLine,
                        language: node.language,
                        metadata: { source: 'go_cli' },
                    });
                }
            }
        }
        return entries;
    }
    buildServiceChain(startId, maxDepth = 5) {
        const chain = [];
        const visited = new Set();
        const queue = [startId];
        while (queue.length > 0 && chain.length < maxDepth * 3) {
            const id = queue.shift();
            if (visited.has(id))
                continue;
            visited.add(id);
            const callees = this.queries.getDirectCallees(id);
            for (const callee of callees) {
                if (!visited.has(callee.id)) {
                    chain.push(callee.name);
                    queue.push(callee.id);
                }
            }
        }
        return chain.slice(0, 20);
    }
    hasCLISignal(node) {
        const signals = [
            'argparse', 'ArgumentParser', 'click.', '@click.', 'typer',
            'cobra.Command', 'flag.', 'c.BaseCommand', 'commander',
            'process.argv', 'std::getopt', 'CommandLine', 'OptionParser',
        ];
        const callees = this.queries.getDirectCallees(node.id);
        return callees.some((c) => signals.some((s) => c.qualifiedName.includes(s) || c.name.includes(s)));
    }
    deduplicate(entries) {
        const seen = new Set();
        return entries.filter((ep) => {
            const key = `${ep.type}:${ep.controllerId}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
}
exports.EntryPointDetector = EntryPointDetector;
//# sourceMappingURL=entrypoint-detector.js.map