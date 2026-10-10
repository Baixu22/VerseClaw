# vtoken 分发形态与 .vt 格式契约（issue #97 收口）

Date: 2026-10-10 (agent-driven)
Base: `codex/nop-issues-batch1-20261010` = `ca093b5fba29f201121be73cb3df57cc964c5e07`
Issue: Baixu22/VerseClaw#97
范围: 只读代码事实核查 + 一处仓库卫生修复。未改动 `openclaw_runtime/`、electron 源码、产品默认值或共享 JSON 登记表。

本文件所有结论来自本次会话对工作区磁盘的读取，命令行输出记录在
`D:/ClawX-work/nop-issues-batch1-20261010/issue-97/logs/`。全部为 agent 驱动；
不声称任何真人验证。

---

## 结论

### AC1 — vtoken Python sidecar 的分发前提

**随安装包分发的是 uv 二进制，不是 Python。Python 3.12 在首次运行时联网拉取。**

1. **打包内容**：`electron-builder.yml` 的 `extraResources` 把 `packages/vtoken/src`
   映射为 `resources/vtoken/src`（`electron-builder.yml:59-65`），因此安装包内只有
   纯 Python 源码，不含解释器、不含虚拟环境、不含依赖。
   注意 `asarUnpack`（`:75-83`）只解包 `**/*.node` 与 `**/node_modules/lru-cache/**`，
   与 vtoken 无关。
2. **uv 随包分发**：`mac.extraResources` / `win.extraResources` / `linux.extraResources`
   各自把 `resources/bin/<platform>-<arch>/` 拷到安装目录的 `bin/`
   （`electron-builder.yml:92-93`、`:140-141`、`:168-169`）。其中
   `resources/bin/**` 由 `pnpm run uv:download`（= `zx scripts/download-bundled-uv.mjs`）
   生成，脚本把 uv release 解包后落到 `resources/bin/<platform>-<arch>/uv[.exe]`
   （`scripts/download-bundled-uv.mjs:9`、`:53`、`:90`）。uv 版本被 `0.10.0` 钉死并带
   sha256 校验（`scripts/release-integrity-manifest.mjs:4-38`）。
   `resources/bin` 在根 `.gitignore:72` 被忽略 —— 它是**构建产物**，由 `pnpm run init`
   在打包前下载，而不是仓库内容。
   （旁证：`resources/` 顶层映射显式 `!bin/**` 排除 bin，见 `electron-builder.yml:23-29`，
   所以 uv 只经上面三条平台映射进包。）
3. **运行期定位 uv**：
   - 主进程 bridge：`electron/services/vtoken-bridge.ts:110-123`（`resolveUvBin()`），
     打包时取 `resourcesPath/bin/uv.exe`（`:115-117`），开发时取
     `cwd/resources/bin/<platform-arch>/uv.exe`（`:118-121`），两者都不存在才回落到
     `PATH` 上的 `uv`（`:122`）。
   - Gateway 还会把 `resourcesPath/bin` 前置进 PATH 传给 runtime
     （`electron/gateway/config-sync.ts:1096-1099`、`:1142-1144`），所以 runtime 侧那句
     裸 `uv`（见 AC2）在打包形态下也能命中随包 uv。
4. **Python 3.12 需要联网首次拉取**：sidecar 用 `uv run --python 3.12` 启动
   （`electron/services/vtoken-bridge.ts:198`；runtime 侧同构：
   `openclaw_runtime/src/context-engine/vtoken-rpc-client.ts:192`）。启动前会
   `uv python find 3.12` 探测，缺失则执行 `uv python install 3.12`
   （`electron/utils/uv-setup.ts:96`、`:122`）。这是一次**第三方网络下载**
   （默认 astral 的 python-build-standalone；CN 区域会叠加镜像
   `electron/utils/uv-env.ts:8-14`）。
5. **因此：`uv` 不需要用户自备；`python3.12` 也不需要用户自备；但首次启用需要网络。**
   离线机器的第一次启用无法完成 —— 除非镜像里已经缓存了 python-build-standalone。
