# Agent-driven VerseConf × ClawX implementation

日期：2026-10-01

`driven_by: agent` · `actor: codex/verseconf-clawx-integrator`

## 范围

本轮把 TF-0246 至 TF-0252 从“规划/未执行”推进到一个受限、可回归、可停用的 ClawX 消费闭环：

- `openclaw_runtime/extensions/verseconf-artifacts/` 是默认关闭的 OpenClaw 插件；
- VerseConf Node/WASM 交付包固定放在插件内，带 `build-manifest.json`、WASM/glue/types、MIT/Apache 许可证和 SHA-256 指纹；
- worker 只负责纯内存严格 JSON 计算，不能写盘、不能提供任意路径或任意工具执行；
- ClawX/OpenClaw 运行时负责上下文、workspace 边界、取消、路径检查、journal、效果收据、SQLite 版本/历史和导出落盘。

没有修改 `liveReady`、`productApproved`、`defaultOn`、默认策略或发布/公开边界；没有付费模型调用，也没有声称真人证据。

## 节点对应

| 节点 | 本轮交付/证据 |
|---|---|
| TF-0246 | `structured_artifact_create` / `structured_artifact_revise` 真实插件工具路径；共享 runtime batch lease + write journal + EffectReceipt；路径逃逸、取消、漂移、幂等回放拒绝回归。 |
| TF-0247 | `VerseConfArtifactStore` 使用既有 OpenClaw SQLite 状态目录，持久化 artifact/revision/operation/output/event；prepared 重启对账为 `recovery_required`，不自动重放；历史恢复生成新 revision。 |
| TF-0248 | 受限 JSON worker、可信 schema profile、UTF-8/Unicode/CRLF/BOM/批次回归、Node/WASM fingerprint manifest。默认计算 profile 保持 20 MiB；可信 schema 编译使用独立 96 MiB 有界 worker profile，原因记录在验证报告。 |
| TF-0249 | `structured_artifact_export` 支持 Markdown/CSV/XLSX/PPTX；导出由同一 runtime write owner 落盘并关联 revision/journal；Artifact Panel 通过 `hostApi.gateway.rpc` 展示 managed artifact/history/output。 |
| TF-0250 | `structured_artifact_record_ops` 支持稳定 ID 的插入/删除/移动；beforeId/afterId、重复 ID、无效邻接和外部源漂移拒绝；restore 只生成新 revision。 |
| TF-0251 | slide-outline 消费面复用同一宿主契约；PPTX 为固定源快照、版本化 deterministic projection。固定模板经 LibreOffice headless 转 PDF、PyMuPDF 文本提取和 PNG 渲染检查；3 页均有文本和 PNG 产物，报告标为 `agent-driven passed`。 |
| TF-0252 | 插件默认关闭、单一 Node/WASM 交付路径、源码/依赖/构建指纹、schema/store 版本检查、容量上限、禁用保留历史；没有发布或 GA 裁决。 |

## 运行入口

```text
pnpm --dir openclaw_runtime exec tsc -p tsconfig.extensions.json --noEmit
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extensions.config.ts extensions/verseconf-artifacts/src/structured-artifacts.seam.test.ts extensions/verseconf-artifacts/src/domain.test.ts extensions/verseconf-artifacts/src/render.test.ts extensions/verseconf-artifacts/src/consumer.test.ts
pnpm run typecheck
pnpm run contract:check
pnpm run build:vite
pnpm run build:runtime
pnpm exec playwright test tests/e2e/chat-artifact-panel.spec.ts --workers=1
pnpm --dir openclaw_runtime exec node --import tsx ../scripts/verify-verseconf-clawx-integration.mjs
```

## 当前验证结果（2026-10-01）

- runtime 扩展 typecheck：exit 0。
- 插件专项回归：5 test files / 10 tests passed。
- 主仓库 typecheck：node/web/test observation exit 0。
- `contract:check`：exit 0。
- Vite build exit 0；runtime build exit 0，gateway smoke ready；Electron `--dir` unpacked package exit 0，且 release/win-unpacked 内插件资源、schema、WASM、worker、模板均存在。完整 NSIS installer 也已通过：修复了 after-pack junction 清理和 installer.nsh 的 NSIS 变量/函数名，最终生成 `release/Verse Claw-0.4.9-alpha.0-win-x64.exe`。
- Artifact Panel Electron E2E：5 passed / 0 failed。
- 独立 agent verification：33/33 passed，报告 `artifacts/verseconf-clawx-integration/verification-20261001.json`。
- 视觉 PPTX 渲染：agent-driven passed；LibreOffice 生成 3 页 PDF，PyMuPDF 提取 3 页文本并写出 3 张 PNG。未声称真人视觉验收。

