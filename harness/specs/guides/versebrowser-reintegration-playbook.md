---
id: versebrowser-reintegration-playbook
title: VerseBrowser 模块回接规划：保留实现、任务守恒、宿主验真
type: ai-coding-guide
appliesTo:
  - versebrowser-upstream-reintegration
---

本手册是 2026-10-15 对两个本地仓库核对后形成的实施规划，已按 M00→M12 执行：上游 `packages/versebrowser` 私有模块已接入 ClawX 的契约、权限、资源、打包与模型入口，重复的 `electron/services/agent-browser*` 旧实现已在 M12 按调用方证据退役。本节以下规划结论仍作为来源与设计记录保留；逐文件来源见 ../fixtures/versebrowser-reintegration/source-lock.json，保留规则见 ../rules/versebrowser-upstream-preservation.md，任务规格见 ../tasks/versebrowser-upstream-reintegration.md。

**2026-10-16 卫生复核补充：** M12 的历史通过不等于后续工作区、80 项能力或当前发行包通过。本轮修复常规构建缺模块编译和宿主漏注入 CLI runner；当前 Electron driver 只有原 67 个方法，13 个新增 facade 入口明确返回 `E_NOT_IMPLEMENTED`。安装/开发/构建会先编译模块；独立类型检查前可执行 `pnpm run versebrowser:build`。具体调用边界见 `packages/README.md`，本轮结果与历史收据分开记录。

**一、推荐结论与模块边界**

推荐把原实现作为 packages/versebrowser 下的私有 TypeScript workspace 模块引入，通过包的公开 exports 供 ClawX 消费。保留源码目录结构、实现、测试语义和来源锁；ClawX 只在自己的契约、权限、任务、资源、打包和模型工具边界适配。独立仓库继续作为来源及历史档案，第一次回接不删除、不归档它，也不要求它停止维护。

“模块回接”包含原产品实现及它运行所必需的依赖、补丁、类型、许可证与精选回归输入。它不包含原项目的任务图、研究流水线、市场/认可材料、全量实验语料、发布工程、原 node_modules 或另一套项目配置。保留模块实现不意味着把所有能力默认开放给模型。

| 方案 | 适用情形 | 本次建议 |
|---|---|---|
| 固定 SHA 的源码 workspace 模块 | 希望实现回到 ClawX、可以在同一变更里审查宿主适配 | 推荐；源码机械搬入，模块独立编译，不散铺回 electron/shared |
| 固定内容哈希的私有 tarball | 只希望消费功能，源码继续完全在独立仓维护 | 合理备选；须从同一冻结源码构建最小嵌入包，不能依赖本机路径 |
| Git subtree、submodule、整仓拷贝 | 引入独立项目边界及其大批非运行内容 | 不采用 |
| 读完后按说明重新实现 | 丢失隐含行为、负例和修复历史 | 不采用 |

这里只提出模块所有权方案，没有实际采用新的进程架构。若当前 Electron 无法承载候选依赖，优先验证既有宿主受管进程路径；不得以本规划为由另建进程管理平台或直接升级 Electron 全栈。

**二、已经核对的当前事实**

