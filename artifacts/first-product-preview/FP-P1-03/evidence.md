# FP-P1-03 evidence — 显式 DCS opt-in + runtime ack 串联

| item | value |
|---|---|
| 收口日期 | 2026-07-27 |
| E2E | `tests/e2e/dcs-preview-optin-fp-p1-03.spec.ts` **1 passed (10.4m)** |
| 单测 | `dcs-preview-switch` + `dcs-prod-flags-control` + `dcs-prod-flags-catalog` **3 files / 21 passed** |
| contract:check | Contract check passed. |
| i18n:lint | i18n lint passed. |
| git diff --check（本任务文件） | 干净（修掉 runbook 两处 markdown hard-break 尾空格） |

## Preview 能力组合（明文，AC 第 1 条）

`DCS_PREVIEW_COMBO_FLAG_IDS` @ `shared/dcs/prod-flags-control.ts:373`

| flag id | 作用 |
|---|---|
| `context-view-tools` | context read / search / view 工具 |
| `working-memory` | 编码 context block |
| `tool-registry` | 编码 context block |
| `stale-write-guard` | 受控写入的写侧安全 |

write journal / undo 为 baseline-on，不属任何开关（故不在组合内，但链路可用）。

**排除项（Hard lock：不得塞进组合）**：`routing-memo-shadow`、`sekb-experience-shadow`、
`symbol-lease`、VToken、RM inject、SEKB writeback、Browser。
守卫：`tests/unit/dcs-preview-switch.test.ts:120` 对三个可写排除项逐个断言不在组合内。

## E2E 四阶段原始输出（真 Settings DOM + 真 gateway child）

```
[fp-p1-03-refused] {"success":false,"enabled":false,"status":"error","restartedGateway":false,
                    "comboFlagIds":["context-view-tools","working-memory","tool-registry","stale-write-guard"],
                    "missingPrereqs":["providerVerified","workspaceSelected","permissionChosen"],
                    "error":"Preview prerequisites missing: providerVerified, workspaceSelected, permissionChosen"}
[fp-p1-03-on]      applied
                   ack trail = saved → pending-restart → restarting → runtime-acknowledged → applied
                   effective(child) = contextViewTools/working_memory/tool_registry/staleWriteGuard 四项均 true
[fp-p1-03-parity]  {"wouldChangeTurn":false,
                    "effectiveFlags":{... working_memory:false, tool_registry:false,
                                      staleWriteGuard:false, contextViewTools:false,
                                      writeJournal:true, worktree.backend:"inprocess",
                                      symbolLease.mode:"memory", patchFlow.default:false,
                                      vtoken.assembly:false, killSwitch:false}}
[fp-p1-03-killed]  failed   （config kill 写入后开启 → UI 显示 killed，绝不 applied）
1 passed (10.4m)
```

## 逐条 AC 证据指针

1. 一个入口开启首发组合 → `prod-flags-control.ts:373` + E2E `[fp-p1-03-on]` 四 flag 齐 true
2. 前置校验（provider/workspace/permission）→ `dcs-prod-flags-api.ts:399,406`；E2E Phase A 开关 disabled + `missing-*` 三项可见 + 后端直呼也被拒
3. UI 显示 `runtime-acknowledged → applied` + effective flags → E2E 断言 trail 全字符串 + 四个 `effective-<key>` 文本
4. 关闭后回基线 → Phase C：四 flag 全 false + `wouldChangeTurn:false`
5. 排除项不出现/不连带 → 单测 `:120` 三项断言 + 组合定义注释
6. env/config kill 压制 → Phase D `data-ack-state=failed` + killed 徽章 + killswitch 提示可见
7. i18n en/ja/ru/zh + runbook「一个开关」路径 → `shared/i18n/locales/*/settings.json` 的 `developer.dcsPreview.*`；`docs/dcs-production-p0-runbook.md:24` / `.zh-CN.md:24`
8. E2E 全链 → 上述 4 阶段单条测试内串行完成

## 门禁判定

- G1 dev：组合默认 off（`DcsPreviewState.enabled` 由四 flag 全开推导，AppSettings 默认 false）；kill 优先级高于开关（Phase D 实证）；contract:check 过；本任务文件 diff --check 干净。
- G2 test：21 单测 + 1 条 4 阶段 E2E；失败路径（缺前置 / kill）均有显式 error 文案，非静默降级；未跳用例、未放宽断言。
- G3 runtime：applied 只由完整 child ack payload 置位（沿用 FP-P0-04 五态，未退化）；UI 列出的 effective flags 直接取自 child ack，与真 child 逐项一致。
- G4 human：n/a — 真人使用记录在 FP-P2-02。
- G5 accept：self-accept（单人执行）；AC 8/8 有可点开指针；残留转 FP-P1-08 / FP-P4-07。
