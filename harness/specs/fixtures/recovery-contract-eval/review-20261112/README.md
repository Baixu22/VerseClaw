# 恢复契约评审接力（2026-11-12）

驱动方式：agent；actor：`codex/recovery-contract-review-20261112`；不含 real-human 证据。

## 选中范围

本轮从 Task Forest 中选择无活跃会话占用的恢复契约评审组：TF-0709、TF-0711、TF-0713、TF-0717。选择时已排除正在执行的 TF-0662、TF-0664/TF-0862 和 TF-0884；历史恢复工作树与相关进程均无活会话。

## 结果

| 节点 | 本轮结论 | 依据 |
|---|---|---|
| TF-0709 | 可收口 | 冻结契约 17/17 单测；5 窗口、30 对、9 指标与篡改拒绝均通过；node/web/test 类型检查和 contract check 通过。 |
| TF-0713 | 可收口 | 五入口映射与单一决定契约 14/14 单测；node/web/test 类型检查和 contract check 通过。 |
| TF-0717 | 可收口 | 生产侧已落地持久化 execution phase、revision CAS、journal-first 恢复和启动 orphan 结算；pure contract 12/12、runtime phase/CAS 71/71、Task Loop cutover 11/11 通过。 |
| TF-0711 | 保持 review_needed | 主 legacy 15 槽完整，但独立复跑只有 14/15 完整、12/15 结构匹配；“两次重跑结构一致”仍未满足。 |

## 执行证据

- 聚焦契约：43/43 passed。
- phase/CAS 生产侧与恢复：71/71 passed。
- Task Loop 启动失联结算与 legacy 默认：11/11 passed。
- `typecheck:node`、`typecheck:web`、`typecheck:test`：全部 exit 0。
- `pnpm contract:check`：exit 0。
- 三份 spec：当前结构 `--no-diff` 通过；对应干净候选按 `99c142fe` 基线执行 changed-path validate，均 exit 0。
- 旧证据包离线复算：`verified=true`，两臂 `--verify` 均为 0，负面门禁均为 1，篡改副本为 1，原包未变。

## 保留缺口

TF-0711 需要在新构建上重新得到两次完整且结构一致的 legacy 基线。本轮没有在活跃 Playwright 验收和内存压力下启动这项真实恢复测量，没有把旧结果或离线复算写成新的恢复收益证据。

- 凭据模式扫描：0 hits。

完整机器可读结果见 `report.json`，文件哈希见 `SHA256SUMS`。
