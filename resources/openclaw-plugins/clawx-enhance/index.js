/**
 * ClawX Enhance Plugin
 *
 * OpenClaw plugin providing:
 * 1. Stream Rules Guard — post-hoc LLM output scanning for dangerous patterns
 * 2. Skill Suggester — auto-suggest saving complex workflows as reusable skills
 *
 * Deployed to ~/.openclaw/extensions/clawx-enhance/ by ClawX config-sync.
 */

// ── Pattern definitions ──────────────────────────────────────────────────────

const BUILTIN_RULES = [
  {
    name: 'no-rm-rf-root',
    pattern: '\\brm\\s+-rf\\s+(?:/(?!\\w+/)|/etc|/var|/usr|/boot|/home(?!/\\w+/))',
    message: 'DANGER: Recursive delete targeting system directory. Verify the path.',
    severity: 'critical',
  },
  {
    name: 'no-sudo-dangerous',
    pattern: 'sudo\\s+.*(?:rm\\s+-rf|dd\\s+if=|mkfs\\.)',
    message: 'DANGER: Destructive sudo command detected. Verify before executing.',
    severity: 'critical',
  },
  {
    name: 'no-hardcoded-secret',
    pattern: '(?:api[_-]?key|secret|password|token|auth)\\s*[:=]\\s*["\'][A-Za-z0-9+/=_-]{20,}["\']',
    message: 'Potential hardcoded secret. Use environment variables instead.',
    severity: 'warning',
  },
  {
    name: 'no-force-push-main',
    pattern: 'git\\s+push\\s+(?:--force|-f)\\s+origin\\s+(?:main|master)',
    message: 'Force push to main/master branch. Use with extreme caution.',
    severity: 'critical',
  },
  {
    name: 'no-drop-table',
    pattern: '(?i)DROP\\s+(?:TABLE|DATABASE)\\s+\\w+',
    message: 'SQL DROP statement detected. Verify before executing.',
    severity: 'warning',
  },
  {
    name: 'no-curl-bash',
    pattern: 'curl\\s+.*\\|\\s*(?:bash|sh)',
    message: 'curl-to-bash pipe detected. Review the URL before executing.',
    severity: 'warning',
  },
];

/**
 * @param {string} text
 * @param {typeof BUILTIN_RULES} rules
 * @returns {Array<{rule: typeof BUILTIN_RULES[0], matched: string, context: string}>}
 */
function scanOutput(rules, text) {
  /** @type {Array<{rule: typeof BUILTIN_RULES[0], matched: string, context: string}>} */
  const matches = [];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern, 'im');
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(text.length, m.index + m[0].length + 40);
      matches.push({
        rule,
        matched: m[0],
        context: text.slice(start, end),
      });
      if (!re.global) break;
    }
  }
  return matches;
}

/**
 * @param {Array<{rule: typeof BUILTIN_RULES[0], matched: string, context: string}>} matches
 * @returns {string}
 */
function formatGuardWarning(matches) {
  const critical = matches.filter((m) => m.rule.severity === 'critical');
  const warnings = matches.filter((m) => m.rule.severity === 'warning');
  const info = matches.filter((m) => m.rule.severity === 'info');

  const lines = ['## ⚠ Stream Rule Warnings\n'];

  if (critical.length > 0) {
    lines.push('### 🚨 CRITICAL');
    for (const m of critical) {
      lines.push(`- **${m.rule.name}**: ${m.rule.message}`);
      lines.push(`  \`\`\`\n  ${m.context.trim()}\n  \`\`\``);
    }
  }

  if (warnings.length > 0) {
    lines.push('### ⚠ Warnings');
    for (const m of warnings) {
      lines.push(`- **${m.rule.name}**: ${m.rule.message}`);
    }
  }

  if (info.length > 0) {
    lines.push('### ℹ Info');
    for (const m of info) {
      lines.push(`- **${m.rule.name}**: ${m.rule.message}`);
    }
  }

  return lines.join('\n');
}

