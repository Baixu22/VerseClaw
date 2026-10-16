# N8（TF-0353）干净消费与实际安装包 — 2026-10-16 证据汇总

状态：**未通过**（节点保持 open）。包本身构建成功、结构校验通过、安装器载荷可在 checkout 之外独立运行，但**安装态基础闭环不成立**，另有一处回收缺口。

## 1. 本轮构建（candidate `codex/vb-invocation-n1-20261016` @ `5fb0005a`）

- 工作树：`D:\ClawX-candidates\vb-invocation-n1-20261016`（构建前先把残留 `dist/`、`dist-electron/` 移出工作树到 `D:\tmp\n8-residual-20261016-215110`，确保产物不来自残留）。
- 命令链：`pnpm run prep:win-binaries` → `pnpm run package` → `node scripts/patch-nsis-win.mjs` → `node scripts/run-electron-builder.mjs --win --publish never`（**未使用** `electronDist`/`signAndEditExecutable` 等规避参数，即仓库原始发布链）。
- 工具链：Node `24.16.0`（`D:\ClawX-candidates\node-24.16.0`）、pnpm `11.2.2`、Electron `40.8.4`（冻结）、electron-builder `26.8.1`。
- 退出码：`prep` 首轮 exit 1（下载器缺陷，见 §4.1），分段补齐后全 0；`pnpm run package` exit 0（17.5 分钟）；`patch-nsis-win` exit 0；`electron-builder --win --publish never` exit 0。
- 产物：`release/Verse Claw-0.4.9-alpha.0-win-x64.exe`（678,434,139 B，NSIS）与 `release/win-unpacked/`（87,905 文件 / 2.96 GB）。

产物身份（`artifact-identities.json`）：

| 对象 | bytes | sha256 |
| --- | --- | --- |
| NSIS 安装器 | 678434139 | `8495e70a6262975521b86b4086ef6148a7f40969a27dbc07541d5bf0fefcd926` |
| `win-unpacked/Verse Claw.exe` | 214315008 | `c68d07a0c840902f8b6c4ddc7a53fbb3c3f4abd4c3358af54609711bfea1360f` |
| `resources/app.asar` | 304070487 | `0fd04feb2e5f7c838407118e18f6e6d0d2c877f3dc38e8ed8e356b99946f7547` |
| `resources/main-runtime.asar` | 836527225 | `b5a22d6fc776af17a83ab6fa36cc8663013866f143b205ce8f48947b6b2ce81c` |
| `build/main-runtime-delivery/main-runtime.asar` | 836527225 | 与包内**逐字节相同** → 包内 runtime 身份绑定成立 |
| `resources/bin/ae.exe` | 15144448 | `3ed2174fee9b9d38ac34334211d9fd3187bc3b9a1e146a7db05eee64e9fd93f2` |

## 2. 验证结果

### 2.1 包结构 / 依赖卫生：**pass**（`package-verify.json`）

`node scripts/versebrowser-m10-package-verify.mjs --release` exit 0，`issues: []`；包内 `main-runtime.asar` 与 `app.asar` 两份都无 `dev_path_leak`（0 命中），模块可加载（`packagedModuleLoad.exportsIndex = true`），无 `.ae/src/tests/tsconfig` 等禁用顶层内容。

### 2.2 安装态基础闭环（win-unpacked）：**fail**（`packaged-flow-verify.json`）

| 检查 | 结果 |
| --- | --- |
| host_bridge_present | pass |
| real_session_opened | pass |
| sandbox_fails_closed_without_upgrade | **fail** |
| runtime_mode_upgrade_ok | pass |
| snapshot_returns_fixture_content | **fail** |
| session_owned_by_requested_key | pass |
| session_closed | pass |

### 2.3 原始 hostInvoke 响应（`packaged-raw-hostinvoke.json`）

| 动作 | 结果 |
| --- | --- |
| `setEnabled {enabled:true}` | ok |
| `open {mode:"headless", sessionKey:"agent:main:<run>"}` | ok，session `connection.mode=managed`、`mode=headless` |
| `takeSnapshot`（升级前） | **fail** `INTERNAL: Agent browser takeSnapshot requires the browser-window engine` |
| `requestModeUpgrade {full_access}` | ok |
| `takeSnapshot`（升级后） | **fail**（同一条 engine 错误，与权限无关） |
| `close` | ok |

`agentBrowser.status` 的能力快照同时把 `takeSnapshot`、`pressKey`、`verifyFlow` 标为 `available: true`。

### 2.4 干净消费 / 安装器载荷（`packaged-raw-hostinvoke-installed.json`）

用 `7za x 'release/Verse Claw-0.4.9-alpha.0-win-x64.exe' -oD:\tmp\n8-install-A -y`（exit 0）解开安装器载荷：11,271 目录 / 87,905 文件 / 3,177,659,596 B；从该布局以 `cwd=D:\tmp\n8-install-A` 启动 `Verse Claw.exe`：

- renderer page 出现（title `Verse Claw`），hostInvoke 可达，`open`/`close` 成功 → **不依赖原 checkout / node_modules / .local** 的干净消费成立。
- `takeSnapshot`（升级前/后）复现同一 `INTERNAL ... browser-window engine` 失败；能力快照同样广告 `takeSnapshot/pressKey/verifyFlow available:true`。
- 边界：NSIS 安装器与卸载器本身未执行（assisted installer 需交互提权）；PATH 增删与卸载回收仍未验证。

