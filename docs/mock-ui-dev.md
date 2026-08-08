# Mock 模式 — 纯浏览器 UI 开发

不需要启动 Electron 就能开发、调试、验收前端 UI。

## 启动

```bash
pnpm dev:mock
```

等价于 `vite --open "/?mock=1#/"`——启动 vite 并在浏览器打开 mock 会话。

- 正常开发（连 Electron）：`pnpm dev`
- mock 模式自定义端口：`pnpm dev:mock -- --port 5199`

## 原理

渲染进程通过 `window.verseClaw.hostInvoke` 与 Electron 主进程通信。浏览器里没有这个桥，所有 host 调用都会失败（gateway 显示 stopped、composer 被禁用、应用跳 setup）。

`src/lib/mock-host-bridge.ts` 在 `?mock=1` 时安装一个 fixture 驱动的假桥，回答 UI 实际发出的 host 调用。**UI 代码、store、IPC 封装全部走真实代码**——只有传输端点被替换。

安装时机在 `src/main.tsx` 最顶部，早于任何 store 初始化（store 会缓存第一次 host 响应，桥装晚了会冻结在失败态）。

## 已覆盖的 mock fixture

| 模块 | 行为 |
|---|---|
| `gateway.status` | running / ready（composer 可用） |
| `settings.getAll` | setupComplete=true（跳过向导） |
| `workspaces.getActive/list` | 一个 mock-workspace |
| `providers.*` | 一个启用且带 key 的 Anthropic 账户（first-send 门禁打开） |
| `files.stageBuffer/stagePaths` | 返回渐变图预览（图片附件走同步快照 dissolve） |
| `dialog.open` | 返回两个预置文件路径（gradient.png + notes.txt），"添加文件"全链路可跑 |
| 其他 | 安全空态（`{}` / `[]`），未知探测不崩 |

未列出的 `module.action` 走默认空态分支——UI 不会崩，渲染空态/加载态。**要新增 mock 表面，在 `FIXTURES` 里加一个 `'module.action': (req) => ...` 即可。**

## 验证过的链路（mock 下全部真实可跑）

- 加号 → 展开面板（方向自适应：窗口矮时向上展开）→ 添加文件 → 附件 chips → 删除 → smoky dissolve 动画 → chip 移除
- 侧边栏 workspace 切换器（显示 mock-workspace）
- 设置页（`window.electron.platform` 已 stub 为 win32）

## 注意事项

- **`?mock=1` 只在查询参数里触发**——正常 `pnpm dev` 不带该参数，完全不受影响；真实 Electron 环境下即使误带参数，`installMockHostBridge` 检测到真实桥会拒绝覆盖。
- `window.electron` 被 stub 为 `{ platform: 'win32', versions, ipcRenderer: undefined }`——IPC 事件通道（`hostEvents`）会打印 warn 并走 no-op，对 UI 开发无影响。
- 图标资源（lobe-icons 等）走 vite 本地服务，无需网络。