6. **uv 缺失时用户看到什么**：先看 `resolveUvBin()` 是否命中 bundled；命中则不会报错。
   若确实缺失，`checkUvInstalled()` 返回 false，`ensurePythonReady()` 抛出
   `'uv is not available; cannot start vtoken worker'`
   （`electron/services/vtoken-bridge.ts:179-183`）。该错误被 `vtokenEnsureStarted()`
   捕获并塞进 `VtokenStatusResult.error`，同时带上 `packageRoot`
   （`electron/services/vtoken-bridge.ts:528-542`）。UI 侧 Settings > Developer 的
   Verse Token Bridge 面板通过 `hostApi.vtoken.ensureStarted()`
   （`src/components/settings/VtokenBridgePanel.tsx:77`）把该 `error` 显示出来。
7. **重要前提：vtoken 默认关闭。** 桥接默认 OFF，必须显式开启
   （`electron/services/vtoken-bridge.ts:63-79`，默认分支 `:77-78` return false；
   `docs/dev/default-config-matrix.md:14-15` 把二者都记为默认 `false`）。
   即：**绝大多数用户永远不会触发 Python 拉取**，因为默认路径根本不起 sidecar。
8. **注意一处 dev-mode 不对称**：`resolveUvBin()` 会找
   `cwd/resources/bin/<target>/uv.exe`，但 `checkUvInstalled()` 走
   `electron/utils/uv-setup.ts:32-51` 的 `resolveUvBin()`，其 `source==='path'` 分支
   只做 `where.exe uv`（`:53-61`、`:66-72`）。所以在**未打包的开发环境**里，即使
   `resources/bin/<target>/uv.exe` 存在，`checkUvInstalled()` 仍可能判定 uv 不可用，
   除非 PATH 上也有 uv。打包环境走 `source==='bundled'` 分支不受影响。
   这是一处真实缺陷，本批次**未修改**（超出文件范围），仅记录。

### AC2 — `vt.pack` 调用路径（复核并更正 issue 评论）

issue 评论描述的「两条独立路径」拓扑**成立**，但方法计数有偏差，且有若干行号需更正。

**路径 A（UI 驱动，经主进程）— 已核实**

```
VtokenBridgePanel.tsx:29,50,77,98,103-109   hostApi.vtoken.*
  → shared/host-api/contract.ts:5090-5103   （12 个方法签名）
  → electron/services/vtoken-api.ts:18-33   （逐个转发到 bridge）
  → electron/services/vtoken-bridge.ts      → Python vtoken.host_rpc
```

转发到 Python 的**是 9 个**，对应 `vtoken-api.ts:20-28`：

```
vt.ping (:20)  vt.open (:21)  vt.ingest_path (:22)  vt.ingest_markdown (:23)
vt.ingest_tools (:24)  vt.ingest_memory (:25)  vt.assemble (:26)  vt.stats (:27)
vt.close (:28)
```

主进程本地处理 **3 个**：`getStatus`（`:29`）、`setEnabled`（`:30`）、
`ensureStarted`（`:31`）。其中 `ensureStarted` 是**混合体**：它在主进程里判定开关、
必要时再拉起 worker，本身不是一个 RPC 方法
（实现在 `electron/services/vtoken-bridge.ts:516-543`）。

9 + 3 = 12，与 `contract.ts:5091-5102` 的 12 个签名吻合。
`README.HOST.md:58-71` 的方法表把 `vtoken.close → vt.close` 也列为 RPC 转发项，
与 `vtoken-api.ts:28` 一致，同样是 9 条转发。

> **对 issue 评论的更正**：评论称转发 9 个、主进程本地 3 个 —— 这个**总数与划分正确**。
> 但评论正文列举「转发」时只列出了 `vt.ping / vt.open / vt.ingest_path /
> vt.ingest_markdown / vt.ingest_tools / vt.ingest_memory / vt.assemble / vt.stats /
> vt.close` 并标注为转发的 9 个，而它在结论句里又把 `vt.close` 与另外 8 个并列描述为
> 「转发 9 个方法 … 另 3 个由主进程本地处理」，容易读出歧义。以
> `vtoken-api.ts:20-31` 为准：**转发 9 个（含 `vt.close`），主进程本地 3 个**。

**路径 B（runtime 内部，不经 host-api）— 已核实**

```
openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:247
  → context-engine/context-orchestrator.ts:802
  → context-engine/chat-turn-vtoken-injection.ts:405 computeVtokenExtraSystemPrompt
  → chat-turn-vtoken-injection.ts:371   client.pack({...})
  → context-engine/vtoken-rpc-client.ts:261-295  VtokenRpcClient.pack()
  → vtoken-rpc-client.ts:269            "vt.pack"  （RC-03 pre-seal 生产者）
```