// ── Verifiable claim detection ───────────────────────────────────────────────

const VERIFIABLE_CLAIM_PATTERNS = [
  /\b(?:wrote|written|created|saved|uploaded|deployed|published|sent|posted)\s+(?:file|to|the)\s+[^\s,.]{3,}/i,
  /\bHTTP\s+(?:POST|PUT|DELETE|PATCH)\b/i,
  /\bcurl\s+.*-X\s+(?:POST|PUT|DELETE)\b/i,
];

/**
 * @param {string} text
 * @returns {string[]}
 */
function detectVerifiableClaims(text) {
  return VERIFIABLE_CLAIM_PATTERNS
    .filter((re) => re.test(text))
    .map((re) => {
      const m = text.match(re);
      return m ? m[0] : '';
    })
    .filter(Boolean);
}

// ── Plugin entry ─────────────────────────────────────────────────────────────

/** @type {import('openclaw/plugin-sdk').OpenClawPluginSetupFn} */
export default async function clawxEnhancePlugin(api) {
  const rules = BUILTIN_RULES;

  api.logger.info('[clawx-enhance] Stream guard rules loaded: %d', rules.length);

  // ── Hook 1: llm_output — observe LLM output for analytics/logging ──

  api.on('llm_output', async (event) => {
    for (const text of event.assistantTexts) {
      if (!text) continue;
      const matches = scanOutput(rules, text);
      if (matches.length > 0) {
        const criticalCount = matches.filter((m) => m.rule.severity === 'critical').length;
        const warningCount = matches.filter((m) => m.rule.severity === 'warning').length;
        api.logger.warn(
          '[clawx-enhance] Guard matched in llm_output: critical=%d, warning=%d, model=%s',
          criticalCount,
          warningCount,
          event.model,
        );
      }
    }
  });

  // ── Hook 2: before_agent_finalize — veto critical patterns ──

  api.on('before_agent_finalize', async (event) => {
    const text = event.lastAssistantMessage ?? '';
    if (!text) return;

    const allMatches = scanOutput(rules, text);
    const criticals = allMatches.filter((m) => m.rule.severity === 'critical');
    const warnings = allMatches.filter((m) => m.rule.severity !== 'critical');

    if (criticals.length > 0) {
      api.logger.warn(
        '[clawx-enhance] CRITICAL guard match — requesting revision. Patterns: %s',
        criticals.map((m) => m.rule.name).join(', '),
      );
      const warning = formatGuardWarning(criticals);
      return {
        action: 'revise',
        retry: {
          instruction: `⚠️ SAFETY GUARD TRIGGERED:\n${warning}\n\nPlease revise your response to avoid these dangerous patterns. Do NOT re-output the flagged content.`,
        },
      };
    }

    // Non-critical warnings: inject into next turn context
    if (warnings.length > 0) {
      api.logger.info(
        '[clawx-enhance] Guard warnings — injecting context. Patterns: %s',
        warnings.map((m) => m.rule.name).join(', '),
      );
      try {
        await api.session?.workflow?.enqueueNextTurnInjection?.({
          content: formatGuardWarning(warnings),
          priority: 'system-high',
        });
      } catch {
        // enqueueNextTurnInjection may not be available in all OpenClaw versions
        api.logger.warn('[clawx-enhance] enqueueNextTurnInjection not available for guard warnings');
      }
    }
  });

  // ── Hook 3: agent_end — detect skill-worthy completions ──

  api.on('agent_end', async (event) => {
    if (event.status !== 'ok' && event.status !== 'completed') return;

    try {
      api.logger.info('[clawx-enhance] Agent run completed: status=%s', event.status);
      await api.session?.workflow?.enqueueNextTurnInjection?.({
        content:
          '💡 This task completed successfully. If this workflow is reusable, you can say "save this as a skill" to create a reusable SKILL.md.',
        priority: 'assistant-note',
      });
    } catch {
      // Silent — suggestion is non-critical
    }
  });

  // ── Hook 4: before_agent_reply — mark unverified sub-agent claims ──

  api.on('before_agent_reply', async (event) => {
    // Only flag when this looks like a sub-agent summary
    // (presence of "task completed" or "summary" markers)
    const text = event.lastAssistantMessage ?? '';
    if (!text.match(/\b(?:subagent|sub-agent|task completed|summary of|delegate)\b/i)) return;

    const claims = detectVerifiableClaims(text);
    if (claims.length === 0) return;

    api.logger.info('[clawx-enhance] Detected %d verifiable claims in sub-agent response', claims.length);

    return {
      handled: true,
      reply: {
        text:
          text +
          '\n\n---\n⚠️ *This summary contains unverified claims. Side-effect operations should be independently verified before trusting.*',
      },
    };
  });

  // ── Phase 3: Topic Memory Supplement ──
  try {
    const { registerTopicMemorySupplement } = require('./topic-memory.js');
    registerTopicMemorySupplement(api);
    api.logger.info('[clawx-enhance] Topic memory supplement registered');
  } catch (e) {
    api.logger.warn('[clawx-enhance] Topic memory supplement not loaded: %s', e.message);
  }

// ── Phase 4: ClawX Pico ContextEngine ──────────────────────────────────────────
//
// 思路：OpenClaw 本身已经有完整的 ContextEngine / compaction 流水线（LLM 摘要、
// 滑动窗口、context-pruning 等）。我们不要重新造轮子，而是用 OpenClaw 暴露的
// 两个 SDK 入口：
//
//   1. registerContextEngine(id, factory)  — 注册一个 plugin 自有的 engine
//   2. delegateCompactionToRuntime(params) — 在 engine.compact() 里把真实
//                                            压缩委托给 OpenClaw 内置路径
//
// ClawX Pico 只做"判断"——加一层策略（防抖、older 消息下限、token 比例等）决定
// 是否真的去让 OpenClaw 跑压缩。压缩本身（LLM 摘要、滑动窗口、cache-ttl
// pruning、override system prompt 等）全部走 OpenClaw 自带实现。
//
// 启用方式（用户配置 openclaw.json）：
//   {
//     "plugins": {
//       "slots": { "contextEngine": "clawx-pico" },
//       "entries": {
//         "clawx-enhance": {
//           "config": {
//             "picocontext": {
//               "triggerRatio": 0.75,
//               "freshTailSize": 32,
//               "minMessagesToCompress": 8,
//               "minOlderTokens": 20000,
//               "debounceMs": 60000,
//               "enable": true
//             }
//           }
//         }
//       }
//     }
//   }
try {
  // OpenClaw plugin SDK 公开的 ContextEngine 入口
  const sdk = require('openclaw/plugin-sdk');
  const { registerContextEngine, delegateCompactionToRuntime } = sdk;
  if (typeof registerContextEngine !== 'function' || typeof delegateCompactionToRuntime !== 'function') {
    throw new Error('openclaw/plugin-sdk missing registerContextEngine/delegation exports');
  }
  const { judgeCompression, DEFAULTS: JUDGE_DEFAULTS } = require('./compression-judge.js');

  /** @type {Map<string, { lastCompressionAt: number, lastMessageCount: number, lastDecision: string, totalCompressions: number, totalSkips: number }>} */
  const stateBySession = new Map();

  function getOrCreateState(sessionKey) {
    let s = stateBySession.get(sessionKey);
    if (!s) {
      s = { lastCompressionAt: 0, lastMessageCount: 0, lastDecision: '', totalCompressions: 0, totalSkips: 0 };
      stateBySession.set(sessionKey, s);
    }
    return s;
  }

  /** @param {Record<string, any> | undefined} pluginConfig */
  function getPicoConfig(pluginConfig) {
    const raw = pluginConfig?.picocontext;
    return {
      enable: raw?.enable !== false,
      triggerRatio: Number.isFinite(raw?.triggerRatio) ? raw.triggerRatio : JUDGE_DEFAULTS.triggerRatio,
      freshTailSize: Number.isFinite(raw?.freshTailSize) ? raw.freshTailSize : JUDGE_DEFAULTS.freshTailSize,
      minMessagesToCompress: Number.isFinite(raw?.minMessagesToCompress) ? raw.minMessagesToCompress : JUDGE_DEFAULTS.minMessagesToCompress,
      minOlderTokens: Number.isFinite(raw?.minOlderTokens) ? raw.minOlderTokens : JUDGE_DEFAULTS.minOlderTokens,
      debounceMs: Number.isFinite(raw?.debounceMs) ? raw.debounceMs : JUDGE_DEFAULTS.debounceMs,
    };
  }

  // helper that always reads the latest pluginConfig (it can be hot-reloaded)
  const picoCfg = () => getPicoConfig(api.pluginConfig);

  api.logger.info(
    '[clawx-enhance:pico] module loaded: trigger=%d%%, freshTail=%d, minOlder=%d, debounce=%dms',
    Math.round(picoCfg().triggerRatio * 100),
    picoCfg().freshTailSize, picoCfg().minMessagesToCompress, picoCfg().debounceMs,
  );

  // ── ContextEngine factory ──
  // Note: this engine owns its compaction decision; other methods are
  // pass-through so the host can still drive a normal flow when we're
  // active. assemble/ingest/maintain/afterTurn are minimal — real LLM
  // summary lives in compact() (delegated) and rewrite transcript entries
  // can flow through maintain() if/when OpenClaw exposes the helper.
  function makeClawxPicoEngine() {
    return {
      info: {
        id: 'clawx-pico',
        name: 'ClawX Pico (judgment-only ContextEngine)',
        version: '1.0.0',
        // We own the *decision* (when to compact) but the *algorithm* is
        // delegated to OpenClaw runtime compaction.
        ownsCompaction: false,
        turnMaintenanceMode: 'foreground',
      },
      async assemble(params) {
        // Pure pass-through. Real sliding-window trimming is OpenClaw's job
        // and lives in its sanitize/validate/limit pipeline; we just hand
        // the messages back with an honest token estimate.
        const msgs = Array.isArray(params.messages) ? params.messages : [];
        let chars = 0;
        for (const m of msgs) {
          const c = m?.content;
          if (typeof c === 'string') chars += c.length;
          else if (Array.isArray(c)) for (const part of c) if (typeof part?.text === 'string') chars += part.text.length;
        }
        return { messages: msgs, estimatedTokens: Math.ceil(chars / 4) };
      },
      async ingest(_params) { return { ingested: true }; },
      async ingestBatch(params) {
        const arr = Array.isArray(params.messages) ? params.messages : [];
        return { ingestedCount: arr.length };
      },
      async maintain(_params) {
        return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
      },
      async afterTurn(_params) { /* no-op */ },
      /**
       * The heart of ClawX Pico: ask the judge, then either delegate to
       * OpenClaw runtime compaction (which does the real LLM-summary /
       * sliding-window / pruning) or short-circuit with a no-op result.
       */
      async compact(params) {
        const cfg = picoCfg();
        if (!cfg.enable) {
          return { ok: true, compacted: false, reason: 'pico-disabled' };
        }
        const sessionKey = params.sessionKey || params.sessionId || 'default';
        const state = getOrCreateState(sessionKey);

        // token / message inputs
        const messageCount = Array.isArray(params.messages) ? params.messages.length : 0;
        const tokenBudget = Number.isFinite(params.tokenBudget) ? params.tokenBudget : 0;
        const tokenCount = Number.isFinite(params.currentTokenCount) ? params.currentTokenCount : 0;

        // judge (this is the only thing ClawX Pico *decides*)
        const decision = judgeCompression({
          messageCount,
          tokenCount,
          tokenBudget,
          freshTailSize: cfg.freshTailSize,
          lastCompressionAt: state.lastCompressionAt,
          config: cfg,
        });
        state.lastDecision = decision.reason;

        if (!decision.shouldCompress) {
          state.totalSkips += 1;
          api.logger.debug?.(
            '[clawx-enhance:pico] skip: %s (skips=%d)',
            decision.reason, state.totalSkips,
          );
          return { ok: true, compacted: false, reason: `pico-skip: ${decision.reason}` };
        }

        api.logger.info(
          '[clawx-enhance:pico] judge OK → delegating to runtime compaction: %s (totalCompressions=%d)',
          decision.reason, state.totalCompressions,
        );

        // Delegate to OpenClaw's built-in compaction. The host will run
        // the real LLM summary / sliding window / transcript rewrite.
        let result;
        try {
          result = await delegateCompactionToRuntime(params);
        } catch (e) {
          api.logger.warn('[clawx-enhance:pico] delegateCompactionToRuntime threw: %s', e?.message || e);
          return { ok: false, compacted: false, reason: `pico-delegate-error: ${e?.message || e}` };
        }

        if (result?.compacted) {
          state.lastCompressionAt = Date.now();
          state.lastMessageCount = messageCount;
          state.totalCompressions += 1;
          api.logger.info(
            '[clawx-enhance:pico] delegated compaction OK: tokensBefore=%s tokensAfter=%s summaryLen=%d',
            result.result?.tokensBefore,
            result.result?.tokensAfter,
            (result.result?.summary || '').length,
          );
        } else {
          api.logger.info(
            '[clawx-enhance:pico] delegated compaction did not compact: %s',
            result?.reason || 'no-reason',
          );
        }
        return result;
      },
    };
  }

  // Register under our plugin id so the host can opt-in via
  // `config.plugins.slots.contextEngine = "clawx-pico"`.
  const reg = registerContextEngine('clawx-pico', makeClawxPicoEngine);
  if (reg && reg.ok === false) {
    api.logger.warn('[clawx-enhance:pico] registerContextEngine refused: existingOwner=%s', reg.existingOwner);
  } else {
    api.logger.info('[clawx-enhance:pico] ContextEngine registered: id=clawx-pico (enable via plugins.slots.contextEngine)');
  }

  // ── Observability hooks (read-only, do not mutate compaction) ──
  api.on('before_compaction', async (event, ctx) => {
    const sessionKey = ctx?.sessionKey || 'default';
    const state = getOrCreateState(sessionKey);
    api.logger.info(
      '[clawx-enhance:pico] native before_compaction: msgs=%d, compacting=%d, tokens=%s, sessionFile=%s, lastJudge="%s"',
      event?.messageCount ?? -1,
      event?.compactingCount ?? -1,
      event?.tokenCount ?? 'unknown',
      event?.sessionFile ? 'present' : 'absent',
      state.lastDecision,
    );
  });
  api.on('after_compaction', async (event, ctx) => {
    const sessionKey = ctx?.sessionKey || 'default';
    const state = getOrCreateState(sessionKey);
    api.logger.info(
      '[clawx-enhance:pico] native after_compaction: msgs=%d, compacted=%d, tokens=%s',
      event?.messageCount ?? -1,
      event?.compactedCount ?? -1,
      event?.tokenCount ?? 'unknown',
    );
    // Real compaction just happened in the runtime — sync our debounce
    // state so we don't try to trigger again immediately.
    state.lastCompressionAt = Date.now();
    state.lastMessageCount = event?.messageCount ?? state.lastMessageCount;
  });

  api.logger.info('[clawx-enhance:pico] ready (ContextEngine clawx-pico + observe hooks)');
} catch (e) {
  api.logger.warn('[clawx-enhance:pico] not loaded: %s', e.message);
}

  api.logger.info('[clawx-enhance] Plugin initialized successfully');
}
