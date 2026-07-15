# DCS 瑙勮寖涓庨樁娈?0 瀹炵幇绱㈠紩

**鐢ㄩ€?*锛歐orking Context 脳 Memory 缁熶竴璁捐绾︽潫瑙勮寖锛圖CS锛夌殑澶氳疆瀵规姉瀹￠槄涓庨樁娈?0 瀹炵幇绱㈠紩銆?

**鏈€鍚庢洿鏂?*锛?026-07-14
**褰撳墠鐘舵€?*锛歷1.6 宸叉敹鏁涳紙鑷村懡闂 0锛夛紝v1.6.1 姝ｅ紡澧炶ˉ宸叉敹缂栵紱闃舵 0
鎺ュ彛灞備笌 Stage 1 working-memory 宸插湪 main 鏀跺彛锛圧1 COMPLETE锛夛紱R2 producer
envelope vertical slice 宸插湪 main 鏀跺彛锛圧2 COMPLETE锛夛紱R3 Stage 2 task state
adapter 涓?child-session handoff 宸插湪 main 鏀跺彛锛圧3 COMPLETE锛夛紱R4 Stage 3
tool_registry Block producer 涓?Assembler injection 宸插湪 main 鏀跺彛锛圧4 COMPLETE锛夛紱
R5 Stage 4 knowledge Block 缁熶竴锛坈ompass + role-memory锛夊凡鍦?main 鏀跺彛
锛圧5 COMPLETE锛夛紱R6 Stage 5 SEKB 钂搁鍥炲啓 closure + T1 provider-registry pilot
disposition 宸插湪 main 鏀跺彛锛圧6 COMPLETE锛夈€?
**DCS all stages complete. T 绯诲垪锛圱0/T1/T2/T3锛夊凡鍦?main 鏀跺彛锛堣 DCS-T0..T3-ACCEPTANCE锛夈€?* DCS working-memory infrastructure ready; production
producer coverage = 3/3锛坋dit/write/apply_patch 鍧囧凡浜у嚭 `details.working_memory`
envelope锛夛紱task_state adapter + child handoff + direct-parent authorization +
terminal-phase SEKB trajectory capture 宸插氨浣嶏紱tool_registry Block producer +
Assembler injection 宸插氨浣嶏紙flag-gated, default off锛夛紱knowledge Block 缁熶竴
锛坈ompass + role-memory 涓ゆ潯璺緞锛夊凡灏变綅锛坒lag-gated, default off锛夛紱SEKB
experience Block 鍐欏洖妗ユ帴 + context_search/context_write 宸ュ叿宸插氨浣?
锛坆est-effort, ANTI-7/ANTI-8 enforced锛夛紱T1 provider-registry pilot 宸插垹闄わ紝
15 涓祴璇曟枃浠跺凡杩佺Щ鍒?test-only 姝ｅ紡 registry 鏋勯€?helper銆?

---

## 鏂囨。娓呭崟

### 瑙勮寖鐗堟湰

| 鏂囦欢 | 鐗堟湰 | 璇存槑 |
|------|------|------|
| [dcs-v1.0-spec.md](./dcs-v1.0-spec.md) | v1.0 | 鍘熷璁捐瑙勮寖锛宎gent 缁欏嚭鐨勬湭鏉ヨ璁¤鑼?|
| [dcs-v1.1-spec.md](./dcs-v1.1-spec.md) | v1.1 | 鎺ュ彈 v1.0 瀹￠槄鍏ㄩ儴 10 鏉℃剰瑙?|
| [dcs-v1.2-spec.md](./dcs-v1.2-spec.md) | v1.2 | 淇 HandoffPack銆乻ession 璋撹瘝銆丼SP銆乻ink 鏃舵満鍜?notes 鍙鎬?|
| [dcs-v1.3-spec.md](./dcs-v1.3-spec.md) | v1.3 | 淇鍏变韩 main 璋撹瘝銆侀噸澶?agent_end 涓?Assembler 杈撳叆濂戠害 |
| [dcs-v1.4-spec.md](./dcs-v1.4-spec.md) | v1.4 | 闂悎浠诲姟鐘舵€併€乽psert銆佸噯鍏ヤ簨瀹炰笌 mutability 濂戠害 |
| [dcs-v1.5-spec.md](./dcs-v1.5-spec.md) | v1.5 | 闂悎淇濈暀绛栫暐銆佸叕寮€ API銆乲nowledge 鍑嗗叆涓庤法 session 鎺堟潈 |
| [dcs-v1.6-spec.md](./dcs-v1.6-spec.md) | v1.6 | 缁熶竴 Assembler handler API锛涙渶缁堟敹鏁涚増鏈?|
| [dcs-v1.6.1-addendum.md](./dcs-v1.6.1-addendum.md) | v1.6.1 | 涓?flag 涓庡懡鍚嶇粺涓€銆佷复鏃舵姇褰?exactly-once銆佽瘹瀹炴姤鍛娿€乵ainKey銆乸ilot 澶勭疆涓庡弻娉ㄥ叆棰勭畻 |

