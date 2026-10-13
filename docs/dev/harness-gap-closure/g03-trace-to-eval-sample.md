# G03：脱敏失败轨迹 → 可复跑评测样例

日期：2026-10-13（Asia/Shanghai）。包码：G03（TF-0291）。真实 provider 调用：无。

## 链路

`scripts/lib/trace-to-eval-sample.mjs`：

- `traceToEvalSample(trace)`：把一条脱敏轨迹转成样例；`expected = { before-fix: fail|pass, after-fix: pass }`（failure 轨迹 before-fix=fail，其余保持 pass）。
- `traceToEvalSamples(traces)`：显式触发批处理（仅调用方选定轨迹；可对应最近 7 天 runIds），逐条留 rejected 诊断。

## 约束

- **有界 reproducer**：`kind ∈ { scenario, route, command-id }`；不是 shell 指令。
- **selector 可定位**：`{ runId, attempt }` 供 replay。
- **确定性**：样例含 digest。
- **脱敏闸门**：出现 `prompt/messages/body/authorization/apiKey/headers` 或 `sk-/phc_/ghp_/AKIA/私钥` 等即拒绝整条（`trace-not-redacted`），不写样例。
- **显式触发**：不做定时 automation/daemon；不删原始证据。

## 实测

| 断言 | 结果 |
|---|---|
| failure 轨迹 → before-fix fail / after-fix pass；digest 确定 | ✅ |
| success/refusal/cancelled → pass | ✅ |
| raw prompt 或密钥 → 整条拒绝 | ✅ |
| 非有界 reproducer（shell）→ 拒绝 | ✅ |
| 批处理逐条留 rejected 诊断 | ✅ |
| 缺字段 → 拒绝 | ✅ |

## 残余（residual）

- 本包提供转换器；把它接到具体 trace 存储/runner 属集成层。
- 不新建 scenario registry/daemon/定时任务；不改默认值/锁/approval；非真人证据。
