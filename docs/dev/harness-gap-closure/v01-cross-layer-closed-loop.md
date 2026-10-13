# V01：跨层闭环与多组件受控消融

日期：2026-10-13（Asia/Shanghai）。包码：V01（TF-0292）。

## 闭环

`tests/unit/cross-layer-closed-loop.v01.test.ts` 串起已交付组件：

1. **L05**：失败风暴 → 断路器 open；cooldown 内 `allowsRequest()=false`。
2. **E01**：同批 trial → `pass^k = 0.5`（<1）。
3. **G01**：`AppError('TIMEOUT')` → `retryable=true`、`nextAction={kind:'retry'}`。
4. **G03**：脱敏失败轨迹 → 样例 `{before-fix: fail, after-fix: pass}`。
5. **S07**：缺证据 → `insufficient-evidence` 且无完成转换（不伪装 done）。
6. **L06**：单一 owner 认领 → 释放（无残留 owner）。
7. **恢复**：cooldown 后 half-open 单探测成功 → closed。

## 受控消融（E02）

重跑 E02 形态的配对消融（20 case × 3 × 2）：判决保持 `component-helps`、`meanDiff=1`、falseBlocks=0、safetyViolations=0 —— 组件组合未使判决回归。

## 实测

| 断言 | 结果 |
|---|---|
| L05 open + cooldown 拒绝 + half-open 恢复 closed | ✅ |
| E01 pass^k<1 | ✅ |
| G01 retry 动作有界 | ✅ |
| G03 样例 before-fix fail / after-fix pass | ✅ |
| S07 缺证据无完成转换 | ✅ |
| L06 单写归属 + 释放 | ✅ |
| E02 判决 component-helps、安全计数未回归 | ✅ |

## 残余（residual）

- 本包是集成证据（确定性本地 fixture），不是真实 provider/真人/GA 声明。
- 具体的生产装配点（把各内核接到真实调用链）由集成层完成；不新增产品代码路径。