### 瀹￠槄鎰忚

| 鏂囦欢 | 瀹￠槄瀵硅薄 | 鍙戠幇闂鏁?| 鑷村懡鏁?|
|------|---------|-----------|--------|
| [dcs-v1.0-review.md](./dcs-v1.0-review.md) | v1.0 | 10 | 3 |
| [dcs-v1.1-review.md](./dcs-v1.1-review.md) | v1.1 淇鐗?| 5锛? 鏂板 + 2 娆¤锛?| 2 |
| [dcs-v1.2-review.md](./dcs-v1.2-review.md) | v1.2 淇鐗?| 3 | 3 |
| [dcs-v1.3-review.md](./dcs-v1.3-review.md) | v1.3 淇鐗?| 4 | 4 |
| [dcs-v1.4-review.md](./dcs-v1.4-review.md) | v1.4 淇鐗?| 3 | 3 |
| [dcs-v1.5-review.md](./dcs-v1.5-review.md) | v1.5 淇鐗?| 1 | 1 |
| [dcs-v1.6-review.md](./dcs-v1.6-review.md) | v1.6 鏈€缁堢増 | 0 | 0 |

---

## 瀵规姉瀹￠槄鍘嗗彶

### 绗?1 杞紙v1.0 鈫?v1.1锛?

**瀹￠槄鏂?*锛氫富 agent锛堝鎶楁€ф€濈淮锛?
**琚鏂?*锛氬師濮?DCS-v1.0 瑙勮寖
**缁撴灉**锛氬彂鐜?10 涓棶棰橈紙3 鑷村懡 + 4 涓瓑 + 3 娆¤锛夛紝v1.1 鍏ㄩ儴鎺ュ彈骞朵慨璁?

