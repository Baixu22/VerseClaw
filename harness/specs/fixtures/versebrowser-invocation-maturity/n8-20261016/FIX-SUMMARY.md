# N8 修复记录（F1/F2/F3）——2026-10-17，candidate `d4c3f102`

本文件是对 `SUMMARY.md`（首次实跑的失败记录）的**追加**：原失败收据不改哈希，修复后的证据作为新文件放在同目录。

## 1. 修了什么

### F1（阻断项）桌面会话引擎被捆绑 CLI 抢走

- 根因：`electron/services/agent-browser-api.ts` 把 `createDefaultAgentBrowserCliRunner()` 注入了宿主默认 `AgentBrowserService`；而冻结包 `packages/versebrowser/src/engine/service.ts:720` 的规则是 `if (!requestGuard && this.cliRunner?.isAvailable())` → CLI 引擎优先。打包态 CLI 必然存在，于是每个 managed `open` 都落到 `agent-browser-cli` 引擎，而该引擎不支持 `takeSnapshot/clickByUid/fillByUid/pressKey`（`service.ts:1022/1037/1064/1086`）。
- 修复：**桌面宿主不再把 CLI runner 交给会话引擎**（`new HostAgentBrowserService()`），能力快照同步改为 `cliAvailable: false`，与已验证的 N3 桌面收据一致（`command` 明确不可用并带原因）。CLI 仍由独立/MCP 面提供——`packages/versebrowser/src/engine/api.ts:59` 保持注入。
- 为什么是这一层：spec L112-115 把"独立 MCP/CLI"划为单独面；L120 明确 CLI 只是兼容能力、不是基础观察链的实现。修复落在宿主接线，未改冻结包、未改产品默认值。

### F2（回收）driver 浏览器进程树残留

- 现象（修复前）：杀 Electron 后残留 10 个 `chrome.exe`（`~/.agent-browser/browsers/chrome-149.0.7827.115`），占住运行目录导致无法回收。
- 修复后：managed 会话走进程内 browser-window 引擎，不再启动外部 driver 浏览器。实跑后 `agent-browser = 0`、作用域内 `chrome.exe = 0`、`Verse Claw = 0`。

### F3（工具）packaged-flow verifier 的四个健壮性缺陷

1. 运行目录建在 `<repo>/.tmp/`，干净检出无该目录 → `mkdtemp` ENOENT（先 `mkdir -p`）。
2. `fetch` 无超时 → 端口被占用时会挂死（加 `AbortSignal.timeout(4000)`）。
3. `fixture.close()` 无超时（加 5s 上限）。
4. CDP 已起但 renderer 页面尚未注册即判失败（改为有界等待 30s）；`rm` 与进程退出竞态导致运行目录残留（等待子进程退出 + 重试 5 次）。

### 顺带修正的过期断言

- `scripts/versebrowser-host-integration-verify.mjs` 的 `bundled_cli_runner` 检查断言的是"宿主必须注入 CLI"（即缺陷本身）；改为校验正确语义：宿主服务 CLI-free、桌面能力 `cliAvailable:false`、独立面仍注入（12/12 检查通过）。
- `tests/e2e/versebrowser-host-invocation.spec.ts:48` 期望 `readForms` 由模块返回 `E_NOT_IMPLEMENTED`（ok:true）；落地设计是 Main 能力闸门在任何效果前拒绝。改为断言类型化拒绝（实测 `ok:false`、`error.code=UNSUPPORTED`、`details.backendCode=E_CAPABILITY_UNAVAILABLE`）。该 E2E 此前因环境（`vite build Access is denied`）从未真正执行，本会话首次实跑。

## 2. 修复后证据

### 2.1 门禁（全部 exit 0，明细见 `gates-after-fix.json`）

| 门禁 | 结果 |
| --- | --- |
| `node --test scripts/versebrowser-build-wiring.test.mjs` | exit 0 |
| vitest（spec requiredTests 五文件） | exit 0，37 passed |
| `pnpm contract:check` | exit 0 |
| `pnpm run typecheck` | exit 0（node/web/test 全 0 error） |
| `pnpm run build:vite` / `pnpm run package` / `electron-builder --win` | exit 0 |
| `pnpm run comms:replay` / `comms:compare` | exit 0 |
| `versebrowser-module-verify` / `api-coverage-verify` | exit 0（counts 67/13/81/81/13、issues[]） |
| `versebrowser-host-integration-verify` | exit 0（12/12，含修正后的 CLI 语义检查） |
| `pnpm harness validate --spec harness/specs/tasks/versebrowser-invocation-maturity.md` | exit 0（先给分支设 upstream，使 diff 基线=未推送部分，符合 harness 自身注释语义） |
| Playwright E2E（host-invocation / workbench / security-recovery） | exit 0，**3 passed**（25.0s） |
| `versebrowser-m10-package-verify --release` | exit 0，issues[] |
| `versebrowser-m10-packaged-flow-verify` | exit 0，**7/7**，连续 2 次通过，运行目录零残留、零泄漏进程 |