- `vt.pack` 的 Python 端实现在 `packages/vtoken/src/vtoken/host_rpc.py:177-178`，
  是 `dispatch()` 里唯一 **无状态** 的方法（`host_rpc.py:5`、`:110-163`）。
- RC-03 生产者登记：`openclaw_runtime/src/context-engine/rc03-producers.ts:15`
  `vtokenPacker: 'vtoken-packer'`，`:74-77` 声明其用途。issue 评论引用的
  `rc03-producers.ts:15` / `:74` **准确**。
- issue 评论引用的 `vtoken-rpc-client.ts:269` 与 `:281`
  （`"vt.pack returned an invalid VtokenPackResult/v1"`）**准确**。
  schema 常量 `VtokenPackRequest/v1` / `VtokenPackResult/v1` /
  `chars_div_4` 定义在 `vtoken-rpc-client.ts:12-14`，Python 侧对端常量在
  `host_rpc.py:32-34`。

**路径 B 的包根注入（已核实，但行号需更正）**

issue 评论写 `config-sync.ts:1135,1169-1170`。实际是
`electron/gateway/config-sync.ts:1151-1164` 计算 `vtokenPackageRoot`，
`:1185-1187` 注入 `VERSE_VTOKEN_PACKAGE_ROOT`。runtime 侧消费该变量：
`vtoken-rpc-client.ts:119-142`（`resolveVtokenPackageRootFromEnv`，`:123-127` 优先读
env，`:135` 兜底 `VERSE_RESOURCES_PATH`）。
**两套定位机制确实不同**：路径 A 由主进程自己 `resolveVtokenPackageRoot()`
（`vtoken-bridge.ts:93-102`）并直接 `spawn`；路径 B 由主进程注入 env、
runtime 自己再 `spawn` 一个**独立的** uv/Python 进程。
`vtoken-rpc-client.ts:5-6` 的注释也自述这一点（"Electron Main has a sibling bridge
for host-api diagnostics; this client is the production assembly path"）。

**方法集不对称结论**

Python `dispatch()` 实现 10 个方法（`host_rpc.py:170`/`:177`/`:180`/`:218`/`:227`/
`:237`/`:247`/`:256`/`:282`/`:286`，共 10 个 `if method == "vt.*"` 分支，其中
`vt.pack` 在 `:177`；批次负责人复核时逐条计数确认为 **10**，非初稿所写的 11），
TS `hostApi.vtoken` 暴露 12 个（`contract.ts:5091-5102`）。
差额不是「缺失实现」：`vt.pack` 是**路径 B 专用**（runtime 内部契约，不经 host-api），
而 `getStatus` / `setEnabled` / `ensureStarted` 是**主进程本地生命周期方法**。
issue 评论的「已排除误报」结论**成立**。

### AC3 — `.vt` 格式的稳定性契约

**没有一个版本化的公开契约；存在的是一组分散的、部分隐含的约定。**
具体拆解如下（v1 稳定面 vs 内部实现细节）。

**稳定 v1（有代码常量或明确文档背书）**

| 契约面 | 证据 | 稳定性 |
|---|---|---|
| `%vt <version>` 必须是第一行，版本形如 `\d+\.\d+(\.\d+)?` | `parser.py:38-39`、`:19`、`:103-108` | 稳定；`VERSION_RE` 是唯一校验 |
| 头部指令集合 `vt/mode/id/session/lang/schema/ns` | `parser.py:21` `KNOWN_DIRECTIVES` | 稳定；未知指令报 `unknown_directive` |
| `%mode` 必填且只能是 `doc` / `mem` | `parser.py:60-61`、`:109-113` | 稳定 |
| core 节点类型 8 个 + core 关系 7 个 | `schema.py:11-20`、`:26-34` | 稳定；自有 schema 不得重定义（`schema.py:102-106`、`:119-123`） |
| 保留符号 `REF` / `//` | `schema.py:37` `RESERVED_SYMBOLS` | 稳定 |
| 自定义 schema：`%schema <name> extends core`，只允许 extends core | `schema.py:88-98`、`:129-131` | 稳定但**只能继承 core**（Phase 1 限制） |
| `.vtg` 编译产物版本 | `compiler.py:19` `VTG_FORMAT_VERSION = 1`，写入 payload `:25` | 稳定；`0.4` 新增可选字段仍声明向后兼容（`compiler.py:36-38`） |
| `.vtg` 幂等性（不含时间戳/绝对路径） | `compiler.py:3-8`、`:36-38`；`DECISIONS.md:11`（D2） | 硬保证 |
| `.vtg` 原子写 | `compiler.py:53-59`（D7） | 硬保证 |
| RPC 线协议 schema 标签 | `host_rpc.py:32-34`、`vtoken-rpc-client.ts:12-14` | 稳定，**这是唯一显式带 `/v1` 的契约** |
| host-api ↔ RPC 方法映射表 | `README.HOST.md:52-71` | 文档级契约 |

