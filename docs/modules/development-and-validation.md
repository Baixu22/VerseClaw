# 开发、验证与证据边界

> 面向问题：这个仓库包含哪些独立工作区？开发时应该跑哪些命令？怎样判断一个能力“完成了”？哪些本地状态和历史证据不应该进入 Git？

## 1. 仓库层次

| 层 | 目录 | 职责 |
|---|---|---|
| Renderer | `src/` | React 页面、组件、Zustand store、typed Host facade、i18n、样式、renderer extensions |
| Desktop Main | `electron/` | 窗口/托盘、IPC 授权与 dispatch、Host services、Gateway supervisor、preload |
| Shared contract | `shared/` | Host API 类型、事件、locale、domain contracts、authority/disposition manifests |
| Embedded runtime | `openclaw_runtime/` | OpenClaw source、runtime packages、extensions、Gateway internals |
| Product components | `packages/`、`resources/` | VerseBrowser、VToken、VerseShell、skills/plugins/binaries/icons |
| Harness | `harness/` | rules、scenarios、task specs、fixtures、validation |
| Tests | `tests/` | unit、integration、Electron E2E、fixtures |
| Automation | `scripts/`、`.github/` | build、sync、validation、maturity、evidence、release、CI |
| Docs/evidence | `docs/`、`reports/`、`artifacts/` | current docs、curated evidence、长报告 |

`openclaw_runtime/` 是 vendored Git tree 和独立 dependency workspace，不是 Git submodule，也不是发布时临时取用的 npm `openclaw` 包。

`packages/vtoken/` 是 Python/uv sidecar，故意不是 pnpm workspace member；当前生产路径已 retired。

## 2. 前置环境

当前根 README 要求：

- Node.js 24.16.0+ in 24.x；
- Git；
- pnpm 11.2.2；
- 网络访问以安装依赖、Electron、uv、agent-browser；
- 使用在线模型时配置 provider，或运行本地兼容模型。

Windows 默认 shell 是 PowerShell；复杂 POSIX 可显式使用 Git Bash。不要把 WSL bash 当作 Git Bash。

临时文件优先 `D:\tmp`，避免 C: 盘空间不足。这个约束适用于依赖安装、构建、测试、Playwright trace、screenshot、构建缓存。

## 3. 初始化和启动

```powershell
corepack enable
corepack prepare pnpm@11.2.2 --activate
pnpm run init
pnpm --dir openclaw_runtime install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm dev
```

`pnpm run init`：

- 安装 root workspace；
- 下载 uv；
- 下载 agent-browser。

`pnpm dev` 前会自动：

- build VerseBrowser；
- 生成 extension bridge；
- 同步 Lobe icons；
- build embedded runtime；
- 准备预装 skills。

Gateway 启动通常需要 10–30 秒。只启动 Vite 页面不具备完整 Host services。

## 4. 构建

| 命令 | 范围 |
|---|---|
| `pnpm run build:vite` | renderer + Electron bundles；不重建 OpenClaw |
| `pnpm run build:runtime` | embedded runtime build + Gateway startup smoke |
| `pnpm run build` | 完整 app/runtime/plugin/skill 资源准备与 electron-builder 打包入口；不是发布授权 |
| `pnpm run versebrowser:build` | 重建 VerseBrowser 和 public types/patch |
| `pnpm run build:startup-check` | startup 验证 |
| `pnpm run package:win` | Windows 包准备/打包 |
| `pnpm run package:mac` | macOS 包 |
| `pnpm run package:linux` | Linux 包 |

构建成功不等于安装/升级/回滚完成。Source build 也不会检查 packaged update feed。

## 5. 类型与 lint

| 命令 | 说明 |
|---|---|
| `pnpm run typecheck` | node + web + test types，三者必须通过 |
| `pnpm run typecheck:node` | 只跑 node project |
| `pnpm run typecheck:web` | 只跑 web project |
| `pnpm run typecheck:test` | test types |
| `pnpm run typecheck:cached` | daily-loop cache evidence；不能代替正式 full typecheck |
| `pnpm run typecheck:agent-dev` | Agent Dev 专项 |
| `pnpm run lint:check` | 只检查，不改文件 |
| `pnpm run lint` | 自动修复，使用前确认工作区 |
| `pnpm run i18n:lint` | 四语言 key coverage |

文档或 contract 改动也应跑相应 check，即使没有 TS 变化。

## 6. 测试

### Root tests

| 命令 | 范围 |
|---|---|
| `pnpm test` | root unit + selected runtime/maturity regressions |
| `pnpm exec vitest run tests/unit/<file>` | 单个 root unit |
| `pnpm run test:integration` | integration group |
| `pnpm run test:e2e` | build + Electron Playwright |
| `pnpm run test:e2e:run` | re-use existing build；runtime 仍需 fresh |
| `pnpm run test:e2e:headed` | headed Electron |
| `pnpm run test:e2e:agent-dev-quality` | full Agent Dev E2E |
| `pnpm run test:e2e:agent-dev-quality:smoke` | Workbench smoke only |

Windows Electron E2E 必须在 Windows Node 上执行。Linux headless 需要 display server，例如 `xvfb-run -a`。

Root `pnpm test` 不包含 OpenClaw 的全部测试。修改 runtime 时必须从 `openclaw_runtime/package.json`、task spec 与 harness context 选择更多门禁。

### Runtime tests

README 与 package scripts 中的 runtime 命令很多，包括：

- DCS/default matrix；
- runtime memory eval；
- LoCoMo；
- context compression；
- long-session evidence；
- VerseShell；
- AgentMap；
- effect/observability；
- channel conformance。

不要用“存在一个 eval script”证明该 eval 已执行或通过。需要实际输出、时间、退出码和 artifact 回读。

## 7. Communication checks

涉及以下路径时：

- renderer；
- Main；
- host-api/api-client；
- Gateway；
- runtime send/receive；
- provider fallback；
- delivery；

必须额外执行：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

`comms:baseline` 会更新基准，不应在未理解变更时自动运行。Replay 成功也不代表 live provider/渠道真实送达。

## 8. Harness

Harness 是仓库内的 executable policy/spec 层。

任务开始：

```bash
pnpm harness context --spec <task-spec>
```

结构校验：

```bash
pnpm harness validate --spec <task-spec>
```

查看所选验证流：

```bash
pnpm harness run --spec <task-spec> --dry-run
```

执行：

```bash
pnpm harness run --spec <task-spec>
```

全局基线：

```bash
pnpm run harness:ci
```

对真实 task spec 不应依赖 `--no-diff`；`--no-diff` 只适合结构检查的 checked-in examples。

## 9. Contract、i18n 与 catalog

| 命令 | 目的 |
|---|---|
| `pnpm contract:check` | renderer/Main/shared Host API 对齐 |
| `pnpm i18n:lint` | 四语言资源 |
| `pnpm catalogs:check` | capability/flags catalogs 一致性 |
| `pnpm run repo:artifacts:check` | source/evidence/local archive 边界 |
| `pnpm run repo:test-coverage:check` | test inventory/coverage claims |
| `pnpm run repo:evidence:check` | curated evidence 可读性 |
| `pnpm run repo:duplicates:check` | duplicate artifacts |
| `pnpm run docs:policy:validate` | durable policy docs 校验 |
| `pnpm run runtime:source:check` | vendored runtime source 检查 |

新增 Host route 必须同步：

- `shared/host-api/contract.ts`
- `electron/main/ipc/host-contract.ts`
- `electron/services/`
- `src/lib/host-api.ts`
- preload/security 边界；
- tests。

新增用户文本必须覆盖 en / zh / ja / ru。

## 10. Agent Dev

Agent Dev 是本地诊断/仿真控制面，不是产品运行时 authority。

| 命令 | 用途 |
|---|---|
| `pnpm agent-dev:make <page\|e2e\|host-route\|skill\|channel\|plugin\|scenario> <name>` | 生成约定骨架 |
| `pnpm agent-dev:fast` | contract/i18n/Workbench/目标单测 |
| `pnpm agent-dev:deep-test:reuse` | 复用 fresh build，cached typecheck，smoke E2E |
| `pnpm agent-dev:deep-test` | fresh build + full Agent Dev diagnosis |
| `pnpm agent-dev:audit` | strict maturity audit |
| `pnpm agent-dev:audit:report` | 生成报告但不以当前流程失败 |

报告：

- `artifacts/agent-dev-workbench/evidence.json`
- `artifacts/agent-dev-deep-test/report.json`
- `artifacts/agent-dev-deep-test/history.json`
- `artifacts/agent-dev-audit/report.json`

`decision.status`：

- `daily-loop-ok`
- `needs-full-gate`
- `blocked`

`needs-full-gate` 要按 `requiredFullGates` 继续执行，不能当 PR/release pass。

## 11. 按改动选验证

| 改动 | 最小合理验证 |
|---|---|
| 文档/README 链接 | docs policy、link check、`git diff --check` |
| pure shared helper | target unit + typecheck |
| Host API route | contract check + target unit + i18n |
| renderer UI | target unit + Electron E2E + i18n + visual check |
| Gateway communication | comms replay/compare + target runtime tests |
| provider/model | provider focused tests + usage/fallback checks |
| context/memory | DCS/memory focused tests + default matrix + kill switch |
| knowledge mutation | governance/lifecycle/search tests + E2E |
| session lifecycle | deletion/restore/handoff/delegation focused suites |
| coding write path | apply-patch/write journal/stale guard/auto verify suites |
| packaging | fresh build/runtime + package verify + install evidence |
| release | clean candidate + all required full gates + publication authority |

Focused green 不等于 full project green。

