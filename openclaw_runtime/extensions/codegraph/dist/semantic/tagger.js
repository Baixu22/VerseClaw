"use strict";
/**
 * Semantic Tagger
 *
 * Auto-assigns business tags to modules based on:
 * - File/module naming conventions
 * - Import patterns (framework libraries)
 * - Decorator/annotation analysis
 * - Route prefix patterns
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticTagger = void 0;
const TAG_VOCABULARY = [
    'auth',
    'payment',
    'user',
    'notification',
    'storage',
    'cache',
    'search',
    'email',
    'sms',
    'queue',
    'logging',
    'monitoring',
    'config',
    'database',
    'api',
    'webhook',
    'scheduler',
    'export',
    'import',
    'transform',
    'validation',
    'routing',
    'middleware',
    'security',
    'frontend',
    'backend',
    'testing',
    'cli',
    'sdk',
    'integration',
];
class SemanticTagger {
    queries;
    rules;
    constructor(queries) {
        this.queries = queries;
        this.rules = this.buildRules();
    }
    tagAll() {
        const results = new Map();
        const allFiles = this.queries.getAllFiles();
        for (const file of allFiles) {
            const assignment = this.tagModule(file.path);
            if (assignment.tags.length > 0) {
                results.set(file.path, assignment);
            }
        }
        return results;
    }
    tagModule(modulePath) {
        const nodes = this.queries.getNodesByFile(modulePath);
        const imports = this.getModuleImports(modulePath);
        const matchedTags = [];
        for (const rule of this.rules) {
            if (rule.condition(modulePath, nodes, imports)) {
                matchedTags.push({ tag: rule.tag, confidence: rule.confidence });
            }
        }
        // Deduplicate by highest confidence
        const tagMap = new Map();
        for (const match of matchedTags) {
            const existing = tagMap.get(match.tag);
            if (existing === undefined || match.confidence > existing) {
                tagMap.set(match.tag, match.confidence);
            }
        }
        const tags = Array.from(tagMap.entries()).map(([tag]) => tag);
        const avgConfidence = tags.length > 0
            ? Array.from(tagMap.values()).reduce((a, b) => a + b, 0) / tags.length
            : 0;
        return {
            modulePath,
            tags,
            confidence: Math.round(avgConfidence * 100) / 100,
        };
    }
    findByTag(tag) {
        const results = [];
        for (const [, assignment] of this.tagAll()) {
            if (assignment.tags.includes(tag)) {
                results.push(assignment);
            }
        }
        return results;
    }
    findAllTags() {
        const tagMap = new Map();
        for (const [, assignment] of this.tagAll()) {
            for (const tag of assignment.tags) {
                if (!tagMap.has(tag))
                    tagMap.set(tag, []);
                tagMap.get(tag).push(assignment.modulePath);
            }
        }
        return tagMap;
    }
    getModuleImports(modulePath) {
        try {
            const deps = this.queries.getDependencyFilePaths(modulePath);
            return deps;
        }
        catch {
            return [];
        }
    }
    buildRules() {
        return [
            // ---- Naming convention rules ----
            {
                tag: 'auth',
                condition: (path, nodes) => /(auth|login|session|oauth|jwt|token|permission)/i.test(path) ||
                    nodes.some((n) => /(auth|login|session|oauth|jwt|token)/i.test(n.name)),
                confidence: 0.9,
            },
            {
                tag: 'payment',
                condition: (path, nodes) => /(pay|bill|invoice|checkout|transaction|order|pricing)/i.test(path) ||
                    nodes.some((n) => /(pay|bill|invoice|checkout|transaction|order|pricing)/i.test(n.name)),
                confidence: 0.9,
            },
            {
                tag: 'user',
                condition: (path, nodes) => /(user|account|profile|member|customer)/i.test(path) ||
                    nodes.some((n) => /(user|account|profile|member|customer)/i.test(n.name)),
                confidence: 0.85,
            },
            {
                tag: 'notification',
                condition: (path) => /(notif|alert|push|webhook)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'email',
                condition: (path) => /(email|mail|smtp|sendgrid|mailgun)/i.test(path),
                confidence: 0.95,
            },
            {
                tag: 'sms',
                condition: (path) => /(sms|twilio|message|text)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'storage',
                condition: (path) => /(storage|file|upload|download|s3|blob|bucket)/i.test(path),
                confidence: 0.9,
            },
            {
                tag: 'cache',
                condition: (path, _, imports) => /(cache|redis|memcache|memory)/i.test(path) ||
                    imports.some((i) => /redis|memcache/i.test(i)),
                confidence: 0.9,
            },
            {
                tag: 'search',
                condition: (path, _, imports) => /(search|index|elastic|meilisearch|algolia)/i.test(path) ||
                    imports.some((i) => /elastic|meilisearch|algolia/i.test(i)),
                confidence: 0.9,
            },
            {
                tag: 'queue',
                condition: (path, _, imports) => /(queue|job|worker|pubsub|kafka|rabbit|sqs|nats|bull)/i.test(path) ||
                    imports.some((i) => /kafka|rabbit|sqs|bull|amqp|nats/i.test(i)),
                confidence: 0.9,
            },
            {
                tag: 'logging',
                condition: (path) => /(log|logger|audit|trace)/i.test(path),
                confidence: 0.9,
            },
            {
                tag: 'monitoring',
                condition: (path, _, imports) => /(monitor|metric|health|prometheus|grafana|datadog)/i.test(path) ||
                    imports.some((i) => /prometheus|grafana|datadog|newrelic|sentry/i.test(i)),
                confidence: 0.85,
            },
            {
                tag: 'config',
                condition: (path) => /(config|setting|env|dotenv|option|preference)/i.test(path),
                confidence: 0.9,
            },
            {
                tag: 'database',
                condition: (path, _, imports) => /(db|database|migrat|seed|sql|orm|repository|dao)/i.test(path) ||
                    imports.some((i) => /sequelize|typeorm|prisma|mongoose|knex|drizzle|sqlx/i.test(i)),
                confidence: 0.85,
            },
            {
                tag: 'api',
                condition: (path) => /(api|endpoint|route|controller|graphql|rest|grpc)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'webhook',
                condition: (path) => /(webhook|hook|callback|event)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'scheduler',
                condition: (path) => /(sched|cron|timer|job|task)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'export',
                condition: (path) => /(export|csv|pdf|report|download|generate)/i.test(path),
                confidence: 0.8,
            },
            {
                tag: 'import',
                condition: (path) => /(import|parse|upload|migrate|ingest)/i.test(path),
                confidence: 0.8,
            },
            {
                tag: 'transform',
                condition: (path) => /(transform|convert|map|serialize|deserialize|encode|decode)/i.test(path),
                confidence: 0.8,
            },
            {
                tag: 'validation',
                condition: (path) => /(valid|sanitize|check|verify|assert)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'middleware',
                condition: (path) => /(middleware|interceptor|filter|guard|pipe)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'security',
                condition: (path) => /(secur|encrypt|decrypt|hash|password|cors|csrf|xss|rate.limit)/i.test(path),
                confidence: 0.85,
            },
            {
                tag: 'testing',
                condition: (path) => /(test|spec|mock|stub|fixture)/i.test(path),
                confidence: 0.9,
            },
            {
                tag: 'cli',
                condition: (path) => /(cli|cmd|command|terminal|console)/i.test(path),
                confidence: 0.85,
            },
        ];
    }
}
exports.SemanticTagger = SemanticTagger;
//# sourceMappingURL=tagger.js.map