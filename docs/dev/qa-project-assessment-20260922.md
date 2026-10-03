# 按仓库现状做的收尾判断

> 【2026-09-22 标注】本文是收尾讨论的输入之一，已被 `docs/dev/qa-synthesis-roadmap-20260922.md`（唯一入口）综合；结论以该文与 Task Forest（D7 = TF-0225、里程碑 TF-0226）为准。

日期：2026-09-22。分支 `feat/runtime-lifecycle-governance`，HEAD `ba1206324`。未提交改动只有 `openclaw_runtime/src/agents/shadow-census.ts` 与对应测试。本文是给这次实习展示做的取舍，不改任务状态，也不把展示完成写成产品验收通过。

## 判断

仓库里能拿出去的不是 224 个任务节点，也不是 20 个页面。能拿出去的是一条已经跑通的 Windows 编码路径，加上这条路径上真实存在、而且代码对得上的两处限制。

路径是：ClawX 生产构建，配一个 custom provider（J-02 用的是 senseaudio），建一个 `fullAccess` 工作区，让模型在这个目录里 exec → read → edit → exec，把一个小测试从失败修到通过。证据在 `artifacts/live-model-cdp/20260921-senseaudio-journey-J02/`。操作者是 agent 经 host API 驱动，不是真人点界面。发送到最终回复约 58 秒，3 个测试通过。同一次跑出的两处缺陷已经修进 `6760b372e`：custom provider 的 key 到不了隔离运行时，工作区的 `tools.exec` 也到不了，于是每条命令都卡在没人处理的审批上。

收尾就停在把这条路径讲清楚、能再跑一次、并把没接通的部分写成限制。不要为了让任务图变绿，去做 TF-0030 后面那 12 个 RC 包。

## 仓库实际分成四块，体积和完成度是反的

本轮在当前工作树量的是源码和文档，不含 `node_modules`：

| 块 | 现在在磁盘上是什么 | 和这次展示的关系 |
| --- | --- | --- |
| 桌面壳 | `src` 21MB / 351 个源文件，`electron` 3.8MB / 247，`shared` 2.7MB / 93 | 用户能看见的产品。真正的主导航只有三条 |
| 上游运行时加本仓库的治理补丁 | `openclaw_runtime` 2.6GB，其中 `node_modules` 2.3GB，`src` 50MB / 5114 个文件，`extensions` 70MB / 143 个目录 | 执行引擎。个人贡献是补丁和边界，不是这 5114 个文件 |
| 工程验收 | `harness` 4.1MB / 514 篇规格，验收器在 `scripts/lib/agent-engineering-acceptance.mjs`（2372 行） | 用来证明「说做完了」不够。展示时用一个负例，不重跑 25 个门 |
| 过程记录 | `docs/dev` 15MB / 255 篇，`.agent-workbench/task-forest` 1.4GB，`artifacts` 146MB | 过程比产品大。不能当成完成度 |

任务森林这 1.4GB 里，图本身只有 2.2MB。其余是 events 258MB、snapshots 488MB、exports 592MB。`e043cad95` 已经做过一次把超大状态移出 git。这些文件解释不了产品，收尾不要再导出一份。

224 个节点里 done 193、blocked 12、proposed 12、deprecated 7。这个 193 大部分是运行时可靠性补丁和上下文护城河的子节点，不是桌面功能做完了。TF-0102 自己的摘要写明：M6（TF-0129、TF-0130、TF-0141、TF-0144、TF-0151）本轮不投入，因为会变成下一批零调用模块。TF-0076 是 done，内容是成本 NO-GO：历史约 2.52 倍 token、3.11 倍延迟，没有当前配对样本，生产保持 shadow。

## 用户真正进得去的界面

`src/App.tsx` 的路由和 `src/components/layout/Sidebar.tsx` 的导航不是一回事。

侧栏固定入口只有收件箱、定时任务、知识库，外加聊天和设置。Models、Agents、Channels、Skills 已经重定向进设置，不再是一级页面。Remote Tasks 重定向到收件箱。Code Review 和 Browser 被收进工作区兼容路由，不是独立产品。

仍注册了路由、但不在主导航里的有：Task Ledger、ClawGraph、Observability、UiV2Showcase。Image Generation 和 Dreams 还要 `devModeUnlocked`，否则直接送回聊天。`src/pages` 下那 20 个目录，有一半是历史表面或开发开关后面的页面。收尾叙事里不出现它们，也不要删目录：没有逐个做依赖检查，删了可能打断设置或工作区深链。