**不构成对外契约 / 属内部实现细节**

- `README.md` **不是** 36 KB 设计文档。实际 608 字节，只有 6 行内容，仅说明
  「这是一个 Python 3.12 + uv 项目，位置 `packages/` 是刻意的，改动需同步打包映射/
  启动器/留存策略/启动测试」。36 KB 之说**不成立**。
- 真正的设计文档是 `DECISIONS.md`（43,737 B）、`HANDOFF.md`（22,885 B）、
  `AUDIT_SUMMARY.md`（21,507 B）。它们是**内部决策记录**，含大量「实测/native 环境」
  叙述与历史裁决，无版本协商或弃用政策。
- **没有任何 deprecation policy / 兼容性承诺 / 版本协商机制**。`DECISIONS.md` 里的
  「向后兼容」表述都是针对具体字段（如 D31 的 `slot`/`priority` 缺省值，
  `compiler.py:36-38` 的注释同理），不是格式级承诺。
- `.vt` 的版本号 `%vt 0.3.1` 与包版本 `0.4.3` **不同步**：
  示例文件写 `%vt 0.3.1`（`examples/doc/auth.vt:1`、`examples/doc/middleware.vt:1`、
  `examples/mem/session_example.vt:1`），而 `pyproject.toml:7` `version = "0.4.3"`、
  `src/vtoken/__init__.py:16` `__version__ = "0.4.3"`、
  `src/vtoken/mcp_server.py:228` 又写 `"0.3.1"`。即**版本三元组互相漂移**。
- `requires-python` 也不一致：`pyproject.toml:9` / `setup.py:12` 写 `>=3.10`，
  `uv.lock:3` 写 `>=3.10`，而 `README.md` 与启动参数都要求 3.12
  （`vtoken-bridge.ts:198`）。`>=3.10` 与实际运行形态不匹配。
- `.vt` 已被 D31 主动**降级**为「高级用户可选调试格式，类比 `.proto`」
  （`DECISIONS.md:40`），并明确列出「明确不做：`.vt` 用户教育」。这与「公开稳定契约」
  的定位相反 —— 官方立场是它**不是**主入口。

**一句话结论**：`schema.py` + `parser.py` 定义了一个**事实稳定、但未版本化承诺**的语言
子集；唯一有显式版本标签的对外契约是 JSON-RPC 的 `VtokenPackRequest/v1` /
`VtokenPackResult/v1`。若未来要演进 `.vt`，当前**没有**版本协商机制可用，
需要新建（建议落在 `%vt` 头部的语义化版本上）。

---

## 证据

所有命令在 `D:/ClawX-candidates/nop-issues-batch1-20261010` 执行；原始记录见
`D:/ClawX-work/nop-issues-batch1-20261010/issue-97/logs/`。

