## 1. `turn-injection-budget.ts` — the ledger module

`C:/Users/27933/Desktop/clawx/ClawX-maturity-p0/openclaw_runtime/src/context-engine/turn-injection-budget.ts` (289 lines)

**Exported API**
| symbol | line | note |
|---|---|---|
| `TURN_INJECTION_PRECEDENCE` | 39-47 | `["knowledge","working_memory","tool_registry","cvk_addition","vtoken","memory_pilot","other"]` |
| `TURN_INJECTION_CHAR_BUDGET` | 67 | `6000` (chars, flat pool, no per-channel sub-budgets) |
| `TURN_INJECTION_DROP_ALERT_RATIO` | 76 | `0.1` |
| `TurnInjectionDisposition` | 87 | `"applied" \| "truncate" \| "drop" \| "skip"` |
| `precedenceIndexOf` | 125 | unknown channels sort last |
| `beginTurnInjectionBudget({turnId,total?,killed?})` | 137 | idempotent per turnId — returns existing ledger if present; `killed:true` ⇒ `createInjectionBudget(0)` |
| `getTurnInjectionBudget` | 156 | |
| `chargeTurnInjection(ledger, channel, text)` | 167 | returns `ApplyBudgetResult`; caller MUST inject exactly `result.text` |
| `skipTurnInjection` | 210 | |
| `summarizeTurnInjection` | 224 | |
| `endTurnInjectionBudget(turnId)` | 272 | summarize → `ledgers.delete` → `dcsObservability.recordTurnInjectionAccounting` |
| `resetTurnInjectionBudgetsForTests` | 286 | |

**Counters/accounting type, verbatim (lines 106-120):**

```ts
export type TurnInjectionAccounting = {
  turnId: string;
  total: number;
  charsApplied: number;
  charsRequested: number;
  charsDropped: number;
  charsTruncated: number;
  remaining: number;
  dropRatio: number;
  alert: boolean;
  killed: boolean;
  byChannel: Record<string, { requested: number; applied: number; disposition: TurnInjectionDisposition }>;
  /** Channels that degraded, in the order they were charged. */
  degradationOrder: Array<{ channel: TurnInjectionChannel; disposition: "truncate" | "drop" }>;
};
```

Sum identity (lines 232-249): `charsDropped += entry.charsRequested` for drops, `charsTruncated += requested - applied` for truncates ⇒ **`charsApplied + charsDropped + charsTruncated === charsRequested` exactly**. `dropRatio = (dropped+truncated)/total`; `alert = dropRatio > 0.1` (line 264).

`degradationOrder` is push-ordered by charge sequence, **not** sorted by precedence — it only matches `TURN_INJECTION_PRECEDENCE` if callers happen to charge in precedence order. In production they do not (see §3).

## 2. `attempt.ts` — turn id and budget close

`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`

- imports: **lines 240-244** (`beginTurnInjectionBudget`, `chargeTurnInjection`, `endTurnInjectionBudget`)
- `injectionTurnId` generation: **lines 1993-1995**
  ```ts
  const injectionTurnId = `${params.sessionKey ?? params.sessionId ?? "session"}::${
    params.runId ?? `attempt-${Date.now()}`
  }`;
  ```
- passed to orchestrator as `turnId`: **line 2001**
- `endTurnInjectionBudget(injectionTurnId);` — **line 5593**, inside the attempt's `finally` block (5589). **Exactly one call site. Its return value is discarded**, so `byChannel` / `degradationOrder` / `dropRatio` for a given turn are never surfaced anywhere — only the aggregate counters survive, via observability.

## 3. The 4 injection sources — only 2 actually charge the ledger

| # | channel | call site | mechanism |
|---|---|---|---|
| 1 | `memory_pilot` | `context-orchestrator.ts:316` | `chargeAppendedSegment(turnLedger, "memory_pilot", result, before)` → `chargeTurnInjection` at `context-orchestrator.ts:209` |
| 2 | `vtoken` | `context-orchestrator.ts:360` | same helper, `"vtoken"` |
| 3 | `cvk_addition` | `attempt.ts:3273` | `chargeTurnInjection(cvkLedger, "cvk_addition", assembled.systemPromptAddition).text` — ledger obtained by `beginTurnInjectionBudget({turnId: injectionTurnId, killed: suppressCvkAddition})` at 3267-3270 |
| 4 | `knowledge` / `working_memory` / `tool_registry` | `assembler.ts:417 / 315 / 356` | **`applyInjectionBudget(budget, injection, <channel>)` — NOT `chargeTurnInjection`** |

**Two defects here, both material to FP-P1-11's acceptance criteria:**

