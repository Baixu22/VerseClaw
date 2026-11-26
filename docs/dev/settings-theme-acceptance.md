# 设置页主题验收

从侧栏进入「设置 → 通用」。主题和强调色在「主题与配色」，字体、字号和对话预览在「文字与阅读」，语言与启动项在「应用偏好」。`SettingsRoute` 加载正式桌面入口，`SettingsPageChrome`、`SettingsSidebar` 和 `#app-overlay-root` 分别承载正文、导航与弹层。

## 组件与样式归属

|界面|生产组件|需要观察的结果|
|---|---|---|
|通用、恢复和系统的开关与下拉|设置适配层调用共享 `Switch`、`Select`；开发者页的代理设置直接使用同一个 `Switch`|选中轨道、滑块、键盘焦点、菜单选项及回焦|
|外观设置|主题缩略图、颜色按钮、`SettingsSegmented`、与模型面板共用的 `EffortPreviewSlider`|明暗缩略图、当前选中标记、设置字号与对话字号|
|阅读预览与聊天|共用 `UserMessageBubble` 和 `AssistantMarkdown`|实际提问、回复正文的字号和字体，代码保留等宽|
|设置页与导航|共用页面外壳和设置卡片|底色、卡片、活动导航、标题与行标签字号|
|弹层|共享 Radix Select、添加提供商对话框、归档会话永久删除确认框|菜单挂载位置、底色、已选项、取消操作、危险按钮颜色|

设置字号提供标准、大、特大三档，对应标准字号的 100%、115%、130%。设置控件以 CSS 变量计算字号。对话字号单独保存。原色沿用产品配色；自定义强调色通过语义颜色变量作用到当前表面和可交互控件。成功、警告、错误和删除各自保留状态色。

需要调整配色时，在 `src/styles/appearance.css` 修改 `--appearance-ink`（强调色）、`--settings-canvas`（设置底色）和 `--settings-panel`（卡片与弹层）。导航与正文几何由 `src/styles/codex-settings.css` 管理，行标签和设置控件尺寸由 `src/styles/codex-settings-controls.css` 管理。设置页的样式作用域同时挂在页面、侧栏和应用弹层宿主上，因此下拉列表移出页面 DOM 后仍能继承同一组值。

## 执行矩阵

|检查|操作|通过条件|
|---|---|---|
|新旧配置|启动无外观字段的配置，读取缺字段、非法颜色和越界字号|每个字段独立恢复默认值，合法字段保留|
|明暗与调色|浅色、深色分别从原色切到青玉、玫瑰，再回到原色；另用系统取色控件提交自定义值|正文底色、卡片、侧栏、活动导航、主题选中边框和已开启的开关随选择变化；回到原色时，各项读数恢复|
|可读性与状态色|将控件和卡片的实际 CSS 色值转为 sRGB；在原色和自定义色下分别打开同一归档会话的永久删除确认框|强调色与卡片、开关轨道与滑块的对比度均至少为 4.5∶1；两次危险按钮的底色相同；取消可返回原页|
|字号独立|只放大设置字号，再把对话字号调至最大并按左方向键减一级|设置导航和选项文字按档位增大；只改设置字号时，回复字号保持之前读数；预览和真实提问、回复都显示选定字号|
|真实路由|依次点击 `SETTINGS_SECTION_SEGMENTS` 的全部入口|每个入口都有活动导航、对应标题和内容区域，加载骨架退出，正文面板颜色与通用页一致|
|弹层继承|用方向键打开语言菜单，移动焦点并按 Escape；进入模型页打开添加提供商|检查弹层实际挂在应用弹层宿主，菜单和对话框底色与设置卡片相符；已选项使用强调色；Escape 回焦且保留语言|
|跨页控件|在开发者页临时切换代理开关，再切回|共享开关的开启色等于通用页开启色，关闭色可还原；保存按钮从禁用变为可用、回滚草稿后重新禁用，并保留禁用态透明度|
|窄屏与几何|最低桌面宽度检查开关、菜单和行高；另在 375 CSS px 视口、特大字号、减少动态效果下打开菜单|保留 32×20 开关、28 px 触发器和 220 px 菜单；窄屏模块切换可用，菜单不越过视口|
|保存与重置|关闭 Electron，使用同一临时配置重新启动，打开聊天和设置；恢复默认外观后切换系统明暗|强调色、设置字号、对话字体与字号跨进程恢复；重置只恢复外观，界面深度保留|

## 运行与判定

在 Windows 仓库根目录执行下面的命令，使用项目锁定的依赖和对应版本的 Electron。

```powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
pnpm harness validate --spec harness/specs/tasks/appearance-personalization.md
pnpm run i18n:lint
pnpm run typecheck:web
pnpm exec vitest run tests/unit/appearance-personalization.test.ts tests/unit/rareui-interactions.test.tsx tests/unit/chat-agent-effort-popover.test.tsx
pnpm run build:vite
pnpm run test:e2e:run tests/e2e/appearance-personalization.spec.ts tests/e2e/settings-theme-css.spec.ts tests/e2e/settings-controls-fakecoding.spec.ts --workers=1
```

每次验收记录源码基线、构建产物、Electron 版本和结果目录。端到端用例通过正常设置入口操作，聊天历史与归档记录使用本地测试数据。配色断言读取可见 DOM 的 `getComputedStyle`，比较切换前后的值，并将设置路由与颜色读数写入 `settings-computed-css.json`。对比度断言使用实际解析颜色。截图用于复核裁切、换行及焦点位置。

验收以三个端到端文件全部通过、源码变动检查通过、测试进程已清理为准。控件未挂载、实际色值未变、弹层颜色回退、重启丢失或窄屏越界均应保留失败记录。新增设置模块自动进入路由遍历；新增控件类型时，需在该模块实际打开控件，并补充对应的样式断言。
