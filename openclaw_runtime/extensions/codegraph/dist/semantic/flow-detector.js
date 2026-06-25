"use strict";
/**
 * Business Flow Detector
 *
 * Detects sequential business flows from the call graph.
 * Starting from entry points, traces call chains and identifies
 * recognized business patterns (CRUD, notification, validation, etc.).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowDetector = void 0;
const ACTION_PATTERNS = [
    { action: 'validate', role: 'validator', namePattern: /^validate|^check|^assert|^verify|^ensure|^(is|has|can)/i },
    { action: 'create', role: 'service', namePattern: /^create|^insert|^add|^new|^register/i },
    { action: 'update', role: 'service', namePattern: /^update|^edit|^modify|^patch|^change|^set/i },
    { action: 'delete', role: 'service', namePattern: /^delete|^remove|^drop|^destroy|^purge/i },
    { action: 'find', role: 'repository', namePattern: /^find|^get|^query|^fetch|^retrieve|^search|^load|^lookup/i },
    { action: 'list', role: 'repository', namePattern: /^list|^all$|^findAll|^getAll|^fetchAll/i },
    { action: 'save', role: 'repository', namePattern: /^save|^persist|^store|^put|^write|^upsert/i },
    { action: 'send', role: 'notification', namePattern: /^send|^notify|^publish|^push|^emit|^dispatch|^broadcast/i },
    { action: 'transform', role: 'transformer', namePattern: /^transform|^convert|^map|^format|^serialize|^marshal|^encode/i },
    { action: 'parse', role: 'parser', namePattern: /^parse|^deserialize|^unmarshal|^decode|^read/i },
    { action: 'compute', role: 'processor', namePattern: /^compute|^calculate|^process|^aggregate|^run|^exec/i },
    { action: 'check', role: 'checker', namePattern: /^check|^test|^audit|^inspect/i },
    { action: 'initialize', role: 'initializer', namePattern: /^init|^setup|^configure|^bootstrap|^prepare/i },
    { action: 'handle', role: 'handler', namePattern: /^handle|^on[A-Z]|^process/i },
];
const FLOW_NAME_PATTERNS = [
    { name: 'register', namePattern: /register|signup|sign_up|create.account|create.user|onboard/i },
    { name: 'login', namePattern: /login|signin|sign_in|authenticate|auth$/i },
    { name: 'logout', namePattern: /logout|signout|sign_out/i },
    { name: 'reset_password', namePattern: /reset.*password|password.*reset|forgot.*password/i },
    { name: 'verify_email', namePattern: /verify.*email|email.*verif|confirm.*email/i },
    { name: 'create_order', namePattern: /create.*order|place.*order|order.*create|new.*order/i },
    { name: 'process_payment', namePattern: /pay|payment|charge|checkout|invoice|bill/i },
    { name: 'upload_file', namePattern: /upload|import.*file/i },
    { name: 'download_file', namePattern: /download|export/i },
    { name: 'send_notification', namePattern: /notif|alert|send.*email|send.*sms/i },
    { name: 'sync_data', namePattern: /sync|replicat|mirror/i },
    { name: 'search', namePattern: /search|find|query|lookup/i },
    { name: 'webhook_event', namePattern: /webhook|hook.*event|incoming/i },
    { name: 'scheduled_task', namePattern: /cron|scheduled?|timer|job$/i },
];
class FlowDetector {
    queries;
    entryPointDetector;
    constructor(queries, entryPointDetector) {
        this.queries = queries;
        this.entryPointDetector = entryPointDetector;
    }
    detectAllFlows(options = {}) {
        const opts = {
            maxDepth: options.maxDepth ?? 8,
            maxFlows: options.maxFlows ?? 50,
            minConfidence: options.minConfidence ?? 0.3,
        };
        const entryPoints = this.entryPointDetector.detectAll().entryPoints;
        const flows = [];
        for (const ep of entryPoints) {
            const flow = this.detectFlowFromEntry(ep, opts.maxDepth);
            if (flow && flow.confidence >= opts.minConfidence) {
                flows.push(flow);
                if (flows.length >= opts.maxFlows)
                    break;
            }
        }
        return flows;
    }
    detectFlowFromEntry(ep, maxDepth) {
        const steps = this.traceCallChain(ep.controllerId, maxDepth);
        if (steps.length < 2)
            return null;
        const flowName = this.nameFlow(ep, steps);
        const confidence = this.estimateConfidence(steps);
        return {
            flowId: `flow_${flowName}_${ep.id}`,
            name: flowName,
            description: this.describeFlow(flowName, steps),
            entryPoint: ep.controller,
            steps,
            confidence,
            detectedAt: Date.now(),
        };
    }
    detectFlowByName(flowName, options = {}) {
        const allFlows = this.detectAllFlows(options);
        return allFlows.filter((f) => f.name.toLowerCase().includes(flowName.toLowerCase()));
    }
    traceCallChain(startId, maxDepth) {
        const steps = [];
        const visited = new Set();
        let currentId = startId;
        while (currentId && steps.length < maxDepth) {
            if (visited.has(currentId))
                break;
            visited.add(currentId);
            const node = this.queries.getNodeById(currentId);
            if (!node)
                break;
            const actionRole = this.determineActionRole(node);
            steps.push({
                order: steps.length + 1,
                symbol: node.qualifiedName,
                symbolId: node.id,
                filePath: node.filePath,
                action: actionRole.action,
                semanticRole: actionRole.role,
                startLine: node.startLine,
                endLine: node.endLine,
            });
            // Follow the most likely next step
            const callees = this.queries.getDirectCallees(currentId);
            if (callees.length === 0)
                break;
            // Pick the callee that's NOT in visited and is most "business-relevant"
            const candidates = callees.filter((c) => !visited.has(c.id));
            if (candidates.length === 0)
                break;
            // Score candidates: prefer service/repository/handler-like functions
            const scored = candidates.map((c) => ({
                id: c.id,
                score: this.scoreBusinessRelevance(c),
            }));
            scored.sort((a, b) => b.score - a.score);
            currentId = scored[0]?.id ?? null;
        }
        return steps;
    }
    determineActionRole(node) {
        const name = node.name;
        for (const pattern of ACTION_PATTERNS) {
            if (pattern.namePattern.test(name)) {
                return { action: pattern.action, role: pattern.role };
            }
        }
        // Fallback: determine role from node kind
        if (node.kind === 'function' || node.kind === 'method') {
            return { action: 'execute', role: 'function' };
        }
        if (node.kind === 'class') {
            return { action: 'manage', role: 'service' };
        }
        return { action: 'process', role: 'symbol' };
    }
    scoreBusinessRelevance(node) {
        const name = node.name.toLowerCase();
        let score = 1;
        // Prefer service/repository/handler-like names
        if (name.includes('service') || name.endsWith('service'))
            score += 3;
        if (name.includes('repository') || name.endsWith('repository') || name.endsWith('repo'))
            score += 2;
        if (name.includes('handler') || name.includes('controller'))
            score += 2;
        if (name.includes('validator') || name.includes('guard'))
            score += 1;
        if (name.includes('util') || name.includes('helper'))
            score -= 1;
        if (name.includes('test') || name.includes('spec'))
            score -= 3;
        return score;
    }
    nameFlow(ep, steps) {
        // Try to match known flow patterns
        const combinedText = `${ep.controller} ${ep.entrypoint} ${steps.map((s) => s.action).join(' ')}`;
        for (const pattern of FLOW_NAME_PATTERNS) {
            if (pattern.namePattern.test(combinedText)) {
                return pattern.name;
            }
        }
        // Fallback: derive from entry point name
        const controllerName = ep.controller.split('.').pop() ?? ep.controller;
        return controllerName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    }
    describeFlow(flowName, steps) {
        const stepDescriptions = steps
            .map((s) => `${s.action} → ${s.semanticRole}(${s.symbol.split('.').pop()})`)
            .join(' → ');
        return `业务流程 ${flowName}: ${stepDescriptions}`;
    }
    estimateConfidence(steps) {
        if (steps.length < 2)
            return 0.1;
        let score = 0;
        const roles = new Set(steps.map((s) => s.semanticRole));
        // More diverse roles → higher confidence
        score += Math.min(roles.size / 4, 1) * 0.4;
        // Longer chains → higher confidence (with diminishing returns)
        score += Math.min(steps.length / 5, 1) * 0.3;
        // Recognized actions → higher confidence
        const recognizedActions = steps.filter((s) => s.action !== 'execute' && s.action !== 'process');
        score += (recognizedActions.length / steps.length) * 0.3;
        return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
    }
}
exports.FlowDetector = FlowDetector;
//# sourceMappingURL=flow-detector.js.map