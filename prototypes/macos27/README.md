# macOS 27 独立复刻页

这是一个完全独立的静态原型，不会被 ClawX 的 React 入口、Electron 路由、i18n、host-api、测试或生产构建导入。

## 运行

可以直接打开 `index.html`，或在仓库根目录运行任意静态服务器，例如：

```powershell
node ./node_modules/vite/bin/vite.js prototypes/macos27 --host 127.0.0.1 --port 4173
```

然后访问 `http://127.0.0.1:4173/`。

## 文件

- `index.html`：独立页面结构
- `styles.css`：壁纸、玻璃材质、窗口、Dock 和响应式样式
- `app.js`：菜单、窗口拖动、Dock、Spotlight、控制中心和右键菜单交互

该目录没有引用 `src/`、`electron/` 或 `shared/` 中的任何 ClawX 代码。
