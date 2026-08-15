# Mock 渲染场景清单

浏览器无 Electron 环境下的渲染层走查底稿。启动：

```bash
pnpm dev:web
```

打开 `http://localhost:5273/?mock=1&script=<scenario>`，在输入框发送任意消息即触发脚本。
实现：[src/lib/mock-run-script.ts](../../src/lib/mock-run-script.ts)（run 脚本）+ [src/lib/mock-host-bridge.ts](../../src/lib/mock-host-bridge.ts)（host fixture）。

设计原则：**每个场景压一条审计发现的断裂路径**，而不是演示能跑通的路。`toolui` 与 `toolcall` 互为对照组——同一批卡片分别走围栏与工具调用两条通路，任何一边断裂都能被对照发现。

## 场景表

| `script=` | 触发后预期看到 | 锁定的审计发现 |
|---|---|---|
| `full`（默认） | 计划卡 → Terminal 卡 → 权限审批（可批可拒）→ 内联 diff → 含全量 Tool UI 围栏的最终回复；回复上方有「Thought for Ns」推理折叠（来自**真实 thinking 块**） | 综合冒烟；F6 历史路径 |
| `toolui` | 最终回复文本内的 ```` ```tool-ui ```` 围栏渲染出全部 24 种卡片 | F1 的围栏通路（审计中本来就通的一侧） |
| `toolcall` | weather / table / chart 三张卡片以 **tool_use 工具调用**形式逐个出现，随后最终回复 | **F1** —— 修复前这条通路整类不可达 |
| `ask` | 只出现一张「要发布到哪个环境？」问题卡，**没有最终回复，run 保持 running**；卡片可选择、可提交 | **F1 最严重症状**：修复前 run 卡死且用户看不到问题 |
| `planonly` | 折叠头出现「3 步计划」角标；展开后只有计划卡，**没有空的执行图壳** | **F10** 空执行图守卫 + **F5** 内容角标 |
| `approval` | run 中途抛出权限审批并**等待决策**，批/拒后 run 继续 | 审批交互闭环 |
| `carryover` | 第 1 轮抛出审批且**不解决**、run 正常结束；发送第 2 轮消息后**审批卡片仍然可见、可决策** | **F4** 跨轮存活 + 无活动卡时的独立兜底面 |
| `thinking` | 流式期间出现实时推理面板（thinking.delta 驱动）；结束后折叠为摘要，刷新/重载后仍在（历史 thinking 块驱动） | **F6** 双通路（live + history） |
| `abort` | run 空转 20s，点 Stop 后 turn 状态settle 为「Stopped」而非「Completed」 | 中止生命周期 |

## 侧边栏 fixture（所有场景共用）

- 工作区 `mock-workspace` 下 **6 个会话**、**三层嵌套工作组**（渲染修复 → 审计回归 → 深层用例）+ 平级「发布准备」。
- 走查点（对应 F2/F3）：
  - 重命名「深层用例」→ 父级「审计回归」「渲染修复」名字**不得变**；
  - 删除「深层用例」→ 父级**不得消失**；
  - 深层会话行 hover 出现移动按钮 → 可移到任意组或移出（菜单为 portal，不被侧边栏裁切）；
  - folder 变更为**真实内存改写**——刷新前的所有操作在 UI 上立即可见。

## 附加参数

| 参数 | 作用 |
|---|---|
| `&slowStartup=<ms>` | 拖慢首次 `chat.history`，用于检查启动骨架屏 |

## 已知边界

- Mock 只允许发 `shared/chat-runtime-events.ts` 声明过的事件类型；`seq` 纪律见 `mock-run-script.ts` 内注释（漏 `seq` 会被 gateway 去重吞掉第二个同态事件）。
- 涉及真实主机能力（文件系统、git、终端）的验证仍归 Electron e2e，mock 不模拟。
- 页面模块态（transcript、pendingApproval）随刷新清空；`carryover` 的两轮必须在**同一次页面会话**内完成。
