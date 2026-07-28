# FP-P1-08 evidence - product narrative and documentation sync

| item | value |
|---|---|
| 收账日期 | 2026-07-28 |
| claim boundary | 16 个当前产品面；686 个命中路径；6386 个历史/治理命中；0 当前产品违规；0 skipped |
| focused unit | claim/i18n/chat 60 passed；default matrix/launch contract 39 passed |
| contract / i18n | `pnpm contract:check`、`pnpm run i18n:lint` 均通过 |
| runtime copy | FP-P1-07 真 Electron E2E 断言 Setup 与 Settings 英文产品文案，4 passed (2.6m) |
| 状态 | G1-G4 已满足；G5 随 P1 独立出口后置，任务保持 `in_progress` |

## Acceptance evidence

| AC | 证据 |
|---|---|
| README 范围一致 | `README.md:42`、`README.zh-CN.md:42`、`README.ja-JP.md:42`、`README.ru-RU.md:38` 均声明 Windows x64 Controlled Preview 与 opt-in 边界 |
| 每组件唯一标注 | `docs/clawx-product-semantics.md:17` 的受控表由 `tests/unit/first-product-claims.test.ts` 精确断言 10 行、组件名唯一、标注值唯一 |
| 禁止词扫描 | [`forbidden-claims-scan.json`](./forbidden-claims-scan.json)；0 current product violations、0 skipped files |
| Setup / Settings 四语 | `shared/i18n/locales/{en,zh,ja,ru}/{setup,settings}.json`；claim unit 逐语言断言 Windows x64、Controlled Preview 与 opt-in |
| 一个开关 runbook | `docs/dcs-production-p0-runbook.md` 与 `.zh-CN.md:25` 均把 Settings > Developer 的 DCS Coding Preview 定为正常产品路径 |
| default matrix 一致 | `tests/unit/default-config-matrix.test.ts` + `tests/unit/launch-contract-matrix.test.ts` 共 39 passed，锁定 md/fixture/实现三方一致 |

## Runtime copy evidence

`tests/e2e/first-product-journey-fp-p1-07.spec.ts` 在真 Electron 中断言：

- Setup welcome 包含 `Windows x64 controlled preview`；
- Settings Developer 包含 `DCS Controlled Preview Flags`；
- 唯一预览卡片包含 `DCS Coding Controlled Preview`；
- 开关经真 Gateway restart/ack 达到 `applied`，不是只检查静态 JSON。

四语内容一致性由 unit/i18n lint 负责；本次没有把英文 E2E 冒充四语截图证据。

## 门禁判定

- G1 dev：README、product semantics、双语 runbook、default matrix、四语 Setup/Settings 已收敛；默认值未翻转。
- G2 test：60 + 39 focused tests、contract、i18n、claim scan 全部 exit 0。
- G3 runtime：FP-P1-07 真 Electron E2E 对实际 Setup/Settings 文本和 DCS ack 进行断言。
- G4 human：n/a；文案边界由自动化与后续独立验收覆盖，不冒充真人 canary。
- G5 accept：未满足；与 FP-P1-07 的独立 phase 出口一并后置。

## Residuals

- FP-P1 独立 G5 尚未完成；本任务不得标 `done`。
- ja/ru 其余历史占位本地化债继续归 `FP-P4-07`，不扩大本任务范围。
- 扫描报告中的历史/治理命中是具名豁免，不代表产品面违规；新增产品面仍必须进入扫描集合。

完整命令摘要见 [`focused-gates.log`](./focused-gates.log)。