| 项目 | 当前读取结果 | 对迁移的含义 |
|---|---|---|
| VB 来源 | 47b076f85d4e37cdaea67c1564d1c4f4dbf2b011，master，干净 | 固定该提交，不使用 latest/浮动分支 |
| VB 版本 | package.json 为 0.3.1，当前增量在 Unreleased | 版本字符串不足以定位源码，旧 v0.3.1 包不等于当前候选 |
| ClawX 基线 | d128c4094c2fea2edf3075398e732582de71f203，main，有 VerseShell 回接脏改动 | 另建隔离候选；当前未提交字节必须保留，不混入本迁移 |
| 路径 | 当前用户入口实际解析到 D:/ClawX | 保存和校验 resolved path，避免把路径别名误认成另一 worktree |
| VB 跟踪内容 | 1,305 文件；src 127、tests 160（158 test + 2 helper）、scripts 146、data 837、docs 23 | 按角色白名单引入；不是复制 1,305 文件 |
| 旧实现对照 | 找到 42 个明确路径对应；7 个字节相同；去顶层 import 后 17 个主体相同，25 个仍有非 import 文本差异 | 此统计不是完整语义 diff；另外 85 个无直接路径对应不等于 85 个新能力 |
| Host API | ClawX 67 方法、VB 80 方法；旧 67 全在 VB 契约中，另有 13 方法 | 名称覆盖不能证明类型/行为兼容，必须逐方法核对 |
| VB MCP | 静态目录 53 个工具 | 实际可见面仍取 catalog ∩ policy ∩ driver，不能一次全广告 |
| 源任务 | 190 节点：188 done、2 proposed；338 边 | 保存原状态，宿主接线验收另记 |
| 宿主任务 | 328 节点：312 done、16 deprecated；582 边 | 不覆盖它的配置、计数器、图和历史 |
| ID 冲突 | 源 190 个 TF ID 全部与宿主已有 ID 重合 | 用 project + ID + source SHA 作外部键，由 CLI 分配新的宿主 ID |
| 系统 Node | 24.15.0 / libuv 1.51.0 | 低于 VB Windows guard 的 libuv 1.52.1 门槛 |
| 已有兼容 Node | VB 本地运行时 24.16.0 / libuv 1.52.1 | 可用于基线验证；不能成为发行包对本机 .local 路径的依赖 |
| Electron | ClawX 声明 ^40.6.0，安装 40.8.4；VB 可选 peer >=44 | 是需验证的兼容差异，尚未证明运行必然失败；不可删 peer/guard 获得通过 |

本轮原包 npm pack --dry-run --ignore-scripts 退出码 0：538 条目，压缩大小 3,139,764 bytes、解包 6,094,357 bytes，包含 dist 508、docs 23、AGENTS、CHANGELOG、skill 和补丁脚本。它未包含 data/任务图，但仍是“独立产品包”，不直接作为“最小嵌入包”的白名单。dry-run 使用现有 dist、未重建，不证明当前 HEAD 构建、安装或宿主可用。

MCP 临时探针因脚本位于临时目录、依赖解析不到 SDK 而未启动（ERR_MODULE_NOT_FOUND），不构成 MCP 健康或业务验收证据。后续消费检查必须从真正安装依赖的隔离消费工程运行，不能用改 NODE_PATH 的临时成功替代。

**三、必须双向保留的具体行为**

| 差异 | 已读取的代码落点 | 回接要求 |
|---|---|---|
| VB 任务终态保护 | src/engine/task-service.ts 的 cancel、pause、resume、run 完成回调 | completed/failed/cancelled/interrupted 不能被晚到取消/暂停改写；仅 paused 可 resume；未知 action 先拒绝 |
| VB 敏感 URL 防落盘 | 同文件 normalizeTaskUrl 与 security/net-policy/redact-sensitive-url.ts | 保护扩展凭据参数；不退回旧窄正则 |
| VB Gateway 沙箱门 | src/gateway/bridge.ts 调用 assertBrowserAllowedUnderSandbox | 目前 ClawX bridge 缺该门；回接时按既有错误治理补齐，不能绕过受管 Host API |
| ClawX 结构化拒绝 | electron/services/agent-browser-api.ts 的 SandboxDenialError | 保留 mechanism/provider/runtimeLevel 等结构，不能降为普通 Error 字符串 |
| ClawX 资源登记 | `packages/versebrowser` 模块的 open/close，经 electron/services/agent-browser-api.ts 适配 | 保留 resource-envelope owner 与登记/释放；失败、迟到完成、取消均检查泄漏 |
| 原凭据与分区 | ClawX Vault、safeStorage、BrowserWindow partition/profile | 不被 standalone 临时目录或 upstream 不支持的 profile 逻辑替换 |
| 原 Runtime provenance | openclaw_runtime/src/agents/tools/agent-browser-tool.ts 和 Gateway result claim | 保留会话归属、来源、连接 allow-list、requestId 与副作用预检 |
| 原桌面入口 | Browser 工作台、Cron task、Web Preview、host-api-client | 继续经 Main host-api，不能由组件直调 SDK/IPC/Gateway |