### 2.2 安装态原始 hostInvoke（`packaged-raw-hostinvoke-after-fix.json` / `…-installed-after-fix.json`）

win-unpacked 与解包安装布局（`D:\tmp\n8b-install-A`，cwd 在该目录）结论一致：

| 步骤 | 结果 |
| --- | --- |
| `status.capabilities.cliAvailable` | `false`；`driverKind=injected` |
| `status.capabilities.command` | `available:false`，reason `bundled agent-browser CLI is not available` |
| `status.capabilities.takeSnapshot` | `available:true` |
| `open`（managed/headless） | ok（约 5-6 秒，无 CLI 冷启动） |
| `takeSnapshot`（升级前） | **fail-closed**：`requires runtime mode upgrade (current: normal_restricted)` |
| `requestModeUpgrade` → `takeSnapshot` | ok，且含 fixture 内容（`M10 PACKAGED OK` / `body marker 42`） |
| `close` | ok |

### 2.3 修复后产物身份（`artifact-identities-after-fix.json`）

| 对象 | bytes | sha256 |
| --- | --- | --- |
| NSIS 安装器 | 678800538 | `a999e010464aaa717946338717d18393a3e47ad478cd8e90d6b489713f9cad68` |
| `win-unpacked/Verse Claw.exe` | 214315008 | `339ab98b1dc96e994a74f927ffbf73fdea3678d9b8862366f6f426e63172caa9` |
| `resources/app.asar` | 305714053 | `ae0bb8d038cc0070c90822b98e9c097474d5b2d0ef31524a6432b718ae34be3c` |
| `resources/main-runtime.asar` | 836527225 | `b5a22d6fc776af17a83ab6fa36cc8663013866f143b205ce8f48947b6b2ce81c`（与 `build/main-runtime-delivery/main-runtime.asar` 逐字节相同） |
| `resources/bin/ae.exe` | 15144448 | `3ed2174fee9b9d38ac34334211d9fd3187bc3b9a1e146a7db05eee64e9fd93f2` |

改动落在 Electron main bundle（`app.asar`），OpenClaw runtime（`main-runtime.asar`）不变——与"只改宿主接线"的范围一致。

## 3. 对照 N8 验收三条

1. **源/锁/依赖补丁/模块 dist/包内 runtime 身份绑定；无原 checkout、.local、临时凭据或开发 node_modules 路径依赖** → 满足：`package-verify --release` issues[]，两份 asar 0 条 dev_path_leak；包内 runtime 与构建产物逐字节相同；解包安装布局在 checkout 之外独立运行。
2. **干净消费验证与实际安装态执行基础闭环、安全拒绝和回收；pack dry-run 和旧 M10/M12 收据不替代** → 满足：安装器载荷解包后独立执行；基础闭环（open→observe→action→re-observe→close）通过；安全拒绝（升级前快照 fail-closed、`fullAccessRevoke` 后拒绝、未实现动作类型化拒绝）通过；回收零残留（进程/目录）。
3. **平台边界、升级状态守恒及成套回退证据明确；不发布、不改变公开性、不宣称其它平台通过** → 满足：仅 Windows x64 实测；`requestModeUpgrade`/`fullAccessRevoke` 状态转换已在 E2E 与打包态覆盖；未执行 NSIS 安装器/卸载器（assisted installer 需交互提权），未声称执行；未发布、未改公开性。

## 4. 仍未覆盖 / 明确边界

- NSIS 安装器与卸载器本体未执行（PATH 增删、卸载回收未验证），沿用 agent 驱动的解包等价路径。
- `command`（CLI 直通）与外部浏览器复用不在桌面面提供（与 N3 桌面收据一致）；它们在独立/MCP/CLI 面单独验收。
- 本文件只覆盖 N8；N9（10 次冷启动 / 30 次基础闭环 / 3 次受控中断恢复）仍为独立节点 TF-0354。