聊天这条主路径本身是大文件，不是缺文件。`src/stores/chat.ts`、`src/pages/Chat/index.tsx`、`src/pages/Chat/ChatInput.tsx` 都在 180KB 以上。压缩证据就是一个已经写好但没挂上的例子：`CompactionArtifactViewer` 只被单测引用，E2E `tests/e2e/compaction-artifact-viewer.spec.ts` 从第 15 行起写明入口未接线、host 方法未注册，整段 `test.skip`。能力表 `artifacts/capability-claims/status-table.json` 生成于 2026-07-05，44 条里 PARTIAL 21、FP-OVERCLAIM 5，真正 TP-RUN 只有 3 条（Gateway 拉起、JSON-RPC、观测失败不挡执行）。过期，但和「有组件、没挂上入口」是同一类现象。这张表不能再当进度。

## 编码路径上，什么通了，什么还断着

J-02 之后，两处已经进当前 HEAD，本轮对过代码：

- `electron/gateway/config-sync.ts` 第 810 行，`SOURCE_RUNTIME_ISOLATION_SYNC_KEYS` 含 `tools`。单测 `tests/unit/config-sync-source-runtime.test.ts` 断言这个键在。这就是 `fullAccess` 下 exec 不再误卡审批的原因。
- custom provider 走 env SecretRef。`electron/utils/openclaw-auth.ts` 保留 `apiKeyEnv`，密钥留在主进程环境，不写回文件。这是 J-02 里 `No API key found` 的修复。

还在代码里、和 J-02 README 对得上的限制：

1. 会话历史仍读 `getOpenClawConfigDir()`，也就是 `OPENCLAW_CONFIG_DIR` 或 `~/.openclaw`（`electron/utils/paths.ts` 第 71 行，`sessions-api.ts` 的 `loadSessionTranscriptByKey`）。隔离运行时的状态在 `userData/openclaw-source-state`（`config-sync.ts` 第 865 行）。两条路径没有并到一处，所以 `sessions.history` 对隔离会话仍会 `Transcript not found`。聊天主路径走 Gateway RPC，不受这处影响。演示不要走「从历史文件回放隔离会话」。
2. 非 `fullAccess` 仍会发出 `exec.approval.requested`。ClawX 这边没有对应的批准 UI。`scripts/rc01-authority-inventory.mjs` 写明审批状态在 Gateway 进程内的 Map 里，重启就丢。这是 TF-0032 的范围，不是改一行配置能收口的。演示必须用 `fullAccess`，材料里写明其他权限模式会挂起。
3. Gateway 连上后 8 秒内的 reload 会被跳过，日志就是 `skipped_recent_connect`（`electron/gateway/manager.ts` 第 861 行）。Windows 上即便过了 8 秒也不发 SIGUSR1，直接重启。所以第一次保存 provider 之后，演示脚本要显式 `gateway.restart`，不能假设保存即生效。
4. 创建工作区会往用户选的目录写文件。`workspaces-api.ts` 第 560 行调用 `ensureVerseClawWorkspaceHarness`，把 `resources/workspace-harness` 里现有的 16 个模板复制到 `<项目>/.verse-claw/harness/`，已存在的不覆盖。另外 `openclaw-workspace.ts` 会把 Verse Claw 的 context 段合并进已有的 `AGENTS.md`。J-02 说的「git init 加 20 多个引导文件」里，harness 这 16 个仍在；git init 在当前 electron/src 里已搜不到调用，那一部分不要再当成现码缺陷，除非复跑时又出现。
5. 工作区切换的 store 会更新（`src/stores/workspaces.ts` 的 `switchWorkspace`）。J-02 看到的「头部仍显示默认工作区 / Read only」是渲染层没跟上。权限控件在 `ChatInput.tsx` 约第 3603 行，读的是 `workspace.permissionMode`。没在当前 HEAD 上重开 Electron，不能断言这行已经好了。复跑时看这一处；还在就只修头部绑定，不重做工作区。

未提交的 shadow-census 是另一件独立的事：wire receipt 的 owner 必须是具名 adapter，不能拿 provider id 充数，失败时 `acceptanceReady: false`。J-02 的 sqlite 计数是 `runtime_receipts=0`、`effect_receipts=0`、`context_blocks=0`。所以「每次模型调用都能对上最终请求」在这条旅程上不成立。要么把这 23 行单独作为 TF-0030 的一个增量，并在同一次 run 里留下非 0 收据；要么演示里明确说收据默认关。不要把它混进旅程修复的提交里，也不要宣称普查做完。