## 12. 数据与证据归属

应进入 Git：

- source code；
- current contracts/types；
- current docs；
- harness specs/rules/scenarios；
- cached tests/fixtures；
- 经过审查的 final evidence；
- SHA256SUMS/manifest；
- 许可/NOTICE/source obligations。

不应进入 Git：

- Task Forest local state；
- session handoffs；
- raw logs；
- temporary trace/screenshot；
- userData/workspace 私有数据；
- credential；
- 未审查的大体积 build output；
- agent worktree 私有历史。

Evidence roots：

- `artifacts/`：machine-readable curated evidence；
- `reports/`：long-form reports；
- `docs/`：current meaning/runbooks；
- `plans/`：maturity/approved lifecycle；
- `harness/specs/fixtures/`：reusable test fixtures/acceptance inputs。

不要新建没有登记的新 evidence root。

## 13. 证据真实性

必须区分：

- source-only；
- unit-test；
- E2E；
- real-runtime；
- negative-runtime；
- documented-boundary。

以及：

- implementation evidence；
- retirement evidence；
- benefit evidence；
- rollback evidence；
- default-effective state；
- product approval。

Agent 生成证据必须：

- `driven_by: agent`
- 明确的 `actor`
- 绑定 commit/tree/input/provider/model/scope
- 可回读 artifact/digest
- 不写 real-human

历史 evidence 只能证明它绑定的旧候选。当前源码变化后，要么重跑相关审计，要么明确标 stale/unverified。

## 14. 文档同步

当前策略：

- root `README.md` 是英文总入口；
- `README.zh-CN.md`、`README.ja-JP.md`、`README.ru-RU.md` 是本地化总入口；
- `docs/modules/` 是模块化深读文档；
- `docs/README.md` 是开发文档索引；
- 产品和默认状态以 `docs/clawx-product-semantics.md`、`docs/dev/default-config-matrix.md`、catalog 与代码为准。

行为、接口、默认值、用户入口或安全边界变化时，必须在同一变更集检查：

- root READMEs；
- 对应 module doc；
- product semantics；
- default matrix；
- harness specs；
- contracts/tests/evidence。

文档不得把“设计规划”写成“已实现”，也不得把“agent 驱动”写成“真人”。

## 15. 当前已知环境/验证风险

- C: 空间不足会触发 `ENOSPC`/磁盘不足；先切 `TEMP/TMP` 到 D: 再重跑。
- pnpm 安装后 lint 历史上有 `temp_uv_extract` race；等待下载结束后重跑。
- `pnpm install` 对可选 channel native packages 的 build-script warning 可以忽略，但不要在未验证时声称对应 channel 可用。
- Headless Linux 的 DBus 错误可能无害，但 Electron 仍需 display。
- 未安装 Electron binary、Gateway stale、provider 未配置、渠道未认证都可能表现为 UI 失败，不应轻率归因代码。
- 全量测试/安装器/非 Windows/真实 provider/远程 CI 的覆盖必须按实际执行记录。

## 16. 当前发布边界

- Windows x64 controlled preview 是主要本地验收目标。
- macOS/Linux 有构建目标，不自动拥有相同运行时验证。
- liveReady / productApproved / defaultOn 仍 false。
- Component graduation 与 agent-driven acceptance 不授权公开发布、GA、product lock 或默认值变更。
- 发布、公开仓库、公开 artifact、凭据首次暴露/轮换和不可逆操作必须走所有者决策；日常实现、证据生成、验证和文档收口是 agent 职责。

## 17. 推荐阅读

- `AGENTS.md`
- `docs/dev/Sustained-Development-Playbook.md`
- `docs/dev/repository-layout.md`
- `docs/dev/repository-artifact-retention.md`
- `docs/dev/default-config-matrix.md`
- `docs/clawx-product-semantics.md`
- `docs/architecture-overview.md`
- `docs/agent-dev-control-plane.md`
- `harness/specs/`

## 18. 常用最终检查

```bash
pnpm contract:check
pnpm i18n:lint
pnpm run typecheck
pnpm run harness:ci
pnpm run repo:artifacts:check
pnpm run repo:evidence:check
pnpm run docs:policy:validate
git diff --check
```

只跑与改动相关的最小集合时，必须明确说明哪些 full gate 仍未执行；不能把未执行写成 pass。

## 19. 源码索引

- `package.json`
- `pnpm-workspace.yaml`
- `openclaw_runtime/package.json`
- `vitest.config.ts`
- `playwright.config.ts`
- `harness/`
- `scripts/`
- `.github/workflows/`
- `docs/dev/repository-layout.md`
- `docs/dev/repository-artifact-retention.md`
- `docs/dev/Sustained-Development-Playbook.md`
- `docs/dev/default-config-matrix.md`
- `shared/capability-claims.ts`
- `shared/component-authority-manifest.ts`
- `shared/dcs/component-disposition-catalog.ts`