# Session Collaboration B 开发验收与整合核查

- **证据产生方式**：全部由 agent 驱动，未声称 real-human。
- **源码工作树**：`D:/tmp/session-collaboration-mainline-20261126/A/review-fixes-source`
- **分支 / HEAD**：`codex/session-collaboration-b-20261126` / `bb9031ff341029fa9cfd59bbc129a5024dd05f94`
- **启动快照**：`startup.json`，时间 `2026-11-27T08:24:45.976623Z`。
- **主线基准**：`origin/main=c92ed890056068ca07769c0a410cd0cd90101085`；`integration-inventory.json` 记录 base `9e0f1afdc5db61e234b0965363249ca8d35f04d5`，本分支已集成 A 至 `b7dc3000173a44a31207c902ae28df06987f9e2e`。

## 已核对证据

| 范围 | 结果 | 证据与绑定情况 |
|---|---|---|
| B 回归集 | 128/128，通过 17 个 suite | `regressions-r1.json`，覆盖 chat-api workspace fingerprint、ChatInput 和 input mode。JSON 未写入 commit/tree，需依最终候选补齐绑定。 |
| B lane | 83/83，通过 16 个 suite | `b-lane-r1.json`，覆盖历史重试、控制语义、消息投递/预算/信封/视图、面板和 watch。JSON 未写入 commit/tree。 |
| Runtime permit | 8/8，通过 2 个 suite | `runtime-permit.json`，覆盖 sessions.send/steer permit 生命周期；配置为单文件 Node/Vitest 运行，未写入 commit/tree。 |
| 定向合计 | **219/219 通过** | 128 + 83 + 8；这是当前工作树上的开发证据，未替代完整类型、构建或 Electron 验收。 |
| 契约 | 通过 | `contract-r3.txt`：`Contract check passed.`；文本没有候选哈希。 |
| 四语 i18n | 通过 | `i18n-r2.receipt.json` exitCode 0，`i18n-r2.stdout.txt` 为 `i18n lint passed.`；本分支包含 en/zh/ja/ru agents locale。 |
| 通信回放/比较 | 通过 | `comms-r2` replay/compare exitCode 0；compare 绑定 HEAD tree `21f134dee01c20939fdeabc71cf2c449b44b761c`，各场景 message loss/order violation、duplicate、timeout 均为 0，history_load_qps 与 rpc_p95 均为基线。 |
| 草稿版本反例 | 预期失败已复现 | `draft-revision-red-proof.json` 标记 `status=reproduced`、`expectedRegressionFailures=2`；两条失败均为未保留 `Original guidance`。其 baseline SHA 是启动时的旧 ChatInput，属于回归护栏证据，不是绿灯验收。 |
| Electron | 仅收集到用例 | `electron-collect-r2.txt` 只列出 2 个文件、3 个测试，没有执行结果或通过回执。 |

A 侧历史证据也已核对：`D:/tmp/session-collaboration-mainline-20261126/A/source-r7` 对候选 `cf5fea1183d2850dd937f36a85f047d9e6c3e09f` 的 source-r7 通过契约、i18n、comms、harness 检查；`unit-r9/vitest.json` 为 13 suites / 118 tests 全部通过。该证据属于 A 候选，不能直接当作当前 B HEAD 的 A-E 完整验收。A 的正式桌面 UI 验收仍未完成。

## 源码与候选一致性

- 当前工作树相对 HEAD 有 33 个 dirty 文件，包含 ChatInput、ChatMessage、B3 规格、控制 E2E 与 ChatInput 单测等本轮补丁。
- 将 `startup.json` 中的 28 个文件 SHA 与当前工作树复核后，4 个文件已漂移：`harness/specs/tasks/session-collaboration-b3.md`、`src/pages/Chat/ChatInput.tsx`、`tests/e2e/session-collaboration-controls.spec.ts`、`tests/unit/chat-input.test.tsx`；其余启动清单文件匹配。漂移来自启动后 dirty patch，不能沿用启动快照作为最终候选证明。
- comms-r2 的 candidate/tree 是 HEAD `bb9031ff3` / `21f134de`，因此没有覆盖上述 dirty patch，也没有覆盖尚待合并的 A 最新端点 `cf5fea118`。
- `git diff origin/main..HEAD` 为宽范围 A+B 集成差异（当前统计约 253 files、10355 additions、9250 deletions）；`git merge-tree HEAD origin/main` 已无自动冲突。B 依赖 A 的查询/等待底座，不能把两段差异拆成独立可发布的 B-only 结果。

## 需要保留在待验收状态的缺口

1. **Lint 有新增 error**：`src/pages/Chat/ChatMessage.tsx:416` 的 effect 同步调用 `setState`，ESLint 报 1 error；另有 5 个 warning，其中基线文件记录的 warning 已存在。该 error 是当前候选进入 lint/开发验收前必须处理的确定缺口。
2. **219 条单测回执缺少候选绑定**：`regressions-r1.json`、`b-lane-r1.json`、`runtime-permit.json` 没有 commit/tree 或完整源文件哈希；当前 dirty patch 与启动快照不一致，不能把它们直接写成最终提交的验收回执。
3. **契约与 i18n 回执同样没有候选哈希**；需要在最终整合候选上重新生成或以统一 manifest 绑定。
4. **comms-r2 只证明 HEAD**；dirty patch 和 A 最新两行 fixture 变更合入后应重跑 replay/compare。用户已要求暂缓重型类型、构建、Electron 实跑及 CI，本轮不把它们写成通过。
5. **Electron collect-r2 不是 UI 验收**；它只确认了 3 条测试可被收集，未执行 controls、draft recovery、Gateway restart 旅程。
6. **A 最新端点尚未进入 B**：主代理提供的 `cf5fea118` 仅额外修改 `tests/e2e/session-collaboration-scale.spec.ts` 的 SQLite 子进程 tsconfig 两行；当前 B 已到 `b7dc30001`，应在最终候选前合入并重新绑定证据。

## 推荐整合路径

1. 保持当前 B 代码和 dirty patch 冻结，等待 review-r2 的结论；先修复 ChatMessage:416 的 lint error，保留草稿版本语义和现有回归测试。
2. 将 A 最新端点 `cf5fea118` 合入 B 分支，保留 A 的 source-r7 / unit-r9 历史证据及其候选身份；不要把 A 的历史 118 项直接重标为当前 B 候选通过。
3. 形成新的单一最终候选后，记录 HEAD、tree、工作树状态和受影响文件 SHA；在该候选上重跑 219 项定向测试，保留 draft-revision-red 两条预期失败护栏。
4. 在同一候选上重新生成 contract、i18n、comms replay/compare 回执，并将它们写入统一 candidate manifest。按用户指令仍可暂缓 full typecheck、build、Electron run 和 CI；状态写为 deferred，不能写为 pass。
5. 报告范围只写“会话协作中心 A+B 开发交付证据”：B 的消息回执、原 run 控制、Gateway 重启回读、草稿版本隔离和 worker UI 代码已覆盖定向开发测试；A 的正式桌面旅程、规模测量和跨 A-E 完整验收仍待后续。
6. 最终结论应保持：**B 定向开发证据 219/219 通过；当前候选仍有 lint error、候选绑定和 Electron 执行缺口；不能宣称整个 A-E 验收完成。**

本报告仅写入 `D:/tmp/session-collaboration-b-relay-20261127/acceptance-evidence.md`，未修改源码工作树、未提交、未启动 pnpm/安装/重型测试。

