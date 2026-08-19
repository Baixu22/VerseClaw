# Stage 6 独立验收提示词

> 验收对象：Context Control Plane Stage 6（Context diff / why-included / policy simulation / replay debugger）。
> 本提示词供独立 verifier 在**新会话 / 新 actor** 中执行；执行 agent 与 Stage 6 开发 agent 不得为同一角色。
> 验收范围只读；发现缺陷时停止并记录，不自行修生产代码，除非 owner 另行授权修复切片。

## 0. 前置事实

- 分支：`codex/context-control-plane-stage0`
- 基线 HEAD：`f55201b22630d5c904f3105b2a9c8876ea5e889b`
- 工作树：`D:\verse_claw_worktree`
- Stage 0 / 1 / 2 / 3 / 4 均已 `accept`；Stage 5 开发端 L1–L8 已 PASS，L7 按 owner D6/D7 转为 agent-operated real-provider evidence + deferred soak。
- Stage 6 无待裁决 Q 项；`ownerDecisions` D1–D4 已固定于
  `harness/specs/tasks/context-control-plane-stage6.md` frontmatter。
- Stage 6 不重复真实 provider run；真实 provider 证据仍由 Stage 1–5 证据链持有。
- Stage 6 是只读投影与 opt-in Developer 面板；不得新增 context/权限/policy/receipt/effect 写路径。

## 1. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/STAGE6-DEV-PROMPT.zh-CN.md`
4. `docs/dev/context-control-plane/STAGE5-6-SERIAL-DEV-PROMPT.zh-CN.md`
5. `harness/specs/tasks/context-control-plane-stage6.md`
6. `harness/specs/tasks/context-control-plane-stage5.md`（D6/D7 回归）
7. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
   （重点：Stage 4 独立验收、Stage 5 L7 key 切片、Stage 5 owner 决策、Stage 6 开发切片）
8. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md`
9. Stage 0 `golden-path-contract.md` / `artifacts-schema.md` / `authority-adapters.md`
10. `shared/types/context-control-plane/artifacts.ts` 与
    `shared/types/context-control-plane/stage6-control-plane-explain.ts`
11. `src/components/settings/ContextControlPlanePanel.tsx`、
    `src/pages/Settings/index.tsx`、四语 `shared/i18n/locales/*/settings.json`
12. `tests/e2e/context-control-plane-stage6.spec.ts`

## 2. 只读代码核对

### 2.1 纯投影库 `stage6-control-plane-explain.ts`

- `projectStage6DiffFromPromptPlan`：
  - 只消费 PromptPlan 的 selected/omitted/order/why；不读原文、不写任何状态。
  - selected 为空、selected/omitted 重叠、order 长度不匹配或 order 未覆盖每个 selected ref 时 fail-closed。
  - 输出 selected/omitted 条目含 source/status/reason/order/basis/policy digest/epoch/ruleId。
- `explainStage6WhyIncluded`：缺失 refId 返回 `not-found`，不猜测。
- `simulateStage6Policy`：
  - 纯 dry-run：结果含 `dryRun=true`、`sideEffects=0`。
  - 非法 policy、非法 priority、负数/分数 units、重复 candidate 必须 fail-closed。
  - protected/critical 超预算必须返回 `protected-over-budget`，普通超预算返回 `budget-drop`。
  - 同输入重复调用 deep-equal。
- `projectStage6DiffFromReports`：
  - 只消费脱敏 LCP 报告的 section 计数，不渲染 payload/原文。
- `projectStage6ReplayInputFromReports`：
  - 只输出 reportIds/timestamps/evidenceRefs/planId/snapshotId/planDigest/envelopeDigest/ref；
  - 恒定 `effectsReplayed=false`、`rawPayloadIncluded=false`；
  - 不存在调用 executor、工具、provider 或文件写入的代码路径。
- 全文件不得出现 `Date.now` / `new Date` / `Math.random` / 随机 id 生成。

### 2.2 UI 接线 `ContextControlPlanePanel.tsx` + `Settings/index.tsx`

- 面板只调用 `hostApi.localControlPlane.status/reports/correlations` 三个只读方法。
- 不得出现 `window.electron.ipcRenderer.invoke`、`fetch("http://127.0.0.1:18789`、
  `localhost:18789`、`ws://` 或任何 direct Gateway HTTP/WebSocket 路径。
- 不得调用任何写 action（无 save/update/write/replay execution）。
- 面板挂在 Settings > Developer opt-in 区域，lazy + preload；不改变 developer 开关逻辑。
- simulation 与 replay 按钮只更新本地 React state；E2E 必须证明点击 simulation 前后 hostApi call count 不变。
- 所有用户可见文案来自 `t("developer.contextControlPlane.*")`；reason/decision 枚举码也经 `reasons.*` / `decisions.*` 四语映射，无硬编码显示字符串。

### 2.3 i18n

- `en/zh/ja/ru` 四语 `settings.json` 必须同时包含 `developer.contextControlPlane`，键集合完全一致。
- `pnpm i18n:lint` 必须 PASS。

### 2.4 边界与禁止

- 未新增 store、数据库、receipt store、权限表、provider、durable memory writer。
- 未改产品锁：`defaultOn=false`、`liveReady=false`、`productApproved=false`。
- 未触碰 Stage 1–5 生产路径（除本 spec 明确列出的 Settings 挂载点）。
- 不 commit、不 push、不建 PR。

## 3. 复跑命令（全部原样执行）

```bash
git branch --show-current
git rev-parse HEAD
git status --short

pnpm harness context --spec harness/specs/tasks/context-control-plane-stage6.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage6.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5.md

pnpm exec vitest run tests/unit/context-control-plane-stage6-contracts.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/context-control-plane-stage5-contracts.test.ts --reporter=verbose

pnpm contract:check
pnpm run typecheck
pnpm run lint:check
pnpm i18n:lint
pnpm run test:e2e tests/e2e/context-control-plane-stage6.spec.ts
git diff --check
```

Stage 6 不要求真实 provider run。若 verifier 自行运行任何真实 provider 命令，必须遵守 owner 一次性临时 key 规则，且不得把 key 写入任何文件、DEVLOG 或持久化环境。

环境前置：`pnpm run test:e2e` 依赖 Electron 二进制；若 `node_modules/electron` 缺少 `dist/`（启动时报 “Electron failed to install correctly”），先执行一次
`node node_modules/electron/install.js`，然后重跑同一验收命令。该步骤不修改源码。

## 4. L1–L8 判定表

| 编号 | 判定标准 | 通过证据 |
|---|---|---|
| L1 | Stage 6 只读投影：面板无写路径；生产/共享源码无 ipcRenderer、无 direct Gateway HTTP/WebSocket；UI 只读 `hostApi.localControlPlane` | 源码扫描 + `stage6-contracts` 测试 + E2E |
| L2 | Context diff 与 why-included 可解释：selected/omitted 条目含 source/status/reason/order/basis/policy digest/epoch/ruleId；重叠/order 错配 fail-closed；缺失 refId 返回 not-found | root stage6 contracts |
| L3 | policy simulation 为纯 dry-run：`dryRun=true`、`sideEffects=0`；非法 policy/candidate fail-closed；E2E 点击 simulation 前后 hostApi call count 不变 | root stage6 contracts + E2E |
| L4 | replay debugger 只重放可恢复输入：`effectsReplayed=false`、`rawPayloadIncluded=false`；不存在 executor/effect/provider 重放路径 | root stage6 contracts + 源码扫描 |
| L5 | 脱敏：不显示/落盘 raw payload、prompt、工具输出、凭据；投影只含 ref/digest/summary/status | 源码核对 + 测试 fixture 检查 |
| L6 | UI 接线 + 四语 + E2E：入口在 Settings > Developer；全部走 typed host-api；en/zh/ja/ru 键一致；Electron E2E 覆盖可见交互 | `i18n:lint` + E2E |
| L7 | 确定性与默认：同输入 deep-equal；纯函数无 wall-clock/random；默认 off，不改变既有默认值/工具集/字节 | root stage6 contracts + 源码扫描 |
| L8 | 卫生：全门禁 exit 0；产品锁 false；`DEEPSEEK_API_KEY` 三作用域 absent；`sk-[a-f0-9]{32}` 扫描 0 命中；无探针残留；无 commit/push/PR；HEAD 不变 | 命令输出 + git 状态 + 环境扫描 |

## 5. 额外只读探针（运行后立即删除）

建议 verifier 至少创建并运行以下临时 Vitest 探针，确认不是只依赖开发测试：

- **探针 A（diff fail-closed）**：构造 selected/omitted 重叠、order 缺项/多出的 PromptPlan 输入，断言 `selected-omitted-overlap` / `order-mismatch`；构造空 selected，断言 `invalid-plan`。
- **探针 B（simulation 纯函数）**：同一 policy/candidates 调用两次 deep-equal；重复 candidate、非法 priority、负数/分数 units 返回 `invalid-candidate`；critical 超预算返回 `protected-over-budget`；结果 `sideEffects=0`。
- **探针 C（replay 无副作用）**：从报告构造 replay 投影，断言 `effectsReplayed=false`、`rawPayloadIncluded=false`；JSON 序列化结果不得含 payload/prompt/credential 字段。
- **探针 D（渲染器边界）**：对 Stage 6 新增/修改的 renderer 文件 grep `ipcRenderer|18789|WebSocket|fetch(`，应为 0 命中。
- **探针 E（E2E 已含）**：面板可见后记录 hostApi call count，点击 simulation/replay 后 count 不变。

全部探针跑完必须删除，最终 `git status --short` 与验收开始时一致（无探针残留）。

## 6. 产品锁与卫生

- `defaultOn=false`、`liveReady=false`、`productApproved=false` 全程不变。
- 对 Stage 6 新增/修改生产文件 grep `defaultOn|liveReady|productApproved`：应无命中（测试/spec 负向断言文本除外）。
- 工作树精确扫描 `sk-[a-f0-9]{32}`：0 命中。
- `DEEPSEEK_API_KEY` 在 Process / User / Machine 均应为 absent。
- 不 commit、不 push、不建 PR；`git log` 不得出现新提交；HEAD 仍为基线 SHA。

## 7. 判定与输出

判定词只允许：

```text
accept / accept-with-findings / blocked
```

- `accept`：L1–L8 全部 PASS，探针反例全部通过，剩余问题为空。
- `accept-with-findings`：全部硬门禁通过，仅存在不改变 Stage 6 语义的既有观察项。
- `blocked`：任一 L1–L8 硬门禁失败；simulation 产生副作用或 host call；replay 出现 effect 重放；投影暴露 raw payload/凭据；renderer 绕过 host-api；四语缺语；E2E 失败；产品锁/默认值被翻；或发现范围外生产改动。

输出必须追加到 `docs/dev/context-control-plane/DEVLOG.zh-CN.md`，包含：
HEAD SHA、dirty patch 摘要、每类命令 exit code 与关键输出、L1–L8 逐项判定、
临时探针记录（含删除确认）、产品锁复核、密钥/卫生复核、最终 verdict。
