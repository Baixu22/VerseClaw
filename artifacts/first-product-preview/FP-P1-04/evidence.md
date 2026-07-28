# FP-P1-04 evidence — 编码任务闭环 read → write → diff → test → undo

| item | value |
|---|---|
| 收口日期 | 2026-07-27 |
| E2E | `tests/e2e/coding-loop-fp-p1-04.spec.ts` **1 passed (32.1s)**（真 Electron + 真 gateway child + 真 agent turn） |
| 单测 | `openclaw_runtime/src/agents/` 全量 **115 files / 1133 passed** |
| DCS 套件 | **10 files / 76 passed**（+ 218/10 分组） |
| contract:check | Contract check passed. |
| git diff --check（本任务文件） | 干净 |

## 本轮实际修补的三处真缺口

开工前普查（`artifacts/first-product-preview/_map-coding-loop.md`）判定：read/write/undo 已实现，
**verify 的 test-runner 半边零实现**、**diff 在 Electron 侧断链**。复核属实，两处都已补。

### ① verify 段：项目 test-runner 探测（此前全仓零实现）

新增 `openclaw_runtime/src/agents/test-runner-detect.ts`：

- 支持 node（按 lockfile 选 pnpm/yarn/bun/npm）、pytest、cargo、go
- **skip 必带机器可读 reason + 人话 message**：`no-workspace` / `no-manifest` /
  `no-test-script` / `placeholder-test-script` / `unsupported-ecosystem`
- 不执行，只探测并给出命令 —— 执行交给既有 exec/bash 工具，以继承其审批/沙箱/超时策略，
  不新开第二条执行路径
- 关键判定：npm init 的占位脚本 `"no test specified"` **不算**有 runner（否则每个未测项目都会报硬失败）；
  node 的**否定结论**优先于兄弟生态（有 package.json 无 test script 时不会误报 `cargo test`）

接线于 `write-side-effects.ts`，结果进 `details.verify_tests` + 会话可见文本。
观测新增 `coding.write.testRunnerDetected` / `testRunnerSkipped` 两个计数器。

**守卫非空转（反向注入实测）**：把 `PLACEHOLDER_TEST_SCRIPT` 正则改成永不匹配 →
`× does not mistake the npm placeholder script for a real runner` / **2 failed**。已复原，复原后 22 passed。

### ② diff 段：证据改走 `content`，因为 `details` 会被投影层删掉

**根因（本轮新发现，非任务书预判）**：`openclaw_runtime/src/gateway/chat-display-projection.ts:472-473`
对 chat history **显式 `delete entry.details`**。`edit` 工具的 diff/patch 只存在于 `details`，
而它的 `content` 只有一句 `Successfully replaced 1 block(s) in util.js.` ——
所以产品里用户**完全看不到 diff**。

先尝试在 `embedded-agent-subscribe.handlers.tools.ts` 的 emit 层拼接，实测无效（那条路不是 Electron 聊天的渲染源），
已整段回退，改在 `write-side-effects.ts` 把 diff / syntax_check / verify_tests 追加进 `content`
（投影层保留 `content`）。E2E 实证生效，见下方 workpanel 输出。

### ③ read 段观测 + journal lineage

- `context_read` / `context_search` 此前既不记 `recordFactToolCall` 也不记 `recordFactStoreHit`
  （只有 4 个 view 工具有），read 段「命中数可观测」不成立 → 已补，miss 也记账
- journal lineage 此前只有 session/workspace/generation，缺 AC 要求的 request 与 flags →
  已补 `requestId`（tool call id）与 `flags` 四项快照

## E2E 原始输出（真 agent turn，脚本化本地 LLM 端点 = FP-P1-07 路线 A）