## 不该做的那条链，依赖是硬的

TF-0028 下面 14 个子节点，只有 TF-0029 是 done。后面按顺序是：

TF-0030 收据普查 → TF-0031 双收据密封 → TF-0032 审批对账 → TF-0033 Operator → TF-0034 到 TF-0037 四种生命周期 → TF-0038 记忆 → TF-0039 MCP → TF-0040 观测 → TF-0041 总验收 → TF-0042 真人场景。

官方 `todo --ready` 本轮只返回 TF-0030，持久状态仍是 proposed。这表示依赖数学上已经满足，不是图坏了，也不是可以顺手标完成。TF-0032 要做的是拒绝不执行、重复批准不重复写、pending 跨重启还在。现码里审批状态在进程 Map，和这个目标之间不是文案差距。TF-0042 还卡着具名真人和真实 channel。TF-0009 的测试要求 `requiresNamedHumanOperator=true`，D6 仿真不能顶替。这些守卫留着，展示材料改用「agent 驱动」这个已经写在 J-02 里的词。

`docs/dev/unified-agent-system/runtime-convergence/STATUS.md` 写工程已接受、当前包是 RC-10、验收时间 2026-08-11。同目录 `AGENT-START.md` 开头写候选 `fac6327a2` 的审计是 NO-GO，没有新的独立 Verifier 不能恢复 accepted。任务图又说 RC-02 起都还是 proposed。三份都是历史，收尾时在那一页说明里各标日期，不要改 STATUS 去配合展示。

`docs/dev/engineering-product-node-plan-20260921.md` 要的是可安装、可恢复、可回退、可追溯的完整产品，而且它的快照还是 HEAD `752b936a`、192 个 done。那是下一次产品周期的入口。这次实习展示用更小的出口，否则收尾又变回把 RC-03 到 RC-10 做完。

## 展示时具体放什么

一页说明，只写这几句，每句都能指到文件：

- 这是个人和 Agent 一起做的桌面工作台探索，不是 GA，也不是 README 第 78 行那个企业版联络口径。README 第 42 行的 Windows x64、单工作区、显式 opt-in，和这次范围一致。
- 跑过的是 J-02：一个 provider、一个 fullAccess 工作区、一次把测试修绿。附上那两个已修缺陷的文件位置。
- 没跑通的写在旁边：历史文件路径和隔离状态不一致；非 fullAccess 会挂起；保存后 8 秒内以及 Windows 上要重启 Gateway；建工作区会在项目里种下 `.verse-claw/harness`；收据计数是 0。
- 机制示例只用现成代码，不新写功能。上下文账本在 `openclaw_runtime/src/context-engine/turn-injection-budget.ts`，固定顺序是 knowledge、working_memory、tool_registry，后面的通道超预算就截断或丢掉，同目录已有测试。验收器在 `scripts/lib/agent-engineering-acceptance.mjs`，展示一个缺门会被拒绝的负例。TF-0076 的 NO-GO 留着，用来说明为什么没有默认打开这些增强。
- 不放进承诺：143 个渠道扩展、Dreams、生图、账单、ClawGraph、Task Ledger、M6、Docker（TF-0047 仍 blocked）、压缩证据查看器、全量回滚。CodeGraph 插件 README 第一行就是 RETIRED，只留本地索引，不当功能。

停的条件：在当前 HEAD 上把 J-02 再跑通一次；5 条观察里，演示会碰到的才修，修的时候对照上面的文件，不要扩大到审批持久化或双收据全链；材料能指出哪次是真实模型、哪次只是机制测试、哪份文档是 8 月的旧结论。到这里停。再往下是 TF-0032 那种跨重启的审批，那是另一个周期。

## 本轮查过和没查过的

查过：路由和侧栏源码、隔离同步键、SecretRef、sessions 历史路径、`openclaw-source-state`、8 秒跳过 reload、工作区创建调用的 harness 模板（16 个文件）、审批清单里的进程内 Map、任务图 224 节点计数、TF-0028 的 14 个子节点、官方 ready 待办、目录体积、能力表日期和分类、CodeGraph 退役声明、压缩查看器的跳过说明、未提交的 shadow-census diff。

没做：没有重开 Electron，没有重跑 J-02，没有 typecheck 和全量测试，没有确认「头部不刷新」在当前构建上是否还在，没有在现码里找到 `git init`（所以不把它写成仍存在的缺陷）。因此不给整库打分，也不说当前树可以发布。
