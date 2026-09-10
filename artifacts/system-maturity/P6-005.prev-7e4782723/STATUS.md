# P6-005 发布体检证据 — 当代重跑（2026-09-08）

- **绑定 commit**: `7e4782723fdc79055dfd5de01f7983fd254c05ab`
- **绑定 ref**: `refs/heads/feat/runtime-lifecycle-governance`
- **identity 状态**: 干净（A1 通过）、清单可复现（A3 通过）
- **验收**: A1 ✅ / A2 ❌ / A3 ✅

## 结论

这份证据**有效**——它证明代码确实就是绑定的那个 commit，且发布基线可逐字节重造。相比 8-10 那份旧证据是实质提升：旧的绑定已过期、且身份对不上，这份是干净的。

A2 未过，因为 13 个质量门里有 5 门是**本轮之前就存在的历史红门**，与 `TF-0127` 无关：

| 门 | 红因 | 归因 |
|---|---|---|
| `maturity:validate` | P8-001..004 指纹过期（`package.json` / `channel-config.ts` 后来变了、P8 计划文档未同步） | 历史遗留，与 F-GOV-003 的"证据过期"同根 |
| `test` | 少量现存失败 | 历史基线 |
| `lint:check` | `artifact-completion-class` lint 红 | 历史基线 |
| `harness:ci` | `harness/` 子包未装依赖（主树同样缺） | 环境 |
| `security:full` | 1 项安全检查未过 | 历史基线 |

**不装绿**：本证据完整保留全部 FAIL 输出（`gates/*.stderr.txt`），那 5 门要单独治理，不靠调验收来掩盖。

8-10 上一份备份在 `../P6-005.stale-20260810/`。