## 3. 发现（按严重度）

### F1（阻断 N8，且违反本规格既有条款）能力广告与实际执行矛盾

`packages/versebrowser/src/engine/service.ts:720`：`if (!requestGuard && this.cliRunner?.isAvailable())` → 只要捆绑 CLI 可用，normal `open` **一律**选择 `agent-browser-cli` 引擎；而 `takeSnapshot/clickByUid/fillByUid/pressKey` 在 `service.ts:1022/1037/1064/1086` 对 `engine !== 'browser-window'` 直接抛错。打包态 CLI 必然可用，因此安装态下这些动作必然失败（win-unpacked 与解包安装布局两处独立复现）。

- 违反规格 L130「tools/list 或模型 schema 不广告不可执行动作」、L131「错误必须区分，不能压成无上下文字符串」，以及 N3「不可用不广告」、N4「模型可达宿主不借可选 CLI 完成…观察…复观测」。
- 表达能力缺口用的是 `INTERNAL`，未走 `UNSUPPORTED/E_CAPABILITY_UNAVAILABLE`。
- 该缺口只在打包/干净消费态暴露：单元与开发态测试未覆盖"CLI 是否捆绑"改变引擎选择这一分支。

### F2（回收）driver 浏览器进程树残留

verifier 杀掉 Electron 进程树后，**driver 启动的 headless Chrome 进程树仍然存活**：本轮实测残留 10 个进程，全部来自 `C:\Users\27933\.agent-browser\browsers\chrome-149.0.7827.115\chrome.exe`（含 crashpad / gpu-process / utility / renderer 子进程），命令行带 `--user-data-dir=...\.tmp\m10-packaged-flow-sks61g\ud\agent-browser\profiles\m10-mvb4vhnq`。

- 因此 `fixture.close()` 没有可关的连接、`.tmp` 运行目录无法回收：对该目录递归删除时 `Cache_Data/sqldb0`、`lockfile`、`Web Data` 等文件被这些进程占用，逐个报 “being used by another process”。
- 这批进程在 verifier 进程与 Electron 进程都被杀之后依然存活，需按命令行匹配额外清理（本轮已逐个 kill，剩余 0）。
- 结论：安装态“仅关闭本次拥有资源”不成立——Electron 主进程退出不会连带回收 driver 启动的浏览器进程树。

### F3（工具）既有 verifier 的两个环境前提

- `scripts/versebrowser-m10-packaged-flow-verify.mjs:49` 把运行目录建在 `<repo>/.tmp/`，该目录在干净候选里不存在 → `mkdtemp` ENOENT（干净检出直接失败，非产品缺陷）。
- 该 verifier 的 `fetch` 无超时、`fixture.close()` 无超时：失败路径会挂住而不是产出失败报告。

## 4. 环境处置（如实记录，均为 agent 自动执行）

1. **Node 不读 `HTTPS_PROXY`**：本机必须走 `127.0.0.1:7897`；`scripts/lib/verified-download.mjs` 的系统代理回退用 `Invoke-WebRequest -OutFile` 却没加 `-PassThru`，Windows PowerShell 下拿不到最终 URL，触发 `ERR_RELEASE_TLS_REQUIRED`。以 `NODE_USE_ENV_PROXY=1` 走通（uv / agent-browser v0.29.0 / Node 24.16 二进制均按 manifest 校验下载）。
2. **pnpm 硬链接原生工具无法写盘**：`app-builder.exe`、`7za.exe` 等位于 `node_modules/.pnpm/**` 的硬链接副本在本机被拒写（`mkdir ... Access is denied`、`cannot open file ... 拒绝访问`）；同一字节的非硬链接副本正常。把 `node_modules` 下 40 个硬链接 `.exe`（465.5 MB）就地转普通文件后，原始发布链一次通过。该现象同样解释既有的 `esbuild ... Access is denied` 记录。
3. **MSVC 工具集缺失**：`verseshell:rebuild` 要求 rustc/cargo `1.94.0`（rustup 已有该工具链）**且** `x86_64-pc-windows-msvc` 链接器，本机无 VS/MSVC → 本会话**未重编译** VerseShell，改用既有 `ae.exe` 并以 `verseshell:manifest:validate:package` 做哈希/来源校验（exit 0，`sourceIdentity b3f8a52e9e8d758e0aa324e26ad50bf2db7662d5d69cd57bfc9fa8e877a3f0a0`）。
4. **安装态等价**：见 §2.4；安装器与卸载器未执行，未声称执行。

## 5. 边界

- 仅 Windows x64 实测；不外推其它平台。
- 未发布、未改变仓库公开性、未改动冻结默认值。
- 本文件与同目录 JSON 为 agent 驱动产物（`driven_by: agent`），不含真人证据。
- N8 关闭条件：F1（能力广告与执行一致 + 模型闭环不依赖可选 CLI）与 F2（driver 进程回收）需在**同一候选重新打包的产物**上让 §2.2 与 §2.3/§2.4 全部通过；F3 需补齐 verifier 的 `.tmp` 前提与超时。
