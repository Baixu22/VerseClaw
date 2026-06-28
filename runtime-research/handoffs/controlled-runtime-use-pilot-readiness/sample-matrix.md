# Controlled Pilot Sample Matrix

Fail-closed target: 100 percent.

Every sample defines input, expected output, failure mode, boundary assertion, and evidence source. AST and Registry samples are independent; no sample requires the other pilot to be enabled.

| ID | Pilot | Coverage | Input | Expected output | Failure mode | Boundary assertion | Evidence source |
|---|---|---|---|---|---|---|---|
| AST-01 | AST | success candidate | TS target with `legacy($VALUE)` and valid fix | Ordered readonly candidate with match evidence | none | Candidate is diagnostics-only, no apply | AST readonly scan tests |
| AST-02 | AST | no match | Valid rule against target without match | Empty matches with bounded diagnostic | fail closed no candidate | No completion evidence from zero matches | AST readonly scan tests |
| AST-03 | AST | invalid rule | Missing pattern or invalid language | Validation error, no scan | fail closed invalid rule | No helper proceeds to mutation | AST rule validation tests |
| AST-04 | AST | overbroad pattern | Pattern that matches too much source | Overbroad diagnostic, no usable candidate | fail closed overbroad pattern | Human/runtime authority not granted | AST rule validation tests |
| AST-05 | AST | unbound metavariable | Fix references unbound metavariable | Validation error, no candidate | fail closed unbound metavariable | No candidate text emitted | AST rule validation tests |
| AST-06 | AST | overlapping ranges | Two candidate edits overlap | Conflict diagnostic | fail closed overlapping ranges | No preview treated as apply plan | AST resume drift tests |
| AST-07 | AST | resume drift | Checkpoint hash/range changes before resume | Drift diagnostic and replan required | fail closed resume drift | No stale candidate may apply | AST resume drift tests |
| AST-08 | AST | preview diff disabled | Valid fix with preview flag omitted | Matches only, no preview diff | fail closed for diff-dependent flow | Preview diff disabled by default | AST contracts tests |
| AST-09 | AST | budget/limit exceeded | More matches/diagnostics than configured limit | Bounded diagnostics and omitted count | fail closed budget/limit exceeded | No unbounded candidate output | AST readonly scan tests |
| AST-10 | AST | unsupported target | Non-TS/TSX target language | Invalid target diagnostic | fail closed unsupported target | No runtime fallback transport | AST readonly scan tests |
| AST-11 | AST | invalid target input | Missing file path or content | Invalid input diagnostic | fail closed invalid target | Caller-owned input required | AST readonly scan tests |
| AST-12 | AST | TSX success candidate | TSX snippet with valid readonly rule | Ordered candidate evidence | none | Still readonly and local | AST readonly scan tests |
| AST-13 | AST | multi-file order | Multiple explicit in-memory targets | Stable file/match order | none | No workspace discovery | AST readonly scan tests |
| AST-14 | AST | gated-off behavior | Empty config for readonly scan | Skipped result and no matches | fail closed gated-off behavior | Default-off by omission | Boundary sentinel test |
| AST-15 | AST | renderer bypass sentinel | Renderer pages/components scanned | No direct IPC/Gateway match | fail closed if renderer bypass found | Renderer cannot call AST route | Boundary scan |
| AST-16 | AST | runtime authority sentinel | TaskLoop/Gateway/provider strings scanned in planner source | No implementation match | fail closed authority drift | No TaskLoop/Gateway/provider transport authority | Boundary sentinel test |
| REG-01 | Registry | success candidate | Explicit collector diagnostics with enabled flag | Bounded diagnostics output | none | Diagnostics-only metadata/evidence | Registry collector tests |
| REG-02 | Registry | no diagnostics | Enabled collector with no input diagnostics | Empty diagnostics output | none | No provider/tool authority appears | Registry collector tests |
| REG-03 | Registry | registry provider exception | Provider throws during diagnostic collection | `provider_exception` diagnostic | fail closed provider exception | Exception does not alter legacy result | Tool registry tests |
| REG-04 | Registry | unsupported MCP content | MCP tool returns unsupported content | `unsupported_content` diagnostic | fail closed unsupported MCP content | MCP response shape unchanged | MCP API tests |
| REG-05 | Registry | denied tool outcome | Policy denies a tool result | `policy_denied` diagnostic | fail closed denied outcome | Approval semantics unchanged | Tool registry tests |
| REG-06 | Registry | waiting tool outcome | Policy waits for approval | `policy_waiting` diagnostic | fail closed waiting outcome | Waiting semantics unchanged | Tool registry tests |
| REG-07 | Registry | cancelled-like tool outcome | Tool cancellation result | `tool_cancelled` diagnostic | fail closed cancelled-like outcome | No retry/completion authority | Tool registry tests |
| REG-08 | Registry | tool error outcome | Tool returns normalized error | `tool_error` diagnostic | fail closed tool error | Legacy error mapping unchanged | Tool registry tests |
| REG-09 | Registry | missing injected diagnostics | TaskLoop receives no injected diagnostics | No shadow metadata emitted | fail closed missing injected diagnostics | TaskLoop defaults unchanged | TaskLoop tests |
| REG-10 | Registry | invalid injected diagnostics | Malformed/oversized diagnostics input | Dropped or bounded diagnostic | fail closed invalid injected diagnostics | No authority from bad input | Registry collector tests |
| REG-11 | Registry | gated-off behavior | Collector flag omitted | Disabled output, diagnostics omitted | fail closed gated-off behavior | Default-off by omission | Boundary sentinel test |
| REG-12 | Registry | provider ordering sensitive case | Default provider order compared with/without collector docs | No ordering drift | fail closed if drift > 0 | Provider ordering remains authoritative legacy behavior | Context provider tests |
| REG-13 | Registry | renderer bypass sentinel | Renderer pages/components scanned | No direct IPC/Gateway match | fail closed renderer bypass | Renderer cannot bypass host-api/Gateway policy | Boundary scan |
| REG-14 | Registry | diagnostic persistence sentinel | Registry touched files scanned for persistence terms | No implementation persistence match | fail closed persistence drift | In-memory/test-owned only | Boundary scan |
| REG-15 | Registry | service/listener sentinel | Touched production files scanned for service/listener/database | No implementation match | fail closed service/listener drift | No second runtime or daemon | Boundary scan |
| REG-16 | Registry | budget/limit exceeded | More diagnostics than collector limit | Bounded diagnostics and omitted count | fail closed budget/limit exceeded | No unbounded diagnostic output | Registry collector tests |
