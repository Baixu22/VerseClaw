# Verse Claw 火焰形象优化候选

本轮依据 [Immki：如何使用 AI 生成 LOGO](https://blog.200205.net/blog/ai/ai-logo-generation)，使用文章推荐的 [IP as Logo](https://github.com/s1dashu/ip-as-logo-skill) 方法：先分析产品，再提出三个方向，每个方向生成两张独立方图。

用户于 2026-10-06 选定 **B2**。应用侧栏、初始化页、静态启动页、favicon、README 页首和桌面图标资源已采用 B2；六张候选均保留原始返回文件。生产尺寸和托盘轮廓为另行导出的衍生资产，不修改候选原图。接入结果与实际界面截图见 [B2 验证记录](adoption-2026-10-06/README.md)。

## 产品与现状

Verse Claw 是集对话、项目代码、知识与 Agent 执行为一体的桌面工作台。现有角色的主要识别特征是橙色三瓣火焰、黄色椭圆脸和简单表情。新方向继续使用这一形象，重点调整轮廓、脸部比例和颜色关系。

选用前的资源入口分散：

- [`BrandLogo.tsx`](../../../src/components/brand/BrandLogo.tsx) 原先随机选取三个浅色版本，深色使用另一份素材；现固定使用 B2。
- [`src/assets/logo.png`](../../../src/assets/logo.png) 用于 README；另有内嵌位图的大体积 SVG。
- [`generate-icons.mjs`](../../../scripts/generate-icons.mjs) 从 `resources/icons/clawx-logo-kit/` 生成窗口、安装器和平台图标。
- Agent 头像使用独立的 `logo+character` 素材。

B2 现用于固定的方形侧栏/初始化标记，并通过原有图标脚本导出 ICO、ICNS 和各尺寸 PNG。深浅主题使用同一彩色形象；托盘模板为单独提取的黑/白轮廓。Agent 完整角色插画及 2026-10-05 README 截图是历史素材，保留原样。

## 六个候选

| 编号 | 方向与产品联系 | 位置 | 主体两色 | 背景 | 原图与提示词 |
| --- | --- | --- | --- | --- | --- |
| A1 | 经典火焰精简：延续既有识别，去除细碎小手 | 左下 | `#D94D12` / `#FFE09A` | 暖沙色 `#E9D8BB` | [原图](A1.png) · [提示词](prompts/A1.txt) |
| A2 | 经典火焰精简：更宽圆的中央火焰与脸颊 | 右下 | `#D94D12` / `#FFE09A` | 暖沙色 `#E9D8BB` | [原图](A2.png) · [提示词](prompts/A2.txt) |
| B1 | 圆润伙伴：大脸、均衡三瓣与轻微笑意 | 左下 | `#BD4319` / `#FFE6A7` | 鼠尾草色 `#B9C8AD` | [原图](B1.png) · [提示词](prompts/B1.txt) |
| B2 | 圆润伙伴：更宽的脸与安静的双眼表情 | 右下 | `#BD4319` / `#FFE6A7` | 鼠尾草色 `#B9C8AD` | [原图](B2.png) · [提示词](prompts/B2.txt) |
| C1 | 深色工作台适配：深蓝底与橙黄火焰分离 | 左下 | `#ED602E` / `#FFD16D` | 深海军蓝 `#253647` | [原图](C1.png) · [提示词](prompts/C1.txt) |
| C2 | 深色工作台适配：右叶更饱满、整体更宽厚 | 右下 | `#ED602E` / `#FFD16D` | 深海军蓝 `#253647` | [原图](C2.png) · [提示词](prompts/C2.txt) |

以上为提示词中的颜色与构图要求，生成图本身可能带有同色系明暗变化，不把它们描述为逐像素完全符合色板。查看 [gallery.html](gallery.html) 可同时比较原图和浏览器缩小后的 32/64 像素预览；原文件未经过缩放修改。

## 生成记录

- `driven_by: agent`，执行者 `codex-logo`。
- 来源 skill：`s1dashu/ip-as-logo-skill`，提交 `acb834c717bcd0a487c49732d08397ba280d690b`，MIT。
- 模型：用户指定的 `gpt-image-2.5`，使用其提供的兼容接口；凭据只在进程内传递。
- 请求：六次独立图像编辑，`size=auto`、`quality=high`，每次返回一张；提示词请求约 1536 × 1536，实际尺寸见清单。
- 参考：现有 `src/assets/logo.png` 原图放置在白色方画布上，仅作为身份参考；不以其他候选作为参考。
- 约束方式：`main-prompt constraints`，完整约束保存在每个提示词中。
- 生成图按返回原样交付，不自动做背景、颜色、构图修复或重试，不声称已完成全平台应用图标验收。

原图尺寸、字节数、SHA-256 和生成退出状态记录于 [manifest.json](manifest.json)。B2 的选用与实际图标生成输入见 [logo kit 清单](../../icons/clawx-logo-kit/manifest.json)。
