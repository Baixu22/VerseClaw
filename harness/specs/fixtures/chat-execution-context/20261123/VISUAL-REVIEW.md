### 最终视觉结论：主体达标，修正以下 3 个必修精确值后通过交付

四张实测截图的几何骨架、灰阶层次与原位状态流转均已达标，但 [04-narrow-and-failure.png](images/review-04-narrow-and-failure.png) 失败恢复卡存在主操作按钮深底黑字不可读的实质缺陷，暂不直接放行，仅修正以下 3 个精确值即可完成交付。

### 三项核心评估
- **符合参考质感**：[01-execution-dark.png](images/review-01-execution-dark.png) 与 [04-narrow-and-failure.png](images/review-04-narrow-and-failure.png) 明暗实底灰阶准确（深色 `#21211F` / `#2B2B29` / `#383836` / `#333331`，浅色 `#F7F7F5` / `#ECECE8` / `#FFFFFF` / `#FCFCFA`）；`22px` / `16px` / `18px` 圆角、`12px`（窄窗 `8px`）内缩与 `10px` 叠入比例扎实，`+` 号去实底并保留圆形发送钮后底栏干净克制。
- **清楚简洁**：页眉项目只读与历史下拉职责分明；工作树收敛于托盘单层浮层，`375px` 窄窗底栏自动收束为纯图标且浮层无裁切。[03-task-integrated.png](images/review-03-task-integrated.png) 将当前任务步骤并入同一托盘上行并以细分割线衔接目录行，消除了底部双层卡片堆叠。
- **进度卡融入体系**：[02-progress-dark.png](images/review-02-progress-dark.png) 以同构 `22px` 实底容器原位替换输入框，与上方托盘（左示状态、右置分支名）严丝合缝；三阶段真实推进无弹窗打断与虚假百分比，完全融入对话底座。

### 必修精确值（共 3 项，不改结构与交互逻辑）
1. **失败卡 `Retry creation` 主按钮对比度修正**：[04-narrow-and-failure.png](images/review-04-narrow-and-failure.png) 失败卡中该按钮呈深灰底近黑字（对比度 `<2:1`），须与 `Create and open` 统一主胶囊实底——深色 `background: #F3F3F1`、`color: #1F1F1D`（悬停 `#FFFFFF`）；浅色 `background: #1F1F1D`、`color: #FFFFFF`（悬停 `#333331`），`height: 28px`、`padding: 0 12px`、`border-radius: 999px`、`font-weight: 500`。
2. **胶囊主按钮禁用态去半透明灰雾**：窄窗 `Create and open` 禁用态因整块透明叠底导致浅色灰底白字（约 `2.9:1`）状态含糊。禁用态固定 `opacity: 1`，改用灰阶实底——深色 `background: #454542`、`color: #8A8A84`；浅色 `background: #E4E4DF`、`color: #94948E`。
3. **失败卡外框回归中性描边**：去除失败卡整圈 `22px` 红棕外框，保持与常规输入/进度卡一致的 `1px` 中性描边（深色 `#4A4A47`、浅色 `#DFDFDA`）；错误语义色仅用于失败步骤与单行原因（深色 `#E56464`、浅色 `#C93B3B`）。