**v1.0 鑷村懡闂**锛?
1. Block 娌℃湁鍑嗗叆闂ㄦ锛?浠€涔堥兘寰€閲屽"闂锛?
2. HookBus 涓庣幇鏈?3 濂?hook 鏈哄埗閲嶅彔
3. Assembler 杩佺Щ璺緞浜嬪疄閿欒锛坄computeMemoryExtraSystemPrompt` 鏂囦欢浣嶇疆閿欒锛?

### 绗?2 杞紙v1.1 鈫?v1.2锛?

**瀹￠槄鏂?*锛氫富 agent锛堝鎶楁€ф€濈淮 + 浠ｇ爜浜嬪疄楠岃瘉锛?
**琚鏂?*锛欴CS-v1.1 淇鐗?
**缁撴灉**锛氬彂鐜?5 涓柊闂锛? 鑷村懡 + 1 涓瓑 + 2 娆¤锛夛紝淇杩囩▼涓紩鍏?

**v1.1 鏂拌嚧鍛介棶棰?*锛?
- A. HandoffPack 閫氳繃 extra 瀛楃涓叉敞鍏ユ槸鏋舵瀯鍊掗€€锛岃繚鍙?[P1]
- B. session_id 姝ｅ垯涓庡疄闄呮牸寮忎弗閲嶄笉鍖归厤锛堟紡鎺夋墍鏈夊娈?key锛?

**v1.1 涓瓑闂**锛?
- C. SSP 涓嶅寘鍚?evidence_summary锛孾P4] 鐨?compression_depth 鎺ㄧ悊鍩轰簬閿欒鍋囪

### 绗?3 杞紙v1.2 鈫?v1.3锛?

**缁撴灉**锛氫笂涓€杞?A-E 宸插叏閮ㄤ慨澶嶏紱鏂板鍙戠幇 3 涓疄鐜伴樆濉為棶棰橈紝淇 v1.3銆?

- 鍏变韩 `isMainSessionKey` 璋撹瘝灏氫笉瀛樺湪
- `agent_end` 宸插瓨鍦紝涓嶅簲閲嶅鏂板
- Assembler 缂哄皯 legacy builder 瀹屾暣杈撳叆濂戠害

### 绗?4 杞紙v1.3 鈫?v1.4锛?

**缁撴灉**锛氳矾鐢变笌 pass-through 宸蹭慨澶嶏紱BlockStore 鍜岀被鍨嬪眰浠嶆湁 4 涓疄鐜伴樆濉為棶棰橈紝淇 v1.4銆?

### 绗?5 杞紙v1.4 鈫?v1.5锛?

**缁撴灉**锛氬啓鍏ヨ涔夐棴鍚堬紱淇濈暀绛栫暐涓庡叕寮€ API 浠嶆湁 3 涓疄鐜伴樆濉為棶棰橈紝淇 v1.5銆?

### 绗?6 杞紙v1.5 鈫?v1.6锛?

**缁撴灉**锛氬瓨鍌ㄣ€佸噯鍏ャ€佹巿鏉冦€佺被鍨嬪拰 hook 濂戠害宸查棴鍚堬紱淇鏈€鍚?1 涓?Assembler handler API 鑷村懡鐭涚浘銆?

### 鏈€缁堝闃咃紙v1.6锛?

**缁撴灉**锛氳嚧鍛介棶棰?0锛屼腑绛夐棶棰?0锛岄樆濉為樁娈?0 鐨勬湭鍐抽」 0銆侱CS 瑙勮寖姝ｅ紡鏀舵暃銆?

---

## 闃舵 0 瀹炵幇

闃舵 0 鎺ュ彛灞傚凡瀹炵幇锛岄粯璁ゅ叧闂袱涓?feature flag锛屼繚鎸佺幇鏈夎繍琛岃矾寰勪笉鍙樸€?

| 浜や粯鐗?| 璺緞 |
|--------|------|
| ContextBlock 绫诲瀷涓庢帴鍙?| `openclaw_runtime/src/context-engine/block.ts` |
| SQLite BlockStore | `openclaw_runtime/src/context-engine/block-store.ts` |
| HookContext sink 鎵╁睍 | `openclaw_runtime/src/agents/harness/hook-context.ts` |
| Hook 浜嬩欢涓?harness 璋冨害鎵╁睍 | `openclaw_runtime/src/plugins/hook-types.ts`銆乣openclaw_runtime/src/plugins/hooks.ts`銆乣openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts` |
| Assembler pass-through | `openclaw_runtime/src/context-engine/assembler.ts` |

瀵瑰簲鍗曞厓娴嬭瘯浣嶄簬 `openclaw_runtime/src/context-engine/*.test.ts` 鍜?`openclaw_runtime/src/agents/harness/dcs-stage0-hooks.test.ts`銆?

---

## Stage 1 瀹炵幇锛坵orking-memory锛孯1 鏀跺彛锛?

Stage 1 浜?2026-07-12 鍦?main 鍒嗘敮鏀跺彛锛圖CS-ROUND1-COMPLETE锛夈€傞粯璁ゅ叧闂?
锛坄runtime.contextBlock.working-memory.enabled` 缂虹渷涓?false锛宖lag-off 涓哄紩鐢ㄧ骇
identity pass-through锛岄浂 BlockStore 鏋勯€?鏌ヨ/鍐欏叆锛夈€?

| 浜や粯鐗?| 璺緞 |
|--------|------|
| working-memory handler锛堢獥鍙ｅ悎骞?浜旀潯涓婇檺/纭畾鎬ф窐姹帮級 | `openclaw_runtime/src/context-engine/handlers/working-memory-handler.ts` |
| context_blocks / block_entity_map schema | `openclaw_runtime/src/state/openclaw-state-schema.sql` |
| tool_result + context 鍙?hook 鎺ョ嚎锛圫1-B 鍚?attempt 涓茶鍖栭槦鍒楋級 | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts` |
| kebab/snake flag 鍞竴鏄犲皠鍑芥暟锛堝琛?1锛?| `openclaw_runtime/src/context-engine/assembler.ts` `contextBlockFlagNameForSourceSystem` |
| exactly-once 娉ㄥ叆鎶ゆ爮锛堝琛?2锛?| `openclaw_runtime/src/context-engine/assembler.ts`锛坄## Recent Actions` 鎭板ソ 0/1 娆★級 |
| config 闈紙strict schema/labels/help/types锛?| `openclaw_runtime/src/config/*` |
| attempt 娑堣垂 factory锛坰ession 韬唤鎺ョ嚎锛?| `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` |

璇氬疄澹版槑锛?*DCS working-memory infrastructure ready; production producer
coverage = 0** 鈥斺€?runtime 涓皻鏃犱换浣曠敓浜ц€呬骇鍑?`details.working_memory`锛?
娴嬭瘯涓殑鍚堟垚 envelope 涓嶄唬琛ㄧ湡瀹?coding 澧炵泭銆?

---

## Stage 1 Producer Envelope锛圧2 鏀跺彛锛?

R2 浜?2026-07-12 鍦?main 鍒嗘敮鏀跺彛锛圖CS-ROUND2-COMPLETE锛夈€俻roduction
mutation tools锛坋dit/write/apply_patch锛夊湪鎴愬姛璺緞涓婃樉寮忎骇鍑?
`details.working_memory` envelope锛宻hape 涓?
`{ result_summary: string (鈮?00 chars), significance: "high" }`銆?
澶辫触/閮ㄥ垎鎭㈠璺緞涓嶅彂 envelope銆俽ead 绛夐潪 mutation 宸ュ叿涓嶅彂 envelope銆?

| 浜や粯鐗?| 璺緞 |
|--------|------|
| WorkingMemoryEnvelope 绫诲瀷 + WriteToolDetails | `openclaw_runtime/src/agents/sessions/tools/tool-contracts.ts` |
| edit producer envelope锛坰uccess path锛?| `openclaw_runtime/src/agents/sessions/tools/edit.ts` |
| write producer envelope锛坰uccess path锛?| `openclaw_runtime/src/agents/sessions/tools/write.ts` |
| apply_patch producer envelope锛坰uccess path锛?| `openclaw_runtime/src/agents/apply-patch.ts` |
| RED鈫扜REEN producer envelope 娴嬭瘯 | `openclaw_runtime/src/agents/dcs-producer-envelope.test.ts` |
| characterization test 鏇存柊 | `openclaw_runtime/src/agents/agent-tools.read.characterization.test.ts` |

璇氬疄澹版槑锛?*production producer coverage = 3/3**锛坋dit/write/apply_patch锛夈€?
envelope 閫氳繃 `wrapToolParamValidation` pass-through 瑕嗙洊 host + sandbox 鍙樹綋銆?
workspace authority propagation銆乻ession-workspace binding銆乵atched off/on
replay evidence 鐢?R3 浜や粯銆?

---

## Stage 2 Task State Adapter 涓?Child-Session Handoff锛圧3 鏀跺彛锛?

R3 浜?2026-07-12 鍦?main 鍒嗘敮鏀跺彛锛圖CS-ROUND3-COMPLETE锛夈€俆askLoop phase
transition 鎸佷箙鍖栦竴涓?system-managed `task_state` Block锛沺arent 鍦?child
鍚姩鍓嶅皢 HandoffPack 鍐欏叆 child session key锛沜hild `before_agent_start` 閫氳繃
BlockStore 鎭㈠鐘舵€佸苟鎺ユ敹鍥哄畾 context_read 鎸囦护锛沝irect-parent authorization
楠岃瘉 requester + child HandoffPack parent_session_id + target锛涗粎 terminal phase
锛坈ompleted/failed锛夎Е鍙戜竴娆?SEKB trajectory capture銆?

| 浜や粯鐗?| 璺緞 |
|--------|------|
| task-loop handler锛坔andleTaskPhaseChange / buildChildHandoffPack / writeChildHandoffPack / restoreChildState / isTerminalPhase / CHILD_CONTEXT_READ_INSTRUCTION锛?| `openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts` |
| parseHandoffPack 瀵煎嚭锛堟巿鏉冧笌鎭㈠鍏辩敤楠岃瘉鍣級 | `openclaw_runtime/src/context-engine/block-store.ts` |
| task_phase_change hook 鎺ョ嚎 + terminal-phase SEKB trigger | `openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts` |
| buildTaskStateFactory锛坧arent-writes-before-spawn + before_agent_start restoration + context_read instruction锛?| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts` |
| RED鈫扜REEN task-loop handler 娴嬭瘯锛?6 tests锛?| `openclaw_runtime/src/context-engine/handlers/task-loop-handler.test.ts` |
| RED鈫扜REEN extension wiring 娴嬭瘯锛? tests锛?| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.task-state.test.ts` |
| RED鈫扜REEN terminal-phase SEKB 娴嬭瘯锛? tests锛?| `openclaw_runtime/src/knowledge/sekb/harness-integration.test.ts` |

璇氬疄澹版槑锛?*task_state adapter + child handoff + direct-parent authorization +
terminal-phase SEKB trajectory capture 宸插氨浣?*銆俤irect-parent authorization
瑕嗙洊 self / direct parent / arbitrary target / recursive ancestor / malformed
HandoffPack 浜旀潯璺緞銆俢ontext_read 鎸囦护涓哄浐瀹氬瓧绗︿覆锛屼笉鍚?HandoffPack JSON銆?
Block ids銆乼ranscript excerpt 鎴?raw tool output銆倀ool registry锛圡4b+M5a锛夈€?
knowledge unification锛圡5b锛夈€丼EKB closure锛圡6+T1锛夌敱 R4+ 浜や粯銆?

---

## Stage 3 Tool Registry Block Producer 涓?Assembler Injection锛圧4 鏀跺彛锛?

R4 浜?2026-07-12 鍦?main 鍒嗘敮鏀跺彛锛圖CS-ROUND4-COMPLETE锛夈€俙before_agent_start`
hook 浜у嚭涓€涓?system-managed `tool_registry` Block锛坄source_system="cvk"`锛?
`always_on=true`锛宍token_budget=200`锛宍priority=7`锛?
`on_demand={ expand_tool: "context_read", auto_register: true }`锛夈€侫ssembler
鐨?`#appendToolRegistry` 鎸?flag-guard + exactly-once + BlockStore-query 妯″紡
娉ㄥ叆 `## Tools (N available)` 鎽樿銆傜幇鏈?CVK
`ContextRuntimeKitContextEngine.assemble` 璺緞涓嶅彉锛汼tage 3 Block 璺緞涓哄苟琛岀殑
flag-gated producer銆侳eature flag `runtime.contextBlock.tool-registry.enabled`
缂虹渷涓?false銆?

| 浜や粯鐗?| 璺緞 |
|--------|------|
| tool-registry handler锛坆uildToolRegistryBlock / handleBeforeAgentStartToolRegistry / formatToolRegistryInjection锛?| `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts` |
| Assembler #appendToolRegistry + cvk flag mapping + exactly-once guard | `openclaw_runtime/src/context-engine/assembler.ts` |
| buildToolRegistryFactory锛坆efore_agent_start 鈫?ContextBlockSink锛?| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts` |
| config 闈紙strict schema/labels/help/types锛?| `openclaw_runtime/src/config/*` |
| RED鈫扜REEN handler 娴嬭瘯锛?2 tests锛?| `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.test.ts` |
| RED鈫扜REEN assembler 娴嬭瘯锛? new + 2 updated锛?| `openclaw_runtime/src/context-engine/assembler.test.ts` |
| RED鈫扜REEN extension wiring 娴嬭瘯锛? tests锛?| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts` |
| RED鈫扜REEN config 娴嬭瘯锛? tests锛?| `openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts` |

璇氬疄澹版槑锛?*tool_registry Block producer + Assembler injection 宸插氨浣?*
锛坒lag-gated, default off锛夈€倀oolEntries 鐢?factory closure 鍙傛暟浼犲叆锛屽綋鍓?
鏃?caller 浼犲叆鐪熷疄 tool list銆俴nowledge unification锛圡5b锛夈€丼EKB closure
锛圡6+T1锛夌敱 R5+ 浜や粯銆?

---

## Stage 4 Knowledge Block 缁熶竴锛圧5 鏀跺彛锛?

R5 浜?2026-07-12 鍦?main 鍒嗘敮鏀跺彛锛圖CS-ROUND5-COMPLETE锛夈€俢ompass锛坢ain
session锛夊拰 role-memory锛坰ubagent session锛変袱鏉¤矾寰勭粺涓€涓?`knowledge` Block
绫诲瀷銆備袱涓?handler 鍖呰鐜版湁 legacy builder锛坄buildPreReplyInjection` /
`buildContextPack`锛夛紝閫氳繃 `ContextBlockSink` 鍐欏叆 system-managed `knowledge`
Block銆侫ssembler 鐨?`#appendKnowledge` 鎸?flag-guard + exactly-once +
session-type-aware query + flag-aware source filtering 妯″紡娉ㄥ叆 `## Knowledge`
鎽樿銆侫NTI-3 寮哄埗锛歮ain 鍙煡 compass锛宻ubagent 鍙煡 role-memory銆備袱鏉¤矾寰勭殑
Block 鍧囦负 `always_on=false`锛宍on_demand.expand_tool="context_search"`锛?
`background=true`锛宍mutability="system_managed"`锛宍compression_depth=0`銆?
Feature flags `runtime.contextBlock.compass.enabled` 鍜?
`runtime.contextBlock.role_memory.enabled` 缂虹渷涓?false銆?

| 浜や粯鐗?| 璺緞 |
|--------|------|
| compass knowledge handler锛坆uildCompassKnowledgeBlock / handleCompassKnowledge / formatKnowledgeInjection锛?| `openclaw_runtime/src/context-engine/handlers/compass-handler.ts` |
| role-memory knowledge handler锛坆uildRoleMemoryKnowledgeBlock / handleRoleMemoryKnowledge锛?| `openclaw_runtime/src/context-engine/handlers/role-memory-handler.ts` |
| Assembler #appendKnowledge + flags + mainKey + char budget + exactly-once guard | `openclaw_runtime/src/context-engine/assembler.ts` |
| isMainSessionKey mainKey 鏀寔锛堝琛?4锛?| `openclaw_runtime/src/sessions/session-key-utils.ts` |
| config 闈紙strict schema/labels/help/types锛?| `openclaw_runtime/src/config/*` |
| RED鈫扜REEN compass handler 娴嬭瘯锛?0 tests锛?| `openclaw_runtime/src/context-engine/handlers/compass-handler.test.ts` |
| RED鈫扜REEN role-memory handler 娴嬭瘯锛? tests锛?| `openclaw_runtime/src/context-engine/handlers/role-memory-handler.test.ts` |
| RED鈫扜REEN assembler knowledge 娴嬭瘯锛?2 new tests锛?| `openclaw_runtime/src/context-engine/assembler.test.ts` |
| RED鈫扜REEN extension wiring 娴嬭瘯锛? tests锛?| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts` |
| RED鈫扜REEN config 娴嬭瘯锛? tests锛?| `openclaw_runtime/src/config/runtime-context-block-compass.test.ts`銆乣runtime-context-block-role-memory.test.ts` |

璇氬疄澹版槑锛?*knowledge Block 缁熶竴锛坈ompass + role-memory 涓ゆ潯璺緞锛夊凡灏变綅**
锛坒lag-gated, default off锛夈€俢ompass admission context 鍖呭惈 `verification_status`/
`confidence`/`audn_state` 浠ユ弧瓒?BlockStore 鍑嗗叆闂ㄧ銆係EKB closure锛圡6+T1锛?
鐢?R6 浜や粯銆?

---

## Stage 5 SEKB Closure + T1 Provider-Registry Pilot Disposition锛圧6 鏀跺彛锛?

R6 浜?2026-07-12 鍦?main 鍒嗘敮鏀跺彛锛圖CS-ROUND6-COMPLETE锛夈€俙DistillationTool.confirm_and_save`
鏂板鍙€夌涓夊弬鏁?`{ contextBlockSink?, sessionId? }`锛屽綋涓よ€呮彁渚涙椂 best-effort
鍐欏叆 `experience` Block 鍒?BlockStore锛坒ire-and-forget锛宻ink 澶辫触涓嶉樆濉?SEKB
淇濆瓨锛夈€俙experience-block-bridge.ts` 鎻愪緵绾嚱鏁?`buildExperienceBlock` +
`handleConfirmAndSave`銆俙context_search` 宸ュ叿鎸?搂绗叚绔犲疄鐜帮細瀹炰綋鎻愬彇 鈫?
`queryByEntity`锛圫AG mode锛夋垨 `query`锛坒allback_mode='vector_only'锛夆啋 top-K 鈮?5锛?
`query='principles'` 瑙﹀彂 `block_types=["experience"]` 杩囨护銆俙context_write`
宸ュ叿鎸?搂绗叚绔犲疄鐜帮細浠呭啓 `notes` Block锛坰ole agent_writable锛夛紝鎿嶄綔
append/replace/clear锛宺ole whitelist `planner`/`architect`/`implementer`
锛圓NTI-7 enforced via `Set<string>` membership锛夈€侫NTI-8 enforced锛?
`suggest_principles_from_trajectories` 鏃?sink 鍙傛暟锛宎dvisory 缁撴灉涓嶅啓 Block銆?
T1锛歚provider-registry.ts` 鐨?`createContextProviderRegistryPilot` 鍜?
`runContextProviderRegistryPilot` 鍙婁笓灞?orchestration 宸插垹闄わ紱15 涓祴璇曟枃浠惰縼绉?
鍒?test-only `RuntimeContextProviderRegistry` 鏋勯€?helper锛屼繚鐣欐湁鏁堣鐩栦笖鏃犵敓浜?
API 娉勬紡銆俙SourceSystem` union 鏂板 `"agent-notes"`銆?

| 浜や粯鐗?| 璺緞 |
|--------|------|
| SEKB 鈫?experience Block bridge锛坆uildExperienceBlock / handleConfirmAndSave锛?| `openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts` |
| context_search tool锛坋xtractEntities / searchContext锛?| `openclaw_runtime/src/context-engine/tools/context-search-tool.ts` |
| context_write tool锛坵riteContext / CONTEXT_WRITE_ROLE_WHITELIST锛?| `openclaw_runtime/src/context-engine/tools/context-write-tool.ts` |
| distillation-tool 鍙€?contextBlockSink + sessionId 鍙傛暟 | `openclaw_runtime/src/knowledge/sekb/distillation-tool.ts` |
| T1 pilot 鍒犻櫎 + test-only registry helper | `openclaw_runtime/src/context-engine/provider-registry.ts`, `tests/unit/helpers/context-provider-registry.ts` |
| SourceSystem += "agent-notes" | `openclaw_runtime/src/context-engine/block.ts` |
| RED鈫扜REEN experience-block-bridge 娴嬭瘯锛?4 tests锛?| `openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts` |
| RED鈫扜REEN context-search-tool 娴嬭瘯锛?0 tests锛?| `openclaw_runtime/src/context-engine/tools/context-search-tool.test.ts` |
| RED鈫扜REEN context-write-tool 娴嬭瘯锛?1 tests锛?| `openclaw_runtime/src/context-engine/tools/context-write-tool.test.ts` |

璇氬疄澹版槑锛?*SEKB experience Block 鍐欏洖妗ユ帴 + context_search/context_write 宸ュ叿
宸插氨浣?*锛坆est-effort, ANTI-7/ANTI-8 enforced锛夈€俆1 provider-registry pilot
宸插垹闄わ紝鐩稿叧娴嬭瘯宸茶縼绉诲埌姝ｅ紡 registry 鏋勯€?helper銆?*DCS v1.6 Stage 0-5
implementation is now complete.** 鎵€鏈?feature flag 缂虹渷涓?false锛岀瓑寰?flag-gated
activation 涓庡畬鏁村洖褰掕瘉鎹€俆3 CodeGraph unlock 宸插湪 main 瀹屾垚锛堣 DCS-T3-ACCEPTANCE锛夈€?

---

## T2 Encoding Hygiene And Structural Convergence

T2 keeps the Stage 1-5 DCS contracts unchanged while hardening the coding-tool
filesystem boundary:

- strict UTF-8/UTF-16 decoding with BOM-aware, encoding-preserving updates;
- physical CRLF/LF/CR and terminal-newline preservation for edit/apply_patch;
- real UTF-8 byte accounting for write;
- adaptive read paging without invented blank lines or lost truncation details;
- deterministic read/edit/write assembly with unchanged sandbox and
  workspace-root policy;
- an all-repository tracked Git-blob UTF-8 gate plus a tested, count-guarded
  U+FFFD allowlist.

The sessions SDK audit found no safe deletion: the large sessions modules have
live embedded-runner consumers and `plugin-sdk/agent-sessions.ts` remains a
public wildcard API. T2 therefore preserves that export surface.

---

## 瀹￠槄鍘熷垯

1. **瀵规姉鎬ф€濈淮**锛氫笉鍋囪瑙勮寖姝ｇ‘锛屼富鍔ㄦ壘婕忔礊
2. **浠ｇ爜浜嬪疄浼樺厛**锛氭墍鏈夊闃呮剰瑙佸繀椤诲熀浜庝唬鐮佷簨瀹烇紝涓嶈兘鍑┖鎺ㄧ悊
3. **涓嶄簤杈?*锛氳瀹℃柟鎺ュ彈鎰忚鐩存帴淇锛屼笉鍦ㄨ鑼冧腑涓洪敊璇京鎶?
4. **鑷村懡闂浼樺厛**锛氫换涓€鑷村懡闂鏈В鍐筹紝涓嶅紑濮嬮樁娈?0 瀹炵幇
5. **姣忚疆淇鍚庡繀椤诲瀹?*锛氫慨璁㈠彲鑳藉紩鍏ユ柊闂锛屾瘡杞慨璁㈠悗閮介渶瑕佸鎶楀闃?

---

## 鐩稿叧鍙傝€冩枃妗?

| 鏂囨。 | 璺緞 | 鐢ㄩ€?|
|------|------|------|
| 鍏ㄩ噺鏋舵瀯瀹¤ | [team/architecture-audit-full.md](../architecture-audit-full.md) | 1142 琛岋紝瑕嗙洊鏁翠釜浣撶郴鐨勪笁灞傛灦鏋?+ 瀛愮郴缁?+ 璋冪敤閾?+ 娌荤悊鐭╅樀 |
| CodeGraph 瑙掕壊鏋舵瀯鍦板浘 | [team/codegraph-role-architecture.md](../codegraph-role-architecture.md) | 80 琛岋紝5 涓尯鍩熺殑 Role/Agent/Memory 鏋舵瀯鍦板浘 |
| Role-First 璁捐鏂囨。 | [team/role-architecture-design/](../role-architecture-design/) | 6 涓枃浠讹紝Role-First 鏋舵瀯鐨勬潈濞佽璁℃枃妗?|
| DCS 鎬讳綋鎵ц缂栨帓璁″垝 | `C:\Users\27933\Desktop\clawx\team\claude\DCS-MASTER-EXECUTION-PLAN.md` | M0-M6 渚濊禆銆侀棬妲涗笌浜や粯缂栨帓 |
| DCS 杞娲惧崟鎵嬪唽 | `C:\Users\27933\Desktop\clawx\team\claude\DCS-ROUND-DISPATCH.md` | R1-R6 涓茶鎵ц銆侀獙鏀朵笌 handoff |

---


### T 绯诲垪楠屾敹锛堝熀绾?/ T1 / T2 / T3锛?

| 鏂囦欢 | 璇存槑 |
|------|------|
| [DCS-T0-BASELINE-ACCEPTANCE.md](./DCS-T0-BASELINE-ACCEPTANCE.md) | 鏍?lint/test 鍩虹嚎鎭㈠楠屾敹 |
| [DCS-T1-ACCEPTANCE.md](./DCS-T1-ACCEPTANCE.md) | provider-registry pilot 娓呯悊楠屾敹 |
| [DCS-T2-ACCEPTANCE.md](./DCS-T2-ACCEPTANCE.md) | encoding + structural convergence 楠屾敹 |
| [DCS-T3-ACCEPTANCE.md](./DCS-T3-ACCEPTANCE.md) | Electron CodeGraph 宸ュ叿瑙ｉ攣楠屾敹 |

## Wiring repair status (W1-W6, 2026-07-14)

**Infrastructure ready = TRUE. Stage 2/5 product revenue ready = FALSE** (flags default off; no Settings control plane).

| Window | Debt | Result |
|--------|------|--------|
| W1 | D2 phase producer + attempt DCS deps | live 鈥?[DCS-W1-COMPLETE.md](./DCS-W1-COMPLETE.md) |
| W2 | D1 context_* agent tools | live 鈥?[DCS-W2-COMPLETE.md](./DCS-W2-COMPLETE.md) |
| W3 | D5 toolEntries | live (flag-gated) 鈥?[DCS-W3-COMPLETE.md](./DCS-W3-COMPLETE.md) |
| W4 | D4 SEKB production path | live (flag/env gated) 鈥?[DCS-W4-COMPLETE.md](./DCS-W4-COMPLETE.md) |
| W5 | D6 Windows Electron E2E off/on | live-with-e2e 鈥?[DCS-W5-COMPLETE.md](./DCS-W5-COMPLETE.md) |
| W6 | D3 fingerprint slice + D7 dual-injection counters + honesty docs | partial-live + residual chain 鈥?[DCS-W6-COMPLETE.md](./DCS-W6-COMPLETE.md) |

**Final acceptance table**: [DCS-WIRING-REPAIR-ACCEPTANCE.md](./DCS-WIRING-REPAIR-ACCEPTANCE.md) (D1-D8 CONFIRMED closed / residual with file:line).

### Honesty corrections (do not re-debate)

- **Producer unit PASS !== production caller.** R2/R* unit green for envelope or handler helpers does not by itself prove a production TaskLoop/attempt/tool catalog caller. W1-W5 closed the real callers; treat ROUND COMPLETE reports as infrastructure + unit evidence unless a W* report cites the production site.
- **D3 residual**: embedded attempt binds effectiveWorkspace fingerprint and invalidates working-memory on mismatch. Full Chat workspaceId to Main normalizeRootPath to Gateway field chain is **not** delivered.
- **D7**: counters are in-memory observability (dcs-observability.ts), not a product dashboard.

## 鍚庣画宸ヤ綔

1. 鍚庣画闃舵浠?[dcs-v1.6-spec.md](./dcs-v1.6-spec.md) 涓庡凡鏀剁紪鐨?
   [dcs-v1.6.1-addendum.md](./dcs-v1.6.1-addendum.md) 涓哄悓绾ц鑼冩潈濞併€?
2. 闃舵 1 鍙婁互鍚庣户缁噰鐢?TDD 鍜屽鎶楀闃咃紝鏂板濂戠害涓嶅緱鍥炲啓涓哄钩琛岃鑼冦€?
3. 淇濇寔 COMPASS / role-memory feature flag 榛樿鍏抽棴锛岀洿鍒板搴旇縼绉婚樁娈靛叿澶囧畬鏁村洖褰掕瘉鎹€?

## 生产启用方式 / Production enablement

DCS flags default to **all off**. This change set only wires the production enablement path; it does not flip defaults.

### Flag full names (user `~/.openclaw/openclaw.json`)

| Flag path | Default | Effect when `enabled: true` |
|-----------|---------|-----------------------------|
| `runtime.contextBlock.working-memory.enabled` | `false` / absent | Working-memory context blocks + producers |
| `runtime.contextBlock.tool-registry.enabled` | `false` / absent | Tool-registry context blocks + producers |
| `runtime.contextBlock` task-loop / compass / role-memory (as documented in dcs-v1.x specs) | `false` / absent | Corresponding handlers when present in schema |
| `runtime.contextBlock.sekb.enabled` (or SEKB runtime key per schema) | `false` / absent | SEKB experience bridge |
| Env override `OPENCLAW_SEKB_ENABLED` | unset / `0` | Process-level SEKB kill switch used by tests |

Exact nested keys for stage handlers follow `openclaw_runtime` zod schema (`runtime.contextBlock.*`). Prefer editing the JSON flags below rather than env vars for durable desktop use.

### Enable steps

1. Quit Verse Claw fully (so Gateway exits).
2. Edit the **desktop-facing** config: `~/.openclaw/openclaw.json` (Windows: `%USERPROFILE%\.openclaw\openclaw.json`).
3. Set the desired flags, for example:

```json
{
  "runtime": {
    "contextBlock": {
      "working-memory": { "enabled": true },
      "tool-registry": { "enabled": true },
      "sekb": { "enabled": false }
    }
  }
}
```

4. Restart the app. On Gateway launch, `prepareSourceRuntimeIsolation` in `electron/gateway/config-sync.ts` copies the whole `runtime` key into `userData/openclaw-source-state/openclaw.json` when the user value is present and differs.
5. Confirm isolation config contains the flags:

```text
%APPDATA%\verse-claw\openclaw-source-state\openclaw.json
```

(or the app `userData` path for your package name) — check `runtime.contextBlock`.

### Rollback steps

1. Quit Verse Claw.
2. In `~/.openclaw/openclaw.json`, set the enabled flags back to `false` or remove the `runtime` block.
3. Restart the app so config-sync re-copies the user `runtime` value into the isolated Gateway config.
4. Optional hard reset: delete `userData/openclaw-source-state/openclaw.json` and restart; isolation rebuilds from the user config (still defaults-off if user flags are off).

### Merge rules (config-sync)

- Sync keys: `agents`, `models`, `plugins`, **`runtime`**.
- If the user config **has** a key value, that value overwrites the isolated config when different.
- If the user config **omits** a key, the isolated value is **left unchanged** (so pre-seeded or previously enabled isolation state is not wiped by an absent user key).
- `stripSourceRuntimeIncompatibleConfigKeys` only removes `agents.list[].reasoningEffort`; it does not touch `runtime.*`.

