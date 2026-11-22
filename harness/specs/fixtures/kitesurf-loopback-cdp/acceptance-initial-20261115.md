# Kitesurf 本机 CDP 验收 · 2026-11-15

本次结论为 **NO_GO**。独立 CLI 的公网加载失败，当前 8787 端点又已不可用；全包测试还记录到一次 MCP EOF 退出时限失败。任务规格保持 active。

验收对象是原分支 codex/kitesurf-cdp-20261114，HEAD c3521cfc4252fab0a6c19c75eb3231cbf0f8e9af，工作目录 D:/ClawX-work/kitesurf-cdp-20261114。全部产物由 agent 驱动；最终运行时源码与两份行为收据的哈希一致。

| 检查 | 实际结果 |
|---|---|
| VerseBrowser 完整包 | 129 文件、1130 用例：1129 通过、1 失败、0 跳过；分组间源码保持一致 |
| 真实 Kitesurf | 8 个用例通过，19 个已完成断言，92 次实际控制调用 |
| 协议与边界 | 13 个用例通过：身份、回环地址、桌面拒绝、自动识别、Chromium 探测失败回退 |
| 独立 CLI | 最完整场次执行 13/17 项：12 通过、1 公网失败、4 项未完成；随后启动尝试因端点不可达失败 |
| MCP EOF 单独复测 | 2/2 通过；全包的失败仍保留 |
| 证据防篡改 | 7 个隔离副本负输入测试通过；当前正式校验仍拒绝完整 CLI 及其历史哈希 |
| 包类型检查 / 构建 / ESLint | 通过 |
| Host contract / Comms replay + compare | 通过 |
| 顶层 Web 类型检查 | 生成 extension bridge 后通过 |
| 顶层 Node 类型检查 | 当前依赖布局缺少 runtime 模块；原始检查失败，补充解析结果未取得退出收据 |
| Harness CI | 59/59 单元通过；catalog 检查因 runtime 的 tsx 缺失而中止 |
| PNG / PDF | PNG 1280 × 720、21772 个非白像素；PDF 1 页 612 × 792 pt，文本与渲染已核对 |

公网失败场次读取到 HTTP 403，页面正文为 “kitesurf: egress timeout after 25000ms”。WSL 将 example.com 解析到 198.18.0.224；系统代理的 curl 请求返回 HTTP 200。引擎的公网出站通路需处理后才能通过该项。

全包失败为 “closes the stdio worker on EOF with an open request pending=true”。单独复测通过，但完整运行未得到全绿结果。

运行时只读摘要因 Kitesurf 缺少全局属性描述符返回 E_CAPABILITY_UNAVAILABLE；JavaScript confirm() 也不可用。这些拒绝路径已验证。

本轮修复了回环地址、自动识别与会话路由、精准引用、已有文本填充、frame 所属节点、Upstream 驱动兼容性，以及启动/动作超时后的 worker 清理。真实收据由完成断言和实际调用生成，筛选运行保留上一份完整收据。

代码与证据保存在原分支，尚未提交。

[机器可读验收报告](D:/ClawX-work/kitesurf-cdp-20261114/harness/specs/fixtures/kitesurf-loopback-cdp/acceptance-20261115.json) · [完整包结果](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/batched-package-tests.json) · [EOF 复测](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/eof-recheck-tests.json)

[CLI 失败场次](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/cli-failed-attempt-1794711581957.json) · [当前端点状态](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/final-runtime-status.json) · [证据负输入测试](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/evidence-guards.json)

[真实动作收据](D:/ClawX-work/kitesurf-cdp-20261114/harness/specs/fixtures/kitesurf-loopback-cdp/actions.json) · [协议收据](D:/ClawX-work/kitesurf-cdp-20261114/harness/specs/fixtures/kitesurf-loopback-cdp/receipt.json) · [正式证据校验](D:/ClawX-work/kitesurf-cdp-20261114/harness/specs/fixtures/kitesurf-loopback-cdp/verify.json)

[Harness CI 日志](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/harness-ci.log) · [Node 类型检查日志](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/root-node-typecheck.log)

[PNG 样本](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/exports/page.png) · [PDF 样本](D:/tmp/kitesurf-acceptance-20261115-01a1dc94/exports/page.pdf)
