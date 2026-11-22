# 会话 UI / UX 验收记录

2026-11-21，Windows，agent 驱动。当前命名场景的视觉与交互验收 **PASS**。

工作树：`D:/ClawX-work/chat-ui-hierarchy-20261119-01a1f3aa`，分支 `codex/chat-ui-hierarchy-20261119`，基线 `47303b18996f94ec7fd9afbc89ba1dac0910e66d`。候选为未提交工作区；本次源码 SHA-256、每项测试与原始运行路径见 [evidence.json](evidence.json)。截图可在 [gallery.html](gallery.html) 逐张查看。

| 用户流程 | 实际检查及结果 |
| --- | --- |
| 会话运行 → 成功／失败 | 成功与失败统一圆框线性图标，运行态保留 ThinkingOrb；真实渲染测量三者均为 14 × 14 CSS px。浅／深色截图通过。 |
| 顶部活动 → 展开会话 | 面板复用侧栏 SessionRow 和原操作处理器；置顶、更多菜单、右键、嵌套 Escape、切换会话、折叠侧栏、键盘及 reduced motion 通过。 |
| 计划提案 → 确认 → 下一请求 | 提案停靠在输入框上方；批准消息带原计划 ID，随后出现多步提问，原草稿保持不变。`requiresApproval: true`／`status: "proposed"` 是提案契约。 |
| 执行计划 → 运行结束 | 计划进度跟随所属当前运行；结束后退出停靠区，详情保留原步骤状态；不会把未完成步骤标成完成，也不会沿用前一轮计划继续转动。 |
| 多步提问 → 返回 → 提交 | 返回保留选择；流式与历史只显示一份请求；提交一次、按 ID 移除、草稿保留。普通会话的问题答复立即发送，避免进入等待当前运行结束的队列。 |
| 工作区权限 → 滚动／新一轮 → 决策 | 待处理卡始终在输入区域；失败后保留选择与按钮，错误原位显示；重复提交受 busy 防护，使用原 approval ID。 |
| 真实主机权限链 | 在独立 Electron 测试配置中，通过生产 `workspaces.create` 和 `terminal.run` 生成 `curl --version`／`curl --help` 的权限请求。界面分别拒绝、批准，随后读取真实 `workspace-permissions.json`，核对 ID、denied／approved 状态。批准记录后未重试执行命令。 |
| 运行时 exec 审批 | Electron 接收请求事件、只展示运行时允许的选项、发送正确 request ID，完成后恢复输入草稿和原节点；浅／深色、640 px、150% 缩放通过。该组运行时请求由 IPC fixture 提供。 |
| 持续等待审批 | 150 秒虚拟时钟验证：待审批时不误报模型无响应。配置中的独立 turn timeout 资源上限仍由原规则控制。 |
| 排队／引导／打断 | 长任务 Enter 排队、Ctrl+Enter 引导、Ctrl+Shift+Enter 打断；核对发送 payload 与会话键。Shift+Enter 保持换行。普通运行中的普通消息继续排队。 |
| 思考与过程层级 | 18 段长思考逐段检查高度、行高和相邻边界，全文保留且不重叠。零高度消息不再保留 200 px 的虚拟列表估计高度，过程折叠后相邻有效行间隔小于 45 px。 |
| 工具与终端 | 工具输入、输出与结果按事件顺序；终端行只保留一个图标；运行输出可展开，完成结果可折叠；窄屏布局通过。 |
| 流式 Tool UI | 单元测试遍历 JSON 围栏每个中间截断位置；Electron 分块发送真实消息事件，确认未闭合的显式围栏不闪现原始 JSON，完成后生成卡片。 |
| 窄屏与焦点 | 375／640 px 下请求、提交按钮与输入区保持可达，页面无横向溢出；新请求可以从输入焦点进入，结束后恢复输入焦点；明暗模式分别检查。 |

**验证结果**

- 290 / 290 项定向单元与集成测试通过，0 skipped。最后的审批／虚拟列表调整另有 60 项复核通过。
- 19 条 Electron 场景整组通过；随后对最终调整复核，并补充成功／失败图标几何检查。20 条唯一场景的最新结果均通过。运行、补测、早期失败分别保留在证据索引中。
- 渲染层 TypeScript 检查、Vite 渲染器与 Electron Main/preload 构建、i18n、Harness、通信回放与比较通过。
- 相关文件 ESLint 没有 error；现存 Fast Refresh 导出提醒保留。
- 完整 Node/test 类型检查仍失败：vendored runtime 缺少 `markdown-it` 类型、`jiti/static`、OpenTelemetry、tree-sitter 和部分 runtime SDK 链接。日志位于 `D:/tmp/ui-ux-20261121-01a1fdaa/typecheck-node-final.log` 与 `typecheck-test.log`。

**验收依据**

使用 ui-ux-pro-max 的焦点可见、稳定反馈、语义状态、层级、主题和窄屏规则；实现复用本地组件。对照本地 `D:/ClawX-analysis/t3code` 的 `470ca63499293f7f680f8ad2e77381a6752f1348`，重点阅读 `ChatView.tsx` 与 `chat/ChatComposer.tsx` 的待处理请求和输入区域组织。

ego-browser 完成问题选择／提交、滚动停靠、计划收尾及完整 mock 输出流程。其截图接口连续超时，最终视觉判定使用真实 Electron 截图，逐张检查后保存 19 张原图。所有交互均由 agent 驱动；模型输出使用可控事件／历史数据，本轮模型服务请求数为 0。

**过程中保留的失败与修复**

首轮失败包含旧颜色断言、测试未渲染新的 composer slot、重复装饰性审批卡和旧计划生命周期断言。真实交互还暴露了审批拒绝回执显示翻译键、Shift+Enter 测试使用旧快捷键、等待审批时误报模型无响应、虚拟列表空行估计高度，以及主题切换过程中的不完整截图。分别修复后重跑；测试结果没有改写早期失败。

初次 `pnpm harness` 自动触发了安装，工作树共享 `node_modules` junction 的相对链接失效，首次 Electron 启动因此缺少 VerseBrowser。修复链接并构建该包后恢复；修复清单与初始工作区补丁保留在同一临时目录。当前源码预览为 `http://127.0.0.1:5291`，PID 27896。
