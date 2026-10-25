# N8（TF-0353）干净消费与实际安装包 — 最终状态

状态：**通过**（历史失败阶段保留在 `HISTORICAL-FAILURE-20261016.md`）。

- driven_by: `agent`
- actor: `codex`
- acceptance candidate: `d4c3f1021a0faf928a36a3299f54eea6bfd29fae`
- 本文件描述 2026-10-16 N8 候选的最终修复态，不代表后续 HEAD 的永久证明；当前候选证据见 `../current-20261022/`。

## 最终结论

原始 N8 证据先暴露了三个缺陷：

1. F1：桌面服务注入捆绑 CLI 后，所有 managed `open()` 被切到 `agent-browser-cli` 引擎；该引擎不能执行 `takeSnapshot`、`clickByUid`、`fillByUid`、`pressKey`，而能力快照仍广告这些动作。
2. F2：driver 浏览器进程树在 Electron 主进程退出后残留，导致运行目录无法回收。
3. F3：打包态 verifier 依赖不存在的 `.tmp` 前提，且失败路径缺少超时。

修复后，同一候选依据 `gates-after-fix.json` 通过：

- `versebrowser-build-wiring`: exit 0
- 定向 Vitest: `37 passed`
- `contract:check`, `typecheck`, `build:vite`, `comms:replay`, `comms:compare`: exit 0
- module / API coverage / host integration verifier: exit 0
- Harness validate: exit 0
- Electron E2E: `3 passed`
- packaged-flow: `2/2 consecutive runs pass`

`packaged-flow-verify-after-fix.json` 证明真实打包产物中：

- host bridge 存在；
- session 可以 open；
- 未升级时动作 fail-closed；
- 升级后可 take snapshot；
- snapshot 含 fixture 业务文本；
- owner/session 数量守恒；
- close 后无残留 session。

## 产物身份

以同目录 `artifact-identities-after-fix.json` 为准。关键绑定：

- packaged exe: 214315008 B，`339ab98b…172caa9`
- app.asar: 305714053 B，`ae0bb8d0…34be3c`
- main-runtime.asar 与 build 交付物逐字节相同。

## 限制

- 仅 Windows x64。
- NSIS 安装器/卸载器本体未执行；使用解包后的安装布局作为 agent-driven 等价验收。
- 不改变产品默认值，不发布，不声称 real-human evidence。
- 后续源码变化会使本候选证据过期；不得用本文件替代 `current-20261022` 的重新绑定结果。