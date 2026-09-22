# ClawX 实习展示说明

阶段 2 材料草稿；本次先由 TF-0234 固化限制栏，演示包、贡献归属和封存尚未验收。方向以 [综合规划](qa-synthesis-roadmap-20260922.md) 为准。

分工口径（2026-09-22 裁定）：**agent 是主线开发者，用户是发布者。** 本页与贡献归属页的内容由 agent 从提交、diff 与任务图记录重建，不需要用户口述。

这是一个人与 AI 协作的「Agent 基座 + Harness + LLM 工程化」展示。在 Windows x64 上，agent 通过 ClawX 和一个真实 provider，在独立练习工作区执行测试、修正代码并再测试；操作者不是具名真人。[J-03 留档](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/README.md)记录 3/3 测试通过、28 行 runtime 收据及 7 对 ContextReceipt/v1–WireReceipt/v1。收据开关仅在演示进程中显式开启，默认仍关。

J-04 记录了一次 Runtime 审批边界：`exec.approval.requested` → host RPC 在 readOnly 下被拦 → agent 直连 Gateway 作出 allow-once 决定 → 命令在决定后继续。留档已含最终 `journey.json`（候选洁净证明、24 文件哈希清单、凭证扫描 0 命中）。该运行本身没有完成编码任务——readOnly 工作区不允许写入，这是权限边界的预期结果，不是失败。[审批证据与限制](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J04/README.md)

## 限制栏（对应 TF-0234 五项裁定）

| 项 | 对外说明 |
| --- | --- |
| ① 历史回放 | Main 的本地转写路径仍与隔离 Runtime 有差异；演示依据已导出的记录，不承诺 `sessions.history` 回放可用。 |
| ② 审批 | 非 fullAccess 可能等待审批；ClawX 尚无应用内 Runtime 审批 UI。本次由 agent 直连 Gateway RPC 决定，readOnly 下 host RPC 被拦。 |
| ③ 配置生效 | Gateway 连上不足 8 秒可能跳过 reload；演示驱动配置后显式重启，不承诺即时热生效。 |
| ④ 工作区副作用 | 完整旅程会写 Harness、Runtime 引导文件和状态；符合 bootstrap 条件时仍会 `git init`。演示使用独立练习目录。 |
| ⑤ 界面同步 | 本次驱动直接调用 host，截图仍显示旧工作区名和 Read only；它不能代表实际执行权限。正常 UI 点击切换未在本轮作 Electron 验证。 |

逐项代码坐标、截图和原始事件见 [五条尾项裁定](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/README.md#五条演示尾项裁定tf-02342026-09-22)。本次只核对和记录，没有修复这五项。演示日 provider 不可用时使用留档，不把测试通过或过程产物解释成 GA、默认启用或产品放行；三条产品锁继续保持 false。[范围与预案](qa-synthesis-roadmap-20260922.md)
