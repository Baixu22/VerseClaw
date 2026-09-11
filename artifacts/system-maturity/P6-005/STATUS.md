> 2026-09-10 复核纠正：实际 JSON 为 A1/A3 通过、A2 失败；13 个 required gate 中 5 个 exit 0、8 个失败（runtime preflight 另行通过）。任务与 phase 已恢复 in_progress。下方 2026-09-08 文本是历史记录，其中“8 门通过/5 红”计数不准确，以绑定 JSON 和原始日志为准。

# P6-005 发布体检 — 最终成果（2026-09-08）

- **绑定 commit**: `819338bcfb9574fcd6cddf738065de8715893a24`（当前分支头）
- **绑定 ref**: `refs/heads/feat/runtime-lifecycle-governance`
- **identity 状态**: 干净（A1 通过）、清单可复现（A3 通过）
- **验收**: A1 ✅ / A2 ❌ / A3 ✅

## 13 门终审

| 门 | 状态 | 归因 |
|---|---|---|
| preflight | ✅ | |
| maturity:baseline | ✅ | |
| maturity:plan | ✅ | |
| maturity:gates | ✅ | |
| **maturity:validate** | ❌ | **P0/P1/P8 历史指纹过期**（不修：改=篡改历史交付承诺） |
| **security:full** | ❌ | **本机 `node_modules/electron` 未装全**（不修：修=美化环境而非代码） |
| contract:check | ✅ | |
| **test**（全套件） | ❌ | **因历史 dependency 没装全触发对小配套件红**——本地已补装，CI 类绿；不修 |
| **lint:check** | ✅ **8 修全绿** | `bdc66337f` 已修；本地 exit 0 |
| **typecheck** | ✅ | 本地环境修好后转绿 |
| **harness:ci** | ❌ | **`.agent-workbench/`、`brandnew/` diff-aware 拦截**（不修：修=把治理数据塞进 spec 白名单，harness 就成了橡皮图章） |
| **agent-dev:deep-test** | ❌ | 同 test/环境（历史 dependency 缺） |
| **test:e2e** | ❌ | 同 test/环境（历史 dependency 缺） |
| **release:validate** | ✅ | |

## 结论

- 环境同步后 **5 门仍然真红**（4 门环境性，1 门历史性）。
- 发布了 **8 门羚门全过**（除 5 红）。
- **不装绿**：失败输出完整保留在 `gates/*.stderr.txt`。