对于 25 个非 import 文本不同的对应文件，在 M00/M04 建函数和字段级差异表：原行为、VB 行为、保留选择、测试、允许补丁。注释变化、类型抽离和行为变化必须区分。未完成此表之前不得整体替换旧目录。

**四、文件准入与排除**

| 来源内容 | 目标与处理 | 原因 |
|---|---|---|
| src/** 的 127 个产品文件 | packages/versebrowser/src/**，首次原样引入、独立编译 | 保留实现和公开入口闭包；之后按已验收所有权处理兼容文件 |
| LICENSE | packages/versebrowser/LICENSE，原样 | 来源与许可证 |
| package/tsconfig 的必要字段 | 模块最小 package.json、tsconfig.build.json；保留原 exports/ESM 语义 | 配置适配，不复制根项目工程；配置差异逐项登记 |
| scripts/patch-upstream.mjs | 模块内必要构建/安装输入 | 原 runtime 会校验补丁标记，不能当过程脚本排除 |
| 原运行时回归测试 | 模块测试或宿主适配测试，机械改 import、保留断言 | 按测试的静态 import、文件读取、glob 和 fixture 构建完整闭包 |
| scripts 中被迁入测试引用的 fixture/构建器 | 精确文件白名单，保留原 oracle | “scripts/data 一律排除”不能误删真正测试输入 |
| docs 中的稳定契约结论 | 提炼为本手册、harness 与模块短 README/SOURCE | 不整批复制原 docs、claims、outreach、recognition |
| .agent-workbench/** | 本地快照与跨项目任务映射，永不成为模块/安装包输入 | 私有任务连续性，不覆盖宿主图 |
| .local/**、exports/**、原始 logs/截图/实验结果 | 留来源仓及私有归档 | 过程产物不随源码或 Electron 包交付 |
| data/** 837 文件 | 默认留源仓；仅真实迁入测试确有依赖的最小不可变 fixture 例外 | 防止把实验语料库整包搬回；每个例外须写消费者与必要性 |
| .ae/** | 各 workspace 的运行时资产，原位保留 | 虽不进 Git，却可能是用户证据/会话；不能删、不能误当测试夹具 |
| .github、AGENTS、CHANGELOG、独立根 README、package-lock | 不直接引入 | 由 ClawX 工程、政策、pnpm 锁和文档拥有这些职责 |
| node_modules、dist、release、缓存 | 不复制现成目录；从固定源和工具链生成 | 不能通过开发机残留证明安装包完整 |

模块 source、构建输入、测试输入、运行时包、任务历史是五套不同清单。构建 dist 可包含 .js/.d.ts/.map；开发测试与历史不进发行包。不要为了包体积主动剥离 source map 或源码信息：源码归因有依赖，先验证消费者再裁剪。optional semantic/visual 和 remote-policy 可以保留为内部/可选代码，但不默认注册、不扩大范围。

**五、防止任务和运行态数据丢失**

需要分别保护开发任务图、用户的浏览器任务文件、浏览器会话/profile 和 workspace Evidence；只迁 Task Forest 无法保护后三项。

开发任务守恒：本地连续性档案逐项保存源 190 节点的完整验收、evidence、状态、来源，以及 338 边、deviations/alignments/events。用 versebrowser:TF-xxxx@sourceSHA 作唯一来源键；宿主节点由 CLI 自动编号。每个源任务映射到实施检查点或明确的“来源历史/约束”记录，target TF ID 在应用提案后回填。源 done 保持历史事实，integrationStatus 初始 pending/not_evaluated；源两个 proposed 保持需求触发条件，不擅自启动。

历史实验、发布、认可与效率研究保留原记录及来源，不改造成 188 个重新开发任务，也不把旧结论写成 ClawX 新验收。原 task-forest list 字段更新是整数组替换，追加 evidence 必须带全旧数组或使用 CLI 专用 append；严禁从截断输出重建节点。

用户任务守恒：保持现有 getDataDir()/agent-browser/tasks.json 的路径、store version、taskId、steps/counters/verification、approval、timestamps 与 recovery。不把它迁到 tmpdir()/agent-browser-data，不把 taskId 等同于 sessionId，不因装入模块创建第二个默认 TaskService。第一次回接应复用原文件；必须变 schema 时单列可逆迁移，备份旧字节，在合成副本验证，不能直接重写用户数据。

重启语义：原 running 任务按已定义 interrupted 记录恢复原因，不能消失、变 completed 或自动重放副作用；queued/waiting-approval/paused 和终态保留。取消后的迟到回调不能复活；同一任务审批/点击不得发生两次。针对每种已有状态构造 fixture，核对升级前后 ID 集合、状态、数量、owner 和可恢复入口。

会话守恒：开发任务 ID、宿主 taskId、requestId/toolCallId、sessionId、pageId/ref/cursor 各有生命周期，保存显式对应关系。现有会话继续由创建它的引擎处理直到结束；新版本不接管未知 browser/profile。切换仅影响新会话，绝不跨 backend 复用 pageId/ref/cursor 或重连别人的浏览器。运行中的浏览器进程不能靠复制 JSON 延续。

workspace 守恒：实例显式绑定 workspaceRoot；证据和会话限制在相应 .ae。全局 hooks/provider 不是多实例隔离保证，宿主必须处理切换与异步竞态；使用两个 workspace 的并发夹具证明不串任务、证据、授权和清理范围。

**六、能力与归属矩阵**

| 能力组 | 原实现 | ClawX 接线位置 | 最小独立验收 |
|---|---|---|---|
| 基础会话/导航/控制 | engine/service、standalone、playwright-host-api | 既有 agent-browser-api/service 适配层 | open→观察→操作→核对→close，错误/不存在 session 明确失败 |
| 正文、快照与状态差异 | facade、interactive-snapshot、page-text-extractor | Main 结果到模型/桌面观察面 | 原文引用、长页截断、form/ARIA diff、旧 ref 拒绝 |
| 新增原生动作 | upstream-control 与 facade | 类型化 Host API、能力广告 | 选择/勾选幂等、追加与替换、拖放重载后持久、焦点错误拒绝 |
| 多页/frame/dialog | upstream control、tab-manager | 同 session/page owner | popup 不自动选中，陈旧 page/ref/dialog 拒绝，frame detach 负例 |
| 网络观察与授权传输 | recorder、network-context、upstream-control | 现有权限与网络 owner | 动作前 cursor、快速响应、不相关请求、origin/IP/redirect 拒绝 |
| upload/download | upstream files 原实现 | Main 明确路径授权 | 对端回执/磁盘 hash；symlink/junction、覆盖、取消和属性下载负例 |
| 高风险/升级/撤销 | policy、MCP getPolicy、runtime-mode | ClawX permissions/sandbox/审计 | deny/授权/撤销/过期/审计失败；Gateway 与 UI 同门 |
| task/approval/restart | task-service、supervised executor | 同一 TaskService 与原 tasks.json | 所有状态和迟到取消、未知步骤、重启 recovery |
| profile/凭据 | vault、Host service | ClawX safeStorage/partition | 元数据可见，秘密不返回，origin/profile 隔离，解密不可用拒绝 |
| source map/错误归因 | explain-error、electron-source-map、js-source | 宿主限定 resolver/源码根 | 有 map 精确行；缺 map unmapped，不下载任意路径 |
| verify/diagnose/evidence | oneshot-verify、diagnose-pack、evidence/* | 宿主业务断言与证据引用 | 业务 fail 不被 CLEAN 覆盖；采集不足 UNKNOWN；脱敏/路径边界 |
| cancel/dispose/worker | facade、MCP server、persistent-sessions | 当前受管生命周期与 resource-envelope | 取消在途动作，另一任务存活，自有进程释放，失败有恢复引用 |
| semantic/visual | semantic-browser、visual-browser | 显式宿主回调与能力策略 | 不默认启用；缺包/模型不可用诚实拒绝；observe/extract 不变 act |
| 外部 SDK/CLI/MCP 兼容 | 既有 exports 与 cli/server | 模块兼容入口 | 在安装后的包验证，不导入仓库 src 或 .local |

VB 增量 13 方法为 downloadFile、uploadFiles、pointer、drag、selectOption、selectValues、appendText、setChecked、findElement、semanticRead、readForms、readDialogs、respondDialog。既有 67 方法不能为了适配这 13 项被删、改名或缩窄；反之，80 个方法也不必全部成为新的公开模型工具。每项必须标注已接线、内部、显式可选或当前驱动不支持，不能只有文件存在。

**七、架构和依赖实施要点**

目标调用仍沿现有边界：Renderer/Runtime → host-api/既有 Gateway → Main 浏览器适配 → versebrowser 公共 exports → 固定驱动 → ToolResult/现有 HostResponse → 原调用方。模块不能拥有另一套 host task scheduler、审批 authority、resource manager 或 transport fallback。

建议复用既有 agent-browser-api.ts 和 bridge 作为稳定入口，保留调用签名。模块服务需要 ClawX 生命周期/错误注入而现有公开入口不足时，先做极小、具名、带原差异证据的 upstream patch；不得直接把 2,600 行服务改写成新的宿主版本。旧路径可先兼容转发，等所有调用方切完再退役。不要长期保持两套活跃算法或全局默认单例。

MCP 嵌入使用原 createMcpServer 的 workspaceRoot、getPolicy、permissionRecorder、requireAudit、driverProfile 等宿主接缝；API/facade 本身不代表已通过 MCP 的授权门。permissions-hooks 的默认 recorder 是 no-op，workspace provider 默认 null，这些必须实际接到 ClawX 并验证，不得把默认值当成宿主审计或隔离已接线。权限在每次调用重算，工具参数和页面不能给自己 allowedOrigins/paths。

同进程纯类型/工具函数按 exports 消费；含浏览器依赖的路径先验证宿主 Electron/Node 实际版本。worker 仅在必要且经兼容验证时采用既有受管路径，传 JSON 与受控句柄，不传 Playwright Page/BrowserContext、Zod/SDK class。默认 backend 仍 legacy，升级 upstream 的产品默认不在例行迁移里自动修改。

固定原依赖组合：legacy playwright-core 1.63.0；@playwright/mcp 0.0.83 与 playwright/playwright-core 1.64.0-alpha-1790635538000 配套；Stagehand 4.1.0、MCP SDK 1.32.1、zod 4.4.3。ClawX 自己的 playwright-core 1.59.1 和 E2E runner 不强制归一。源 package-lock 只作来源锚点与版本/integrity对照，目标由 pnpm-lock 拥有；不把 npm 和 pnpm 两个根锁并存。

pnpm 下 postinstall 是否允许、补丁是否只作用于该模块固定的两份 coreBundle、pnpm store 是否共享硬链接，都要实测。不能直接运行补丁污染宿主测试 runner 或 store。优先用现有 pnpm patchedDependencies 或受控的包内物化副本应用同一可审计补丁；改变补丁机制需校验原始/补丁后 hash 和四类 runtime 标记。未知版本/不唯一锚点/半补丁必须拒绝。不要去掉 E_UPSTREAM_PATCH。

嵌入包只保留必要 runtime 源/emit、最小 manifest、LICENSE、NOTICE/SOURCE 和所需补丁；原可选能力先保留原依赖，不为“精简”擅自删其实现。生产主进程依赖要进入当前 bundle-main-runtime.mjs/copy-runtime-package.mjs 的依赖闭包和 main-runtime.asar；worker、自有资源和浏览器二进制需进入正确交付位置。资源、asar、原生伴随物和浏览器缓存分别验收，不能靠 dev node_modules 可用来推断。

**八、串行检查点与退出条件**

每轮只推进一个 ready 检查点。顺序如下；其中 M04/M06 可在理论上独立，但本项目仍串行实施以减少同时演进的契约。

| 检查点 | 具体产出 | 通过条件 | 回退边界 |
|---|---|---|---|
| M00 基线与守恒 | 冻结 source/host/dirty bytes、190 任务逐条映射、67+13 API/测试/运行态清单 | 任务无漏项，42 对差异有明确待审清单，所有来源证据可定位 | 尚无产品修改 |
| M01 执行防丢检查 | 小型 source/allowlist/API/任务检查及负例 | 删除文件/方法/任务、引入过程路径、非法 patch 均会失败 | 只撤 checker 变更 |
| M02 模块与依赖 | 最小 workspace、机械源码、单独 emit、依赖/补丁对照 | 127 源保留、exports 可加载、版本/补丁一致、包内容合规 | 未启用模块，旧路径仍可用 |
| M03 宿主 owner | 权限/空间/审计/资源/错误/凭据适配 | 默认拒绝、撤权立即生效、结构化错误不丢、资源成对回收 | 仅撤适配，不改用户数据 |
| M04 契约与观察 | 67 旧方法逐项兼容、13 新方法归属、结果映射 | 正反例同题对照，ref/cursor/正文/截断/错误保真 | 旧契约入口保留 |
| M05 任务与恢复 | 原 task store 与会话归属接线 | ID 集合/状态/审批/终态守恒，重启 interrupted、取消无重放 | 原字节备份+版本配对 |
| M06 操作与复杂页 | 原 upstream 适配与精确授权 | 表单/拖放/page/frame/dialog/文件/截图真实闭环及负例 | 不迁移已打开会话 |
| M07 诊断与证据 | 原记录器、source map、verify、Evidence | 业务判词/采集状态独立，脱敏/越界/缺 map 明确 | 证据路径与原件保留 |
| M08 生产入口 | Runtime→Gateway→Main→模块调用回执 | correlation/owner 完整；摘掉模块/错 owner/缺审计时实际失败 | 不自动落回未授权实现 |
| M09 原回归与矩阵 | 冻结回归、24题业务、宿主专属差异测试 | 失败/未知/not_run 不消失，agent 续接独立判定 | 使用隔离 fixture，不双跑真实副作用 |
| M10 安装包 | 干净消费、Windows Electron E2E、打包执行 | 无 .local/绝对开发路径，真实调用/资源释放/UI状态正确 | 保留上一整套交付版本 |
| M11 切换与回退 | 新会话启用、故障注入、成套 rollback | 默认变更有单独决定；在途会话不串后端、不重放 | source+lock+adapter+schema+assets 成套回退 |
| M12 退役与收口 | 逐调用方兼容转发/退役、最终证据、任务收口 | 无双活实现/遗漏任务/API/测试，文档与包一致 | 删除前仍可恢复精确旧文件 |

M01 的专用 checker、M03 之后适配与 M09–M11 汇总裁决当前均尚未实现。已有来源锁和规格不能代替这些门。

**九、验收分母和差分策略**

区分 A=当前 ClawX、B=冻结 VB 原包、C=ClawX 接回模块后的生产路径。共同能力使用相同独立 fixture 比 A/B/C；新增能力 B/C；ClawX 专属能力 A/C。VB legacy 与 upstream 公共子集仅各有 8 正例+4负例，不能把 upstream 专属 48 项作为旧后端的同分母。归一化只允许预先列明的时间、随机 ID 和展示路径；错误类别、正文、遗漏计数、业务断言和副作用不能忽略。

原 check:install 的 42 个消费检查、G3 的 24题×SDK/MCP=48 项、formal Agent72 的 72 次、ClawX 新的 24题宿主接线验收是四套分母。原报告 46/48 是来源历史读数，mig-01 需要 opt-in 外网授权，默认无外网授权不能照抄 46/48；矩阵文档有 42/44/46 多种表述，实施 M00 需从对应归档原始 outcome 重算并分别说明配置，不能擅自校准历史判词。

源 mig-22 当前双入口 not_run 保留为历史。遵循 ClawX 所有者当前政策，新建 agent 驱动的等价续接验收：在合成本地 auth/challenge fixture 通过既有 operator 接口完成授权、取得一次性 token、重新观察、继续、撤销、过期和 replay 拒绝；写 driven_by: agent、actor: codex。它不冒充真人、不解真实 CAPTCHA、不把原 humanSteps 补造成真人，也不要求所有者操作；验收合同使用新的 agent 步骤类别和独立分母，不把历史 46/48直接改成48/48。

每次运行记录 control runner/expected fixture/source/module/host/lock/build/package hash、实际 Node/Electron/Playwright、起止、命令、exit、产物路径、pass/fail/unknown/not_run 及原因。输入改动让依赖它的证据失效。验收定义/期望值从候选之外的冻结控制副本读取，避免实现者同步修改 oracle。schema 校验通过、import成功、mock UI 通过、目录存在、Harness dry-run 各自只证明自己的层级。

原 tests 全 160 文件已冻结，但尚未声称全部需要复制到模块。M00 为每个测试登记：模块运行时必需、ClawX 专属、新增桥接、来源研究/发行检查或 helper；运行时测试的依赖闭包必须完整，研究与语料测试保留源仓运行。不得用“过程产物排除”裁掉产品负例，不得删断言、缩 glob、加 skip、改 golden 换取通过。

重点门：原 task-service、toolbox-host-authority/embedding/review、MCP cancel/shutdown、snapshot/text/ref、network、upstream input/form/tab/frame/file、source-map、verify-collection、redaction/path guards、persistent lifecycle；宿主现有 agent-browser unit、runtime provenance、sandbox/error/resource 与 Workbench E2E。当前 Workbench E2E 的 Host API mock 只证明 UI 投影，需另有实际生产服务/模块调用验收。模型侧实际收到的 ToolResult 与 Runtime 最终结果必须验信息保真，不能只在 SDK 里看见新字段。

**十、具体执行门、阶段记账与回滚**

~~~powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
node harness/src/cli.mjs context --spec harness/specs/tasks/versebrowser-upstream-reintegration.md
node harness/src/cli.mjs validate --spec harness/specs/tasks/versebrowser-upstream-reintegration.md --since HEAD
node harness/src/cli.mjs run --spec harness/specs/tasks/versebrowser-upstream-reintegration.md --dry-run
~~~

以上仅准备/结构检查。实施时按检查点显式执行模块 build/typecheck/原回归、实际消费与宿主业务检查，并执行 ClawX 的 pnpm contract:check、pnpm run typecheck、pnpm run comms:replay、pnpm run comms:compare、相关 Electron E2E、pnpm run build:vite 和真实打包复核。pnpm harness run 按 requiredProfiles 选门，requiredTests 列表不保证被执行，必须核对实际回执。最终运行 harness:ci 和相关 policy/evidence gates，不能借 unrelated diff 放宽门禁。检查使用非自动修复模式，避免格式化全仓。

每次 checkpoint 记 input hashes、确切改动文件/函数、允许补丁、运行命令/exit/磁盘证据、剩余缺口与 next。Task Forest 操作走 CLI；base_graph_hash 失配就重读重建提案，不用 allow-stale 强行应用。仓库路径别名解析后再取锁；M00 应核对 canonical nodes/edges 和 config hash，不根据旧 handoff 的状态决定关闭。

回滚不是只换一个 tarball：固定 module source/patch、pnpm lock、Main adapter、host/runtime contract、browser/runtime assets、state reader/version 与 default selector 的配套版本。旧代码仍需经过当前权限门；运行失败返回明确不可用/恢复信息，不暗中自动回放敏感操作。若数据迁移不可逆，不宣称可回滚，先改成兼容 reader/新文件或缩小迁移。

最终完成条件：所有源任务已解释归属且无遗失；必需能力和旧 67 方法无缺项；新方法的公开/内部/可选边界明确；源实现/必要测试/补丁保留；真实 host/model/安装包证据绑定最终候选；任务/会话/凭据/证据和 resource owner 守恒；不包含过程产物；切换和回滚经过实跑；新文档与三个 README 经过行为同步审查。满足证据后按本仓自动收口政策处理，发布/公开和冻结默认值变化留作所有者决定。

**给下一轮执行 agent 的固定开场**

~~~text
这是 VerseBrowser 模块回接，不是重写。先读本 task/rule/playbook/source-lock、两仓当前 diff 和本地 continuity/task-crosswalk。只推进当前 ready 检查点。原产品实现和冻结测试是来源权威，宿主拥有权限/任务/资源/凭据/transport。列明本批改动与字段映射，再运行来源与必要基线。不得按描述重新生成 engine/facade，不得删测试/字段/能力来过门，不得把 source done/旧报告/装包 import 当成 ClawX 已验收。所有交互由 agent 自动完成，诚实标记来源。变更后读盘回执、更新 checkpoint；缺项如实写明，保持任务和用户运行态可恢复。
~~~