| 结论 | 文件:行 | 产生该结论的命令 |
|---|---|---|
| 打包只含 vtoken 源码 | `electron-builder.yml:59-65` | `Get-Content electron-builder.yml -Raw` |
| uv 随包进 `bin/` | `electron-builder.yml:92-93,140-141,168-169` | 同上 |
| uv 落盘位置 | `scripts/download-bundled-uv.mjs:9,53,90` | `read scripts/download-bundled-uv.mjs` |
| uv 版本钉死 + 校验 | `scripts/release-integrity-manifest.mjs:4-38` | `Select-String -Path scripts/release-integrity-manifest.mjs -Pattern uv` |
| `resources/bin` 是构建产物 | `.gitignore:72`；`git ls-files resources/bin` 计数 0 | `git ls-files resources/bin` |
| 本 checkout 未下载 uv | `resources/bin` 不存在 | `Test-Path resources/bin` → False |
| bridge uv 定位 | `electron/services/vtoken-bridge.ts:110-123` | `read electron/services/vtoken-bridge.ts` |
| `uv run --python 3.12` | `electron/services/vtoken-bridge.ts:198` | 同上 |
| uv 缺失错误路径 | `electron/services/vtoken-bridge.ts:179-183` | 同上 |
| 错误冒泡到状态对象 | `electron/services/vtoken-bridge.ts:528-542` | 同上 |
| Python 拉取 | `electron/utils/uv-setup.ts:96,122`；镜像 `electron/utils/uv-env.ts:8-14` | `read electron/utils/uv-setup.ts` |
| dev-mode uv 判定不对称 | `electron/utils/uv-setup.ts:32-51,53-61,66-72` | 同上 |
| Gateway PATH 注入 | `electron/gateway/config-sync.ts:1096-1099,1142-1144` | `read electron/gateway/config-sync.ts 1090-1130` |
| `VERSE_VTOKEN_PACKAGE_ROOT` 注入 | `electron/gateway/config-sync.ts:1151-1164,1185-1187` | `grep VERSE_VTOKEN config-sync.ts` |
| 默认 OFF | `electron/services/vtoken-bridge.ts:63-79`；`docs/dev/default-config-matrix.md:14-15` | `grep vtoken docs/dev/default-config-matrix.md` |
| host-api 12 方法 | `shared/host-api/contract.ts:5090-5103` | `grep vtoken shared/host-api/contract.ts` |
| 转发/本地分流 | `electron/services/vtoken-api.ts:18-33` | `read electron/services/vtoken-api.ts` |
| UI 调用点 | `src/components/settings/VtokenBridgePanel.tsx:29,50,77,98,103-109` | `grep hostApi\.vtoken src` |
| `vt.pack` runtime 路径 | `attempt.ts:247` → `context-orchestrator.ts:802` → `chat-turn-vtoken-injection.ts:405,371` → `vtoken-rpc-client.ts:261-295,269` | `git grep computeVtokenExtraSystemPrompt`; `read` 各文件 |
| RC-03 生产者登记 | `openclaw_runtime/src/context-engine/rc03-producers.ts:15,74-77` | `Select-String rc03-producers.ts vtoken` |
| runtime 包根解析 | `vtoken-rpc-client.ts:119-142` | `read vtoken-rpc-client.ts` |
| Python dispatch 11 方法 | `packages/vtoken/src/vtoken/host_rpc.py:170,177,180,218,227,237,247,256,282,286` | `grep "vt\." host_rpc.py` |
| `%vt` 校验 | `parser.py:19,38-39,103-108` | `read parser.py 1-140` |
| core schema | `schema.py:11-20,26-34,37,88-98,102-106,119-123,129-131` | `read schema.py` |
| `.vtg` 版本/幂等/原子 | `compiler.py:3-8,19,25,36-38,53-59` | `read compiler.py` |
| 版本漂移 | `pyproject.toml`; `src/vtoken/__init__.py:16`; `src/vtoken/mcp_server.py:228`; `examples/doc/auth.vt:1` | `read` 各文件 |
| D31 降级 .vt | `DECISIONS.md:40` | `Select-String DECISIONS.md 兼容\|version` |
| RPC `/v1` 契约 | `host_rpc.py:32-34`；`vtoken-rpc-client.ts:12-14` | `grep` 两文件 |
| host-api 方法表 | `README.HOST.md:52-71` | `read README.HOST.md` |
| `README.md` 实为 608 B | `packages/vtoken/README.md`（6 行） | `Get-ChildItem packages/vtoken`; `read README.md` |

### 关于 `pnpm-workspace.yaml` 的注释引用（额外核实）

`pnpm-workspace.yaml:1-2` 注释指向 `packages/vtoken/README.md` 与
`docs/dev/repository-layout.md`。**两者都存在且都被跟踪**，不是悬空引用：

```
$ git ls-files docs/dev/repository-layout.md
docs/dev/repository-layout.md
$ Test-Path docs/dev/repository-layout.md
True
```

（附带核实，非缺陷：`docs/dev/repository-layout.md` 在
`scripts/repository-artifacts.json` 里出现两次，但分属两个不同数组 ——
`requiredInputs`（第 38 项）与 `retainedFiles`（第 1579 项）。两者本就有意重叠
（必需输入同样属于已复核保留文件），`checkRepositoryArtifacts()` 的重名检查只作用于
单个数组内部，因此不报错。此处记录以免后续会话重复误判。）

