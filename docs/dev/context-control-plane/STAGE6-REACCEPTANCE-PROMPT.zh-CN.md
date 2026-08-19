# Stage 6 修复后复验提示词（新会话 / 新 actor）

> 触发：Stage 6 首次独立验收 verdict=`accept`，同时记录 2 项非阻断备注。owner 已将 2 项备注升格为必须处理项；修复切片已完成，本提示词用于新会话独立 verifier 复验。
> 验收范围只读；发现缺陷只记录并停止，不自行修生产代码，除非 owner 另行授权修复切片。

## 0. 前置事实

- 分支：`codex/context-control-plane-stage0`
- 基线 HEAD：`f55201b22630d5c904f3105b2a9c8876ea5e889b`
- 工作树：`D:\verse_claw_worktree`
- Stage 0–4 已 `accept`；Stage 5 开发端 L1–L8 PASS（L7 按 owner D6/D7 转为 agent-operated evidence + deferred soak）。
- Stage 6 首次独立验收 `accept`，2 项备注已被 owner 升格为阻断；修复切片完成，未 commit / push / PR。
- 修复切片必须严格验证以下两点，同时确认没有破坏 Stage 6 原有 L1–L8 门禁。

## 1. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/STAGE6-DEV-PROMPT.zh-CN.md`
4. `docs/dev/context-control-plane/STAGE5-6-SERIAL-DEV-PROMPT.zh-CN.md`
5. `harness/specs/tasks/context-control-plane-stage6.md`
6. `harness/specs/tasks/context-control-plane-stage5.md`（D6/D7 回归）
7. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
   （重点：Stage 6 首次独立验收、Stage 6 2 项备注修复切片）
8. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md`
9. Stage 0 `golden-path-contract.md` / `artifacts-schema.md` / `authority-adapters.md`
10. `shared/types/context-control-plane/artifacts.ts`
11. `shared/types/context-control-plane/stage6-control-plane-explain.ts`
12. `src/components/settings/ContextControlPlanePanel.tsx`
13. `src/pages/Settings/index.tsx`
14. 四语 `shared/i18n/locales/*/settings.json`
15. `tests/e2e/context-control-plane-stage6.spec.ts`

## 2. 修复项核对（本次复验核心）

### 2.1 修复 1：replay 投影字段语义

- `Stage6ReplayInputProjection` 字段应为：
  `schema` / `planId` / `snapshotId` / `planDigest` / `envelopeDigest` /
  `receiptIds` / `reportIds` / `evidenceRefs` / `timestamps` /
  `effectsReplayed` / `rawPayloadIncluded`。
- **不得存在** `snapshotDigest` 字段。
- `snapshotId` 必须来自 `plan.snapshotId`（可恢复快照引用）；`planDigest` 必须来自 `plan.planDigest`；`envelopeDigest` 必须来自函数输入。
- 恒定 `effectsReplayed=false`、`rawPayloadIncluded=false`；不存在调用 executor、工具、provider 或文件写入的代码路径。
- `tests/unit/context-control-plane-stage6-contracts.test.ts` 应显式断言 `snapshotId`、`planDigest` 和 `not.toHaveProperty("snapshotDigest")`。

### 2.2 修复 2：reason / decision 四语本地化

- `ContextControlPlanePanel.tsx` 不得再出现 `{decision.decision} · {decision.reason}` 或把 `entry.reason` 原样作为 `{{reason}}` 插值。
- 面板必须经 `STAGE6_REASON_I18N_KEYS` / `STAGE6_DECISION_I18N_KEYS` 映射到
  `developer.contextControlPlane.reasons.*` 与 `developer.contextControlPlane.decisions.*`。
- 未知 reason/decision 必须 fallback 到四语 `unknown`，不得回退为裸枚举码。
- 四语 `settings.json` 必须同时包含 `developer.contextControlPlane.reasons`（17 键）与
  `developer.contextControlPlane.decisions`（3 键），键集合完全一致。
- E2E 必须能看到本地化后的可见文案（当前 fixture 下至少含 `Protected section`、`Allow`、`Protected rule`）。

### 2.3 原有 Stage 6 不变量不得回退

- `projectStage6DiffFromPromptPlan` fail-closed：空 selected -> `invalid-plan`；selected/omitted 重叠 -> `selected-omitted-overlap`；order 缺项/重复/错配 -> `order-mismatch`。
- `explainStage6WhyIncluded`：缺失 refId -> `not-found`，不猜测。
- `simulateStage6Policy`：`dryRun=true`、`sideEffects=0`；非法 policy、非法 priority、负数/分数 units、重复 candidate fail-closed；protected/critical 超预算 -> `protected-over-budget`，普通超预算 -> `budget-drop`；同输入 deep-equal。
- UI 只走 typed `hostApi.localControlPlane.status/reports/correlations`；禁止 `ipcRenderer`、direct Gateway HTTP/WebSocket。
- 产品锁 `defaultOn=false`、`liveReady=false`、`productApproved=false` 未变。

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

预期关键输出：

- stage6 contracts：1 file / **6** tests passed。
- stage5 contracts：1 file / 4 tests passed。
- E2E：1 passed。
- lint：0 errors（既有 126 warnings 可接受）；oxlint 0/0。
- typecheck：node/web exit 0；testTypes 既有 observation-only 不 gate。

环境前置同 Stage 6 验收提示词：若 Electron 报未正确安装，先执行
`node node_modules/electron/install.js`，再重跑同一命令；该步骤不修改源码。

## 4. L1–L8 复验判定表

| L | 判定标准 | 通过证据 |
|---|---|---|
| L1 | 只读投影；面板无写路径；生产/共享源码无 ipcRenderer、无 direct Gateway HTTP/WebSocket | 源码扫描 + stage6 contracts + E2E |
| L2 | diff + why 可解释且 reason 四语；overlap/order 错配 fail-closed；缺失 refId -> not-found | stage6 contracts + i18n lint |
| L3 | simulation 纯 dry-run；E2E 点击 simulation 前后 hostApi call count 不变 | stage6 contracts + E2E |
| L4 | replay 输出 `planId/snapshotId/planDigest/envelopeDigest/reportIds/timestamps/evidenceRefs`，`effectsReplayed=false`；无 `snapshotDigest` 误名；无 effect 重放 | stage6 contracts + 源码核对 |
| L5 | 不显示/落盘 raw payload / prompt / 凭据 | 源码核对 + fixture 检查 |
| L6 | Settings > Developer + typed host-api + reason/decision 四语 + E2E | `i18n:lint` + E2E |
| L7 | 确定性；无 wall-clock/random；默认 off | stage6 contracts + 源码扫描 |
| L8 | 门禁全绿；产品锁 false；key 卫生；无 commit/push/PR | 命令输出 + git 状态 |

## 5. 临时探针（跑完即删）

- **A（diff fail-closed）**：selected/omitted 重叠、order 缺项/多出、空 selected，断言对应失败码。
- **B（simulation 纯函数）**：同输入两次 deep-equal；重复 candidate、非法 priority、负数/分数 units -> `invalid-candidate`；非法 policy -> `invalid-policy`；critical 超预算 -> `protected-over-budget`；`sideEffects=0`。
- **C（replay 字段语义）**：构造含 `payload.prompt=SECRET_PROMPT` 的报告，断言 replay 输出无 `snapshotDigest` 属性、`snapshotId=plan.snapshotId`、`planDigest=plan.planDigest`、序列化不含 SECRET_PROMPT、`effectsReplayed=false`、`rawPayloadIncluded=false`。
- **D（renderer 边界）**：Stage 6 新增/修改 renderer 文件及 `Settings/index.tsx` 的新增 diff 行 grep `ipcRenderer|18789|WebSocket|ws://|fetch(http` 应为 0 命中。
- **E（E2E 已含）**：面板可见后记录 hostApi call count；点击 simulation/replay 后 count 不变；并确认本地化文案可见。
- **F（i18n 键集合）**：en/zh/ja/ru 的 `reasons` / `decisions` 键集合分别完全一致，且每键值非空。

全部探针跑完必须删除，最终 `git status --short` 与验收开始时一致。

## 6. 产品锁与卫生

- `defaultOn=false`、`liveReady=false`、`productApproved=false` 全程不变。
- Stage 6 新增/修改生产文件 grep `defaultOn|liveReady|productApproved`：0 命中（测试/spec 负向断言除外）。
- 工作树精确扫描 `sk-[a-f0-9]{32}`：0 命中。
- `DEEPSEEK_API_KEY` Process / User / Machine 均 absent。
- 不 commit、不 push、不建 PR；HEAD 仍为基线 SHA。

## 7. 判定与输出

判定词只允许：

```text
accept / accept-with-findings / blocked
```

- `accept`：修复 1、修复 2 全部达成，L1–L8 全 PASS，探针反例全通过，剩余问题为空。
- `accept-with-findings`：全部硬门禁通过，仅存在不改变 Stage 6 语义的既有观察项。
- `blocked`：修复项未达成或任一 L1–L8 硬门禁失败。

输出必须追加到 `docs/dev/context-control-plane/DEVLOG.zh-CN.md`，包含：
HEAD SHA、dirty patch 摘要、每类命令 exit code 与关键输出、修复 1/2 核对结论、
L1–L8 逐项判定、临时探针记录（含删除确认）、产品锁/密钥/卫生复核、最终 verdict。
