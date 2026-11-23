### 四图观察

- **[rest-light.png](images/review-rest-light.png)**：36px 单行任务条与输入框共框自然，底栏成功收敛为权限、书本知识与模型三组入口，但回合空闲态下任务条左侧蓝色圆弧仍在旋转。
- **[run-dark.png](images/review-run-dark.png)**：窄窗下实时步骤仅在任务条抽屉内展开、对话流仅留单行耗时折叠条，无重复规划卡片，键盘焦点环清晰得当。
- **[knowledge-light.png](images/review-knowledge-light.png)**：单一书本菜单整合了来源与检索配置，但弹层高达约 804px 几乎占满窗口，且顶部 `No knowledge` 与中部 `Knowledge mode: Off` 并列易生歧义。
- **[approval-dark.png](images/review-approval-dark.png)**：审批卡原地接管输入区并将历史步骤收为单行 `Work details`，命令、目录与左次右主按钮层级干净、聚焦度高。

### 复核结论：主体结构达标，落实 3 项小修即可通过

1. **空闲态停止任务条旋转动画**
   - **位置**：任务条顶栏左侧状态图标组件。
   - **具体值**：仅本轮执行中（`isRunning`）启用旋转；回合空闲但持久任务未验收（`!isRunning && status === 'in_progress'`）设为 `animation: none`（保留现有状态蓝静态半环），消除两张浅色空闲图“后台仍在运行”的错觉。

2. **压缩知识弹层高度并加视口上限**
   - **位置**：知识书本弹层容器、中部下拉区与底部搜索区。
   - **具体值**：容器加 `max-height: min(520px, calc(100vh - 120px)); overflow-y: auto;`；`Knowledge mode` 与 `Retrieval profile` 改为双列（`grid-template-columns: 1fr 1fr; gap: 8px`），选项内边距收至 `8px 10px`；移除 `Search wiki pages` 下方重复的 2 行说明文案，立减约 200px，避免小屏裁切。

3. **降低知识菜单默认态歧义并补齐开关反馈**
   - **位置**：知识弹层中部下拉区与 `Runtime Lessons` 行（保持既有状态字段与默认值不变）。
   - **具体值**：选中 `No knowledge` 且处于默认 `Off/Local` 时，将中部双下拉弱化（`opacity: 0.6`）或收为单行摘要，非默认档位保持展开与外显标签；`Runtime Lessons` 右侧补齐复用现有灰阶/勾选态的显式状态标识（`Off` / `✓`）。

### 最应保留的结构
- **共框 36px 任务条 + 抽屉式实时步骤**（保留可见键盘焦点）与对话流单行折叠摘要的职责边界；
- **审批卡原地接管输入区**的单焦点阻塞交互；
- **底栏 32px 控件三组收敛布局**。