---

## 已修复

### 缓存文件被误跟踪（issue #97 「已知约束 1」）

**根因（字节级证据）**：`packages/vtoken/.gitignore`（基线 474 B）的第 18 行是一条
**以 `#` 开头的注释**，而 `.tiktoken_cache/` 模式文本被**直接追加到该注释行的行尾、
中间没有换行符**：

```
line18 = "# T1 <注释正文…锛?" + ".tiktoken_cache/"     （108 B，文件偏移 301-409）
                        ^ 0x3f = ASCII '?'            ^ 该模式与注释同处一行
```

紧邻模式之前的字节是 `… e9 94 9b 3f`（`锛` 的 UTF-8 尾字节 + ASCII `?`），**其后没有
`0a`** —— 也就是说换行符缺失，整行因此都是注释，模式**从未生效**。
这不是「模式写错」，也不是编码问题：该文件在修复前后都是**合法 UTF-8**
（474 B → 475 B 均为字节级 UTF-8 往返一致）。

需要与另一个**无关的既有缺陷**区分开：该文件里的中文注释字节本身是前一次错误解码留下的
**mojibake**（例如 `# 缂栬瘧浜х墿…`），但它仍是合法 UTF-8 编码的文本，
与本次修复无关，本变更集不处理（详见「未改动的相邻缺陷」）。

```
$ git check-ignore -v --no-index packages/vtoken/.tiktoken_cache/9b5ad71b...
（无输出）exit=1            # 修复前：不匹配
$ git ls-files -i -c --exclude-standard
（无输出）exit=0            # 修复前：影子跟踪检测器看不见它
```

**修复**：在该行插入恰好一个 `\n`，让模式独占一行；注释字节原样保留，
不做任何重编码，不引入 BOM。

```
$ node scripts/check-no-bom.mjs
check-no-bom: ok
```

字节级前后对比：

| 项 | 修复前 | 修复后 |
|---|---|---|
| `packages/vtoken/.gitignore` 字节数 | 474 | 475（+1 = 插入的 `\n`） |
| `packages/vtoken/.gitignore` sha256 | `5ddd94be…64cbd2f` | `166bcd8c…ec9a1a130` |
| BOM | 无 | 无 |
| `git check-ignore -v --no-index <cache>` | exit 1（不匹配） | exit 0（`packages/vtoken/.gitignore:19:.tiktoken_cache/`） |
| `git ls-files -- <cache>` | 已跟踪 | 空 |
| `git ls-files -i -c --exclude-standard -- <cache>` | 空 | 空 |
| 磁盘文件 sha256 | `223921b7…865b2a7` | `223921b7…865b2a7`（**未变**，186 万字节仍在盘上） |

**因果验证**：仅修好 `.gitignore` 而尚未 untrack 时，
既有门禁 `node scripts/check-repository-artifacts.mjs` **立刻失败**：

```
Tracked path is ignored: packages/vtoken/.tiktoken_cache/9b5ad71b2ce5302211f9c61530b329a4922fc6a4
exit=1
```

这证明门禁逻辑本身没问题，此前漏报纯粹是因为 ignore 模式失效、
`git ls-files -i` 无从发现。执行 `git rm --cached` 后门禁恢复通过
（`17183 → 17182` tracked paths，与被移除的 1 个文件吻合）。

**回归防护**：扩展既有卫生测试
`tests/unit/repository-artifact-retention.test.ts`（该文件已含 #63/#68 同类的
shadow-tracking 用例，故复用而非新建），新增两条断言：

1. `git ls-files -- packages/vtoken/.tiktoken_cache` 必须为空；
2. 把**真实的** `packages/vtoken/.gitignore` 逐字节复制进临时 git 仓库后，
   `git check-ignore --no-index` 必须命中该缓存路径。

本守卫自带临时 fixture，因此**没有**改动该文件既有的合成策略 fixture
（`createFixture()` 保持不变，避免为无断言的分支改动共享夹具）。

### 两层防护的分工（含由批次负责人补齐的一层）

| 层 | 机制 | 由谁落地 |
|---|---|---|
| L1 事实层 | `packages/vtoken/.gitignore` 修复（模式独占一行） + `git rm --cached` 取消跟踪；回归守卫断言无被跟踪路径且模式在真实 git 上下文里命中 | **本变更集** |
| L2 策略层 | 在 `scripts/repository-artifacts.json` 中把 `packages/vtoken/.tiktoken_cache` 加入 `localOnlyDirectories`，使 `isLocalArtifact()` 命中并产出 `Local artifact is still tracked: <path>` | **已由批次负责人在同一变更集落地**（`scripts/repository-artifacts.json` 属 #75 子任务的文件范围，故由负责人统一登记） |

