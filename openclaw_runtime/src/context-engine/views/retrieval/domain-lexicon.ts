// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/retrieval/domain-lexicon.ts (verbatim).
export type DomainLexiconCategory =
  | "protocol"
  | "config"
  | "graph"
  | "test"
  | "runtime"
  | "error"
  | "entrypoint"
  | "docs";

export interface DomainLexiconTerm {
  term: string;
  weight: number;
}

export interface DomainLexiconEntry {
  patterns: RegExp[];
  terms: DomainLexiconTerm[];
  category: DomainLexiconCategory;
}

export interface DomainLexiconMatch extends DomainLexiconTerm {
  category: DomainLexiconCategory;
}

export const DOMAIN_LEXICON: DomainLexiconEntry[] = [
  {
    category: "protocol",
    patterns: [/协议|契约|接口契约|网关协议/i],
    terms: [
      { term: "protocol", weight: 0.58 },
      { term: "contract", weight: 0.54 }
    ]
  },
  {
    category: "protocol",
    patterns: [/版本号?|当前版本/i],
    terms: [{ term: "version", weight: 0.58 }]
  },
  {
    category: "protocol",
    patterns: [/常量|常数|值是多少|取值|数值/i],
    terms: [
      { term: "const", weight: 0.52 },
      { term: "constant", weight: 0.52 },
      { term: "value", weight: 0.46 }
    ]
  },
  {
    category: "runtime",
    patterns: [/网关/i],
    terms: [{ term: "gateway", weight: 0.5 }]
  },
  {
    category: "entrypoint",
    patterns: [/入口|入口点|启动入口|负责人|归属|谁负责/i],
    terms: [
      { term: "entrypoint", weight: 0.52 },
      { term: "owner", weight: 0.48 },
      { term: "bootstrap", weight: 0.42 }
    ]
  },
  {
    category: "runtime",
    patterns: [/启动|初始化|引导/i],
    terms: [
      { term: "startup", weight: 0.52 },
      { term: "bootstrap", weight: 0.48 }
    ]
  },
  {
    category: "runtime",
    patterns: [/尚未就绪|未就绪|不可用|不可达/i],
    terms: [
      { term: "unavailable", weight: 0.52 },
      { term: "pending", weight: 0.42 }
    ]
  },
  {
    category: "runtime",
    patterns: [/关闭|断开|close code|关闭码/i],
    terms: [
      { term: "close", weight: 0.5 },
      { term: "disconnect", weight: 0.42 },
      { term: "code", weight: 0.36 }
    ]
  },
  {
    category: "runtime",
    patterns: [/摄像头|相机|采集/i],
    terms: [
      { term: "camera", weight: 0.56 },
      { term: "capture", weight: 0.54 }
    ]
  },
  {
    category: "runtime",
    patterns: [/语音合成|语音|合成器/i],
    terms: [
      { term: "speech", weight: 0.56 },
      { term: "synthesizer", weight: 0.54 },
      { term: "tts", weight: 0.48 }
    ]
  },
  {
    category: "error",
    patterns: [/重试/i],
    terms: [{ term: "retry", weight: 0.48 }]
  },
  {
    category: "error",
    patterns: [/错误|异常|失败|报错/i],
    terms: [
      { term: "error", weight: 0.5 },
      { term: "failure", weight: 0.42 }
    ]
  },
  {
    category: "graph",
    patterns: [/谁调用|被谁调用|调用链|调用方|引用方|影响范围/i],
    terms: [
      { term: "caller", weight: 0.52 },
      { term: "callers", weight: 0.52 },
      { term: "call", weight: 0.44 },
      { term: "reference", weight: 0.4 }
    ]
  },
  {
    category: "graph",
    patterns: [/依赖|被谁依赖|谁依赖|导入|上游|下游/i],
    terms: [
      { term: "dependency", weight: 0.52 },
      { term: "dependencies", weight: 0.52 },
      { term: "import", weight: 0.42 }
    ]
  },
  {
    category: "config",
    patterns: [/配置|环境变量|模式|schema|设置/i],
    terms: [
      { term: "config", weight: 0.52 },
      { term: "env", weight: 0.48 },
      { term: "schema", weight: 0.52 },
      { term: "settings", weight: 0.4 }
    ]
  },
  {
    category: "config",
    patterns: [/旧配置|旧\s*key|淘汰|废弃|过时|deprecated|legacy/i],
    terms: [
      { term: "legacy", weight: 0.58 },
      { term: "deprecated", weight: 0.54 }
    ]
  },
  {
    category: "test",
    patterns: [/测试|夹具|断言|fixture|mock|用例/i],
    terms: [
      { term: "test", weight: 0.52 },
      { term: "fixture", weight: 0.5 },
      { term: "mock", weight: 0.46 },
      { term: "assert", weight: 0.4 }
    ]
  },
  {
    category: "docs",
    patterns: [/文档|规则|指南|约束|说明|策略/i],
    terms: [
      { term: "docs", weight: 0.46 },
      { term: "policy", weight: 0.46 },
      { term: "instructions", weight: 0.4 }
    ]
  }
];

export function matchDomainLexicon(query: string): DomainLexiconMatch[] {
  const matches = new Map<string, DomainLexiconMatch>();
  for (const entry of DOMAIN_LEXICON) {
    if (!entry.patterns.some((pattern) => pattern.test(query))) continue;
    for (const term of entry.terms) {
      const normalized = normalizeLexiconTerm(term.term);
      const existing = matches.get(normalized);
      if (!existing || term.weight > existing.weight) {
        matches.set(normalized, { term: normalized, weight: term.weight, category: entry.category });
      }
    }
  }
  return [...matches.values()];
}

export function categoriesFromLexiconMatches(matches: DomainLexiconMatch[]): DomainLexiconCategory[] {
  return [...new Set(matches.map((match) => match.category))].sort();
}

function normalizeLexiconTerm(term: string): string {
  return term.trim().toLowerCase();
}