**(a) The DCS assembler channels never enter the ledger's books.** `assembler.ts:191-196` picks `turnLedger.budget` as its `InjectionBudgetState` when a `turnId` is present, then `#appendWorkingMemory` / `#appendToolRegistry` / `#appendKnowledge` call `applyInjectionBudget` directly. That mutates `ledger.budget.used` but never pushes a `TurnInjectionEntry`. So those injections consume the shared pool invisibly: `summarizeTurnInjection` reports `charsApplied` short of the real prompt growth, and `remaining` (line 262) disagrees with the entry sum. Acceptance criterion "`appliedChars` 与 prompt 实际增长一致" cannot hold whenever a DCS channel injects.

**(b) `turnId` never reaches the Assembler in production, so those channels aren't even on the shared pool.** Chain:
- `attempt.ts:3233` → `assembleAttemptContextEngine` = `assembleHarnessContextEngine`, `openclaw_runtime/src/agents/harness/context-engine-lifecycle.ts:71-103` — its params type has no `turnId` and its `contextEngine.assemble({...})` call (line 89) forwards none.
- The only production `Assembler.assemble` call site is `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts:245-249`:
  ```ts
  const result = await assembler.assemble(
    { session_id: sessionId },
    { existing_output: messages },
    { [contextBlockFlagNameForSourceSystem("working-memory")]: true },
  );
  ```
  No `turnId`, no `cfg`. So `request.turnId` is always `undefined` ⇒ `turnLedger` undefined ⇒ `createInjectionBudget(KNOWLEDGE_INJECTION_CHAR_BUDGET)` (assembler.ts:196), a **private 2000-char budget** disjoint from the turn's 6000-char pool.

Net: in a real turn today at most **3 channels** can appear in `byChannel` (`memory_pilot`, `vtoken`, `cvk_addition`), and both orchestrator channels are gated behind flags that are off by default (`isMemoryPilotEnabled` orchestrator:154, `isVtokenAssemblyEnabled` orchestrator:165). To satisfy "≥2 来源出现在 byChannel" the test must enable memory inject pilot **and** VToken assembly — turning on `working-memory`/`tool-registry` (the W5 recipe) charges nothing to the ledger.

Also note precedence-order inversion: charge order in a real turn is memory_pilot (316) → vtoken (360) → cvk_addition (3273), i.e. indices 5 → 4 → 3, the exact reverse of `TURN_INJECTION_PRECEDENCE`. The degradation-order assertion will see the *earliest-charged, lowest-precedence* source win the budget.

## 4. `dcs-observability.ts` — counters and readout

`openclaw_runtime/src/context-engine/dcs-observability.ts`

- Snapshot fields **lines 43-50** (`turnInjectionTurns`, `turnInjectionKilledTurns`, `turnInjectionAppliedChars`, `turnInjectionRequestedChars`, `turnInjectionDroppedChars`, `turnInjectionTruncatedChars`, `turnInjectionDropAlerts`); zeroed at 77-83.
- `recordTurnInjectionAccounting(params)` **lines 175-194** — takes only `{killed, charsApplied, charsRequested, charsDropped, charsTruncated, alert}`. **`byChannel` and `degradationOrder` are dropped on the floor here** — they are not stored in any counter.
- `snapshot()` **line 212**; `reset()` **line 267**; `writeSoakSnapshot(targetDir)` **line 237** (explicitly never auto-called by the runtime — header comment lines 8-12).

**Readout path (there is exactly one, and it is an RPC):**

`openclaw_runtime/src/context-engine/runtime-flag-ack.ts:275-291`
```ts
function readInjectionBudgetEvidence(): RuntimeFlagAckPayload["injectionBudget"] {
  const counters = dcsObservability.snapshot();
  return {
    totalChars: TURN_INJECTION_CHAR_BUDGET,
    precedence: [...TURN_INJECTION_PRECEDENCE],
    dropAlertRatio: TURN_INJECTION_DROP_ALERT_RATIO,
    counters: {
      turns: counters.turnInjectionTurns,
      killedTurns: counters.turnInjectionKilledTurns,
      appliedChars: counters.turnInjectionAppliedChars,
      requestedChars: counters.turnInjectionRequestedChars,
      droppedChars: counters.turnInjectionDroppedChars,
      truncatedChars: counters.turnInjectionTruncatedChars,
      dropAlerts: counters.turnInjectionDropAlerts,
    },
  };
}
```
Attached as `injectionBudget` in `buildRuntimeFlagAck` (runtime-flag-ack.ts:377); payload type declared at lines 121-134. Served by gateway method **`runtime.flags.ack`** — handler `openclaw_runtime/src/gateway/server-methods/runtime-flag-ack.ts:21-39`, registered `openclaw_runtime/src/gateway/server-methods.ts:368`, scope `operator.read` (`openclaw_runtime/src/gateway/methods/core-descriptors.ts:25`).