L2 已落地，因此本变更集的防护是两层齐备的：L1（ignore 模式 + 取消跟踪 + 回归守卫）负责事实层，
L2（保留策略）负责即使 ignore 模式将来再次失效也能 fail-closed。

**已做反证（falsification）**：把 `.gitignore` 还原为 HEAD 的破损版本后运行测试，
新守卫**如期失败**（`1 failed | 11 passed`，报错于
`repository-artifact-retention.test.ts:210`）；再应用修复后恢复全绿
（12 passed），且 `.gitignore` sha256 回到 `166bcd8c…`。

### 未改动的相邻缺陷（仅记录）

`packages/vtoken/.gitignore` 其余中文注释字节是**双重编码 mojibake**
（UTF-8 文件内容本身即是乱码，例如 `# 缂栬瘧浜х墿…`）。这是与本次修复无关的
既有缺陷，且反向解码在其中一个字符（U+E749，私用区）上不可逆，
无法安全还原。为把 diff 限制在最小必要改动并避免引入新的乱码，
本次**只插入换行、不重写任何注释字节**。建议后续单独修（并注意该文件必须保持
UTF-8 无 BOM，见 `scripts/check-no-bom.mjs`）。

---

## 未验证 / 边界

以下内容在本机**无法**验证，均为推断或未取证：

1. **没有构建过任何安装包。** 本 checkout 内 `resources/bin` 不存在，
   `release/` 未构建，未运行 `pnpm run uv:download`，未运行 `pnpm run build`、
   未运行 `pnpm run build:vite`，未跑 Electron E2E。
   因此「安装包内实际是否含 uv」是**基于配置与脚本的推断**，不是对真实产物的取证。
   要落实需在可构建环境执行 `pnpm run uv:download:all` + 打包后检查
   `resources/bin/` 与 `resources/vtoken/src` 的实际落盘。
2. **未实测「uv 缺失」的用户可见报错。** 本机 PATH 上已存在 `uv`
   （按 issue #69 的口径，此处不记录机器本地的绝对安装路径），
   且打包路径未构建，故 `'uv is not available; cannot start vtoken worker'`
   这条分支**未被真实触发**，结论来自源码阅读。
3. **未实测离线首次启用。** 本机有 `python 3.10.3`，但未验证
   `uv python install 3.12` 的联网行为，也未在断网条件下验证
   「缓存命中可离线」这一假设 —— 该假设未取证。
4. **未运行 vtoken 的 Python 测试。** `packages/vtoken/tests` 未执行
   （本批次限定只跑 JS 单测）。AC2/AC3 的 Python 侧结论来自源码阅读，
   未用测试行为交叉验证。
5. **未运行全量门禁。** 按批次约束未跑 `pnpm run lint`、未跑完整测试套件、
   未跑 typecheck。已跑的只有：目标单测文件、
   `node scripts/check-no-bom.mjs`、`node scripts/check-repository-artifacts.mjs`。
6. **未验证安装包在 macOS / Linux 上的 uv 分发。** 仅按
   `electron-builder.yml` 的 `mac` / `linux` 段做了配置级阅读。
7. **AC3 的「无版本协商机制」是负向结论。** 依据是在
   `schema.py`/`parser.py`/`compiler.py`/`DECISIONS.md` 中未找到此类机制；
   不能排除在本次未读的文件（如 `HANDOFF.md` 全文、`AUDIT_SUMMARY.md` 全文）中
   存在相关表述。

### 已知的、本次未修的代码缺陷

- `electron/utils/uv-setup.ts:32-51` 的 dev-mode 不对称（见 AC1 第 8 条）：
  开发环境可能忽略已下载的 bundled uv。超出本批次文件范围，未改。
- `packages/vtoken/.gitignore` 注释 mojibake（见「已修复‑未改动的相邻缺陷」）。
- 版本三元组漂移：`.vt` 头 `0.3.1` / 包 `0.4.3` / `mcp_server.py` `0.3.1`
  / `requires-python >=3.10` vs 运行时 `--python 3.12`。均为记录，未改。
