# 对话 UI 分层：真实任务视觉验收 · 2026-11-20

**判定：部分通过。** 成功计划、失败计划、提问回传和 Gateway 审批均有真实回执。流式提问曾出现两张独立可选的卡片；模型发起的命令探针也没有在任务权限检查后进入审批。两项保留为未通过，未签署整体 UX 验收。

候选为 `codex/chat-ui-hierarchy-20261119` 的工作区版本，基线 `47303b18996f94ec7fd9afbc89ba1dac0910e66d`。Electron 加载候选 renderer/Main，Gateway 使用同机 `D:/ClawX/openclaw_runtime/dist` 已构建运行时；测试使用 D 盘隔离配置和示例任务。操作者为 `codex`，`driven_by: agent`。模型为 `hy4flash-free`，通过仅对本次测试开放的本机代理转发至指定 Responses 路由。15 个 runtime 上游请求有 HTTP 200 回执；另有 1 个直接连通性请求。工具成功与否以 transcript/tool receipt 为准。

| 验收项 | 观察与判定 |
| --- | --- |
| 正常计划 | `task_control.start` 领取示例任务后，`update_plan` 返回 `updated`，两步分别为进行中、待处理；执行过程、步骤和最终回复层级可区分。见 `plan-desktop.png`。 |
| 失败计划 | 原版把 `TASK_CLAIM_REQUIRED` 的调用参数显示成进行中的计划。修复后重开同一份真实历史：提问卡 1，执行计划卡 0，计划栏 0，失败原因保留。 |
| 提问回传 | 在 375px 宽度选择 Pear，选项报告 `aria-pressed=true`；提交后模型确认 **Pear**。该轮曾同时出现两张同题卡（`question-duplicate-375.png`），持久化 transcript 只有一个对应的模型问题。随后一次独立纸样提问，在流式、临时终态、历史接管三个采样点均只有一张卡（`question-desktop.png`）。尚未证实重复条件已消除。 |
| Runtime 审批 | 独立的真实运行时客户端发出 `exec.approval.request`，命令为 `node --version`。Electron 在对应会话用审批替换输入栏；桌面、375px 深色、812×375 横屏下，两项决策均可见。点击拒绝后，原请求方收到同 ID 的 `deny`，pending 列表清空。没有执行命令。 |
| 模型发起命令 | 未领取任务时，模型调用 `exec` 返回 `TASK_CLAIM_REQUIRED`。重启后的继续任务中另有 Responses 终态解析失败；后续探针的 `task_control` 恢复请求先后缺少唯一目标、`requestId`，达到本轮三次上游请求上限。没有模型触发审批的闭环回执。此结果与上一行分开计分。 |

## 响应式与可访问性

使用 ego-browser 检查候选构建的中文 mock 对话；Electron 使用隔离的真实运行时交叉检查审批、计划与提问。下表是 ego-browser 实测的五个输入栏主操作（添加、权限、知识、模型、发送）；减少动态效果开启。

| 视口（CSS px） | 主题 / 输入 | 结果 |
| --- | --- | --- |
| 1280×800 | 浅色 / 鼠标 | 保留紧凑工具栏；五项在视口内。 |
| 768×1024 | 深色 / 触屏 | 五项均至少 44×44，宽度溢出 0。 |
| 375×812 | 浅色 / 触屏 | 五项均为 44×44，宽度溢出 0；修复前宽度为 30–32。 |
| 812×375 | 深色 / 触屏 | 五项均至少 44×44，宽度溢出 0。 |

Electron 冷启动回归复现过侧栏重新展开、发送按钮被裁切；修复后 375px 回归通过。添加菜单展开后聚焦首项，Escape 回到添加按钮，Tab 跳过已关闭菜单。150% 缩放与输入草稿恢复另由注入审批帧的 Electron 回归覆盖。

## 复核与下一步

- `receipts.json` 保存请求摘要、工具与决策回执、各视口的按钮边界、候选源文件与截图 SHA-256。截图为现场捕获；审批和模型卡截图来自 Electron，`composer-375-touch.png` 来自 ego-browser。
- 5 个 Vitest 文件共 95 项通过；3 项 Electron 定向回归通过（触屏/焦点、问答提交、审批/缩放/草稿恢复）。Web 和测试项目的仓库 `tsgo` 类型检查通过，候选构建、定向 ESLint、Harness spec 校验通过。
- 下一轮先固定「历史先到、终态后到」及相反顺序，记录每次卡片挂载的消息身份并断言同一问题只有一个可提交入口。命令审批另用已有效绑定到当前运行的 task claim，分别追踪 `exec`、`approvalId`、UI 决策和原调用回执。