## 不宣称

这不是完整 Office 往返编辑器，不是跨平台发布验收，不是 npm/public release，不是付费模型质量评测，不是 default-on/GA。若 schema/compiler 或目标平台要求超出当前 profile，返回 unavailable/recovery-required 并保留 source/output/history，不自动切 native/MCP/shell。

README.md、README.zh-CN.md、README.ja-JP.md 已审阅；本轮没有新增安装/公开配置契约，因此没有添加用户安装文档或版本发布说明。

## 2026-10-02 复核与刷新

- `pnpm --dir openclaw_runtime exec tsgo --noEmit -p tsconfig.extensions.json --composite false`：exit 0。
- 专项扩展回归：5 test files / 10 tests passed；主仓库 node/web typecheck 分项 exit 0；并行综合 typecheck 曾因 Windows 主机内存不足退出，未见源代码诊断；`pnpm run contract:check` passed。
- `pnpm run build:vite`、`pnpm run build:runtime`、`pnpm exec playwright test tests/e2e/chat-artifact-panel.spec.ts --workers=1` 均完成，Playwright 为 5 passed。
- `pnpm run comms:replay` 与 `pnpm run comms:compare` 均通过；比较报告保持 PASS。
- Windows x64 Electron/NSIS 产物重新生成后，独立 verifier 再次输出 33/33 passed；报告仍明确 `driven_by: agent`，不含真人或付费模型证据。
- Harness 的全工作区 diff 校验仍受历史 dirty 范围和 `%SystemDrive%/` 缓存文件影响，未把失败升级为产品代码失败，也未清理这些用户工作区文件。

## 2026-10-02 真实 Gateway 路径与补充验收

- 独立 verifier 已扩展到 **33/33 passed**，其中新增真实 Gateway 进程的 `/tools/invoke` 闭环：研究表创建、受管修订、幂等重放、XLSX 导出、历史查询、slide-outline 创建/修订/PPTX 导出和外部漂移拒绝。
- 修复两个真实运行缺口：Gateway tool resolution 传递持久 `sessionId`；构建后 VerseConf worker 显式解析实际 `compute-worker.mjs`，避免把源码相对路径带入 bundle。
- 包内真实 Gateway 复核又发现并修复 runtime bundle 缺失的 bare dependencies：`picomatch` 与 Tree-sitter grammar 包；重新打包后 `release/win-unpacked` 的真实 Gateway 创建/修订/历史路径通过。
- 新增并通过持久层证据：prepared operation 启动对账为 `recovery_required`、未知 schema version 拒绝、禁用保留历史、备份数据库恢复、256 artifact 容量边界。专项回归更新为 **5 files / 10 tests passed**。
- 最新报告还包含 agent-driven cold/hot worker timing、RSS/wasm memory 指标、WASM/installer 包体和 26 文件/129275 bytes/2926 lines 的维护成本代理指标；失败分母为 33，总失败 0。
- 当前仍不宣称真人、付费模型质量、跨平台发布、GA/default-on 或 public release；产品边界保持 `defaultOn=false`、`productApproved=false`、`liveReady=false`、`publicPublish=false`。

## 2026-10-02 范围对账与父节点收口

`TF-0245` 的“收缩当前周期并保持冻结”是实施前的历史采用建议；随后用户明确要求继续完成 `TF-0246` 至 `TF-0252`，该范围授权已记录在已应用提案 `TFP-verseconf-clawx-implementation-closeout-20261001` 的 rationale 中。本轮只完成消费者专用、默认关闭、可回归的受限闭环，没有解除产品锁、默认值、GA 或公开发布边界。

因此，当前父节点 `TF-0243` 按“当前有界范围已完成、后续扩展继续保持未授权”收口；不把未执行工作标为完成，也不把本轮局部证据外推为产品采用或 GA。
