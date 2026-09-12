# 工具运行时可靠性收口（2026-09-12）

本批接力 TF-0156/0157 之后的真实缺口，不把本地工程结果升级为产品放行，也不重做已完成的循环终止与前台心跳主路径。

## 完成节点

| 节点 | 缺口 | 修复前 | 修复后 |
|---|---|---|---|
| TF-0169 | 请求窗口小于终止阈值时循环永远达不到 critical | `historySize=5` 时 generic/global/unknown 无法终止 | 窗口至少覆盖 warning/unknown/critical/global 阈值，默认阈值不变且历史仍有界 |
| TF-0170 | 全局裁剪会冲掉当前 run 的循环证据 | 另一 run 填满窗口后当前 run 无法终止 | 按 runId 独立保留有界历史 |
| TF-0171 | 原生 hook relay 只认 sessionKey | 仅有 sessionId 时不跑循环检测 | sessionId 同样启用 pre_tool_use 循环检测 |
| TF-0172 | 取消错误写入循环历史 | 取消重试可能被当成循环证据 | AbortError 不记 resultHash |
| TF-0173 | 取消后仍转发 onUpdate | 已结束的消费者继续收到进度 | 包装器在 aborted 后丢弃进度 |
| TF-0174 | 心跳 onUpdate 抛错可能打断等待 | 消费者异常影响仍在运行的进程 | 心跳捕获消费者错误，进程仍可正常结束 |
| TF-0175 | node-host 在目标解析后仍可能 invoke | 取消发生在 resolve 之后仍启动远程命令 | throwIfAborted 后才允许 invoke |
| TF-0176 | process poll/log 的 idle 时长被当成进展 | 等待输入提示中的 duration 使哈希每次不同 | 归一化 idle 文案，无新输出可达到终止 |
| TF-0177 | execute 在取消后仍返回成功 | 晚到的成功结果交给已取消的调用方 | 返回前 throwIfAborted，成功结果不交付 |
| TF-0178 | node-host prepare 路径取消后仍可能继续审批/invoke | skip-prepare 以外的路径缺少同等守卫 | prepare 之后再次 throwIfAborted，analyze/invoke 不再发生 |

## 验证

- 聚焦 agents Vitest：9 files / 39 tests PASS
- `pnpm --dir openclaw_runtime tsgo:core` PASS
- `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep foreground` 2/2 PASS（已先 `pnpm run build:runtime`）
- 本批不改变产品默认开关，不把模拟模型或自动化执行计作真人验收

## 仍未完成

- 端到端 Electron/CDP 复现与具名真人验收仍未执行
- TF-0009 / TF-0133 的真人证据与 default-on 毕业不在本批范围
- node-host 远程 invoke 一旦已经发出，网关调用本身仍不随 AbortSignal 取消
