# Serena Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\serena-main\test\solidlsp\...`、`test\serena\test_hooks.py`、`test\serena\test_edit_marker.py`。

## 值得移植的测试形态

- document symbols：文件内顶层 symbol 和嵌套 symbol 能被枚举。
- definition：同文件和跨文件跳转。
- references：跨文件引用、未打开文件引用。
- hover/signature：符号上下文说明。
- diagnostics：TypeScript/Svelte 等语言的错误返回。
- rename：同文件 rename、跨文件 workspace edit。
- implementation/declaration：接口、抽象类、实现关系。
- stale lock / LS process 状态：语言服务器不可用时的恢复策略。

## ClawX 应新增 fixture

- React component + hook + shared type：从 UI 文本追到 component，再到 hook。
- Electron renderer -> host-api -> main handler：跨层 definition/references。
- rename IPC route 名称：验证 workspace edit 覆盖 renderer/main/shared。
- symbol body replace 后跑 diagnostics：验证新增错误能阻止 verifier 通过。
- 语言服务器重启后用 checkpoint 重新定位 symbol。