```
[fp-p1-04-t1]  {"fixedApplied":true,
  "editResultPreview":"Successfully replaced 1 block(s) in util.js.\ndiff:\n 1 function add(a, b) {\n
                       -2   return a - b;\n+2   return a + b;\n 3 }\n 4 module.exports = { add };\n
                       verify_tests: skipped(no-manifest): No project manife...",
  "journalMeta":{"seq":1,"relPath":"util.js","hadPrior":true,"toolName":"edit",
    "lineage":{"sessionId":"37538f2e-...","workspaceRoot":"...clawx-fp-p1-04-2Dhwwj",
               "requestId":"calledit",
               "flags":{"parseOnTouch":true,"staleWriteGuard":true,"writeJournal":true,"symbolLease":false}}}}

[fp-p1-04-workpanel]  （产品内 Work panel 实际渲染文本，证明 diff 段/verify 段用户可见）
  "... edit / Tool Result: edit /
   Successfully replaced 1 block(s) in util.js.
   diff: 1 function add(a, b) { -2 return a - b; +2 return a + b; 3 } 4 module.exports = { add };
   verify_tests: skipped(no-manifest): No project manifest (package.json / pyproject.toml /
   Cargo.toml / go.mod) was found in the workspace root; no test suite was run."

[fp-p1-04-budget]  {"totalChars":6000,"dropAlertRatio":0.1,
  "counters":{"turns":1,"killedTurns":0,"appliedChars":6000,"requestedChars":8000,
              "droppedChars":0,"truncatedChars":2000,"dropAlerts":1}}     ← FP-P1-11 锚点

[fp-p1-04-t2]  {"reverted":true,
  "undoResult":{"ok":true,"restored":["util.js"],"errors":[],"journalDir":"...","remainingEntries":0}}

[fp-p1-04-t3]  {"missResult":{"status":"error","tool":"read",
                 "error":"ENOENT: no such file or directory, access '...missing.js'"},
                "badEditResult":{"status":"error","tool":"edit",
                 "error":"Could not find the exact text in util.js. The old text must match exactly
                          including all whitespace and newlines. ..."}}

[fp-p1-04-t4]  {"undo2Result":{"ok":false,"restored":[],
  "errors":["util.js: journal snapshot missing: ...\\0003-util.js.pre"],
  "journalDir":"...","recovery":"Undo stopped at the first failure. Nothing was discarded..."}}

1 passed (32.1s)
```

## 五段逐段判定（对任务书链路分段表）

| 段 | 必须做到 | 实证 |
|---|---|---|
| read | 命中 workspace 内文件，命中数可观测 | T1 `call-read` 返回真实文件内容；observability 已补 hit/miss（本轮新增） |
| write | 仅限 workspace；写前记 journal | 写入落盘生效；journal 有 seq/relPath/hadPrior/lineage 全字段 |
| diff | 展示实际落盘前后差异 | workpanel 实际渲染出 `-2 return a - b; +2 return a + b;`（本轮打通） |
| verify | 语法检查 + 可用则跑测试；无 runner 时明说跳过原因 | `verify_tests: skipped(no-manifest): ...no test suite was run.`（本轮新增） |
| undo | 100% 还原；部分还原视为失败 | T2 `ok:true` 且文件字节还原；T4 `ok:false` + snapshot missing + journalDir 保留 |

## 测试脚手架缺陷（本轮抓出并修，非产品缺陷）

首跑失败三次，均为**测试代码**问题，产品行为正确：

1. runtime 会把 tool_call_id 去非字母数字（`sanitizeToolCallId`，`tool-call-id.ts`），
   `call-read` → `callread`。mock 按原 id 匹配 → 永不命中 → **无限重发 2142 次**。
   已改按 sanitize 后前缀匹配，并加 40 次 loop guard 让脚手架 bug 快速失败而非空转。
2. 开了 working-memory 后 runtime 会追加 `## Recent Actions` **user** 消息，
   `lastUser` 拿不到驱动 marker → 改为拼接全部 user 轮次并按**最后出现**的 marker 派发。
   （这条注入本身正是 DCS block 生效的旁证。）
3. undo 结果是 pretty-print JSON，`toContain('"ok":true')` 因空格不匹配。
   改为对 JSON 形状做去空白比较，**失败原因与 recovery 文案仍逐字断言**，未放宽实质。

## 手工验证（G4 记录，仍为 notHumanProductChat=true）

本轮由实现人（Claude）在真 Electron 内经 E2E 驱动完整走通 read→edit→diff→verify→undo，
并逐条查看产品内 Work panel 渲染文本确认 diff 与 verify 结论可读。
**这是手工验证，不是真人产品任务**：`notHumanProductChat` 保持 `true`，L3 真人水位仍为 0，
真人 10 次在 `FP-P2-02`。

## 门禁判定

- G1 dev：新能力默认行为保守（探测不执行、fail-open 不阻断写入）；`testRunnerDetectEnabled` 可显式关；
  contract:check 过；本任务文件 `git diff --check` 干净。
- G2 test：1133 + 76 单测；4 轮 E2E 覆盖成功链路 + 3 类失败（读缺失 / 编辑不匹配 / undo 部分还原）；
  反向注入证守卫非空转；未跳用例、未删 AC 条目。
- G3 runtime：真 gateway child 内真 agent turn 完成全链；journal lineage / budget counters / workpanel 渲染均有真数据。
- G4 human：n/a（真人量化在 FP-P2-02）；手工走通 1 次已记录于上。
- G5 accept：self-accept（单人执行）；AC 8/8 带指针；残留转出。