Counters are **cumulative for the child's lifetime and there is no reset RPC** — a test must snapshot before/after and diff, or use a fresh child.

## 5. E2E evidence block — how the counters are read out of the child

`tests/e2e/runtime-launch-contract-fp-p0.spec.ts`. The child is reached via `hostInvoke(app, 'gateway', 'rpc', ...)` at **lines 170-174**:

```ts
      const ack = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack',
        params: {},
        timeoutMs: 30_000,
      });
```

The `injectionBudget` block, **lines 211-243**:

```ts
      // ---- FP-P0-05 G3: the shared injection budget is live in the child ----
      const budget = ack.injectionBudget as {
        totalChars?: number;
        precedence?: string[];
        dropAlertRatio?: number;
        counters?: Record<string, number>;
      };
      expect(budget.totalChars).toBeGreaterThan(0);
      // Declared precedence, correctness-bearing context first, enrichment last.
      expect(budget.precedence?.[0]).toBe('knowledge');
      expect(budget.precedence).toContain('cvk_addition');
      expect(budget.precedence).toContain('vtoken');
      expect(budget.precedence).toContain('memory_pilot');
      expect(budget.dropAlertRatio).toBeGreaterThan(0);
      // Counters must be summable: applied + dropped + truncated <= requested.
      const counters = budget.counters ?? {};
      for (const key of [
        'turns',
        'killedTurns',
        'appliedChars',
        'requestedChars',
        'droppedChars',
        'truncatedChars',
        'dropAlerts',
      ]) {
        expect(typeof counters[key], `budget counter ${key} missing`).toBe('number');
      }
      expect(
        (counters.appliedChars ?? 0) + (counters.droppedChars ?? 0) + (counters.truncatedChars ?? 0),
      ).toBeLessThanOrEqual(counters.requestedChars ?? 0);

      // eslint-disable-next-line no-console -- evidence line for the task's Test/evidence block
      console.log('[fp-p0-05-budget]', JSON.stringify(budget));
```

Note the sum assertion is `<=`, not `===`. Per §1 the identity is exact, so FP-P1-11 should tighten this to `===` — that is precisely the assertion that would catch defect (a).

## 6. Observing real prompt growth

**No dedicated hook exists** for "how much did injection grow the prompt." Three partial surfaces, one usable:

1. **`context.assembled` diagnostic event** — emitted `attempt.ts:4404-4425` with `systemPromptChars: systemLen` (defined 4400, `systemPromptText?.length ?? 0`) and `promptChars: promptLen` (4401). Type at `openclaw_runtime/src/infra/diagnostic-events.ts:551-569`. These are **absolute totals, not deltas**, and they include base prompt + skills + everything else — you cannot subtract injections out of them. It reaches the Electron side only via `diagnostics.stability` aggregation (`openclaw_runtime/src/logging/diagnostic-stability.ts:344-352`), which flattens it to `record.bytes = event.promptChars`.

2. **`getLastContextOrchestratorLineage()`** — `context-orchestrator.ts:109-111`, returns a `structuredClone` of the last lineage including `totalCharsAdded` (computed 375: `(result?.length ?? 0) - baseLen`, i.e. the true post-charge growth for memory+vtoken) and per-source `chars`. This is the closest thing to a ground-truth growth number, but it is **process-local with no RPC/probe** and covers only 2 of the channels.

3. **The mock provider's request recorder — this is the viable path.** `openclaw_runtime/extensions/qa-lab/src/providers/mock-openai/server.ts` records every `/v1/responses` body at **3490-3509** (including `instructions`, `allInputText`, `input`, `tools`) and serves them at **3430-3433** (`GET /debug/requests`). The W5 spec already consumes it (`tests/e2e/dcs-production-wiring-w5.spec.ts:61-66`, `readProviderRequests`). Since the prompt actually sent to the model is captured verbatim outside the child, an A/B run (injections on vs. kill-switch on, same scripted prompt) yields a real byte delta on `instructions` + `input` that can be compared against `counters.appliedChars`. That is the only mechanism in this repo that can honestly satisfy the "`appliedChars` 与 prompt 实际增长一致" criterion.

**Blocking gap for the task's remaining criteria:** `byChannel` and `degradationOrder` have **no out-of-process readout at all** — dropped by `recordTurnInjectionAccounting` (§4) and discarded at `attempt.ts:5593` (§2). Criteria "同一 turn 内 ≥2 个来源出现在 byChannel" and "超预算场景下降级顺序与 TURN_INJECTION_PRECEDENCE 一致" cannot be asserted from an E2E until either the ack payload carries per-channel detail or `endTurnInjectionBudget`'s return is routed somewhere observable.