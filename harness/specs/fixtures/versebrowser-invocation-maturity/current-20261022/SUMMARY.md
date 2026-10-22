# VerseBrowser 当前候选证据（2026-10-22）

状态：**通过**，范围是 Windows x64 的受控基础可用，不是 GA、发布或全平台声明。

- driven_by: `agent`
- actor: `codex-verse-browser-absorption-20261022`
- source commit: `39ce33a79e00d05d61bab693c32ed161bf27c5ec`
- source tree: `6a0b51833e8cdb8790c06c70b3bf422f92af27ec`
- candidate worktree at build/run: clean

## 本次修复

1. managed-session engine 改为构造时显式锁定 `browser-window` 或 `agent-browser-cli`；不再在 `open()` 时依据 CLI 是否存在重新选择，选中 CLI 不可用时返回 `E_CLI_UNAVAILABLE`。
2. Browser 资源账本在打开 session 前解析 active workspace；无 active workspace 时使用显式 `global` 宿主作用域，不再把 sessionKey 当作 workspace 身份。caller 提供的 workspace 与 active workspace 不一致时返回 `E_WORKSPACE_MISMATCH`。
3. `undici` 从 devDependency 移入生产依赖，使 main runtime 的 `require("undici")` 可被打包并有依赖清单证明。

## 静态与 E2E 门禁

- full typecheck: node/web/test 三路 exit 0。
- package + root 定向 Vitest: 15/15 与 50/50；host adapter 复验 9/9。
- contract check: pass。
- comms replay/compare: PASS，全部阈值内。
- Three Electron E2E specs: 3/3 passed（20.5s）。仓库内 Electron dist 二进制在本机以 `0x80000003` 崩溃，E2E 使用已验证的 Electron 40.8.4 cache 解包路径并通过 `ELECTRON_OVERRIDE_DIST_PATH` 启动；详见 `ENVIRONMENT-NOTE.md`。这不是产品源码修复，也不替代 packaged-flow/N9。
## N8 打包态结果

- `n8-package-verify.json`: pass；`main-runtime.asar` 与 `app.asar` 均可加载，`devPathHits=0`。
- `n8-packaged-flow.json`: pass；真实 `release/win-unpacked/Verse Claw.exe` 完成 open、未授权 fail-closed、mode upgrade、takeSnapshot、fixture 业务文本、owner 数量守恒和 close。
- 产物绑定：
  - packaged exe: 214315008 B，`f38c07c2109aecaba33516c1066b033c202c271a9ba52a5def6a312c0ea4ee4e`
  - app.asar: 307457342 B，`b6e8b465d5afe7032848aee9000f909b05cba97ac6d7f1a3e45bd028f4e3270f`
  - main-runtime.asar 与 build/main-runtime-delivery/main-runtime.asar 均为 838220759 B，`b711d9221894dfe0bfd7dc7d3451b9267c125cdc5585aa232a1f3638d7a93394`

## N9 重复运行结果

- 冷启动：10/10 passed；p50 6628 ms，max 7762 ms，最大残留进程 0。
- 完整闭环：30/30 passed；p50 6919 ms，p95 7184 ms，max 7189 ms，最大残留进程 0，RSS 峰值 1375.1 MB。
- 强杀中断：3/3 带活动 session 被杀；恢复 3/3 passed。
- 资源回收：46/46 运行目录回收，总轮数 46。
- 时间与内存仅记录观测值：仓库仍无既有 VerseBrowser 性能预算，因此不声明性能提升或达标。

## 边界

- 仅 Windows x64；不外推 macOS/Linux。
- 使用 `win-unpacked` 实际打包产物；NSIS 安装器/卸载器本体未执行。
- 不发布、不改变仓库公开性、不改变产品默认值或产品锁。
- 不声称 real-human evidence。
- 仍是 14/28 桌面模型动作的受控基础能力，不包含 ego-lite 式完整 TaskSpace、handoff、文件与视觉交互面。

## 复核

```powershell
node scripts/versebrowser-evidence-verify.mjs
```

该命令校验 N8 历史失败与最终通过分离、N8/N9/current manifests、当前源码未漂移、attribution 和凭据模式。
