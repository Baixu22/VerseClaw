# 本机 Kitesurf CDP 验收

独立 VerseBrowser CLI 接入本机 Kitesurf，通过同一个回环控制进程保存
WebSocket、页面身份和观察窗口。Windows CLI 使用 Node 24.16 或更新版本。

本机引擎固定在 Kitesurf 提交
`4a2903813a22b08d4f3cc64a4b35339d0293a5d1`，需要先具备该提交的
Wasm、PageScript 和页面渲染资源。`scripts/kitesurf-local-runtime.mjs` 使用
上游安装的 Wrangler 本地多 worker 服务器，同时加载引擎和原生 fixtures。

在 WSL 中启动已构建的引擎：

```sh
export TMPDIR=/mnt/d/tmp
WRANGLER_SEND_METRICS=false node --use-env-proxy \
  /mnt/d/ClawX-work/kitesurf-cdp-20261114/scripts/kitesurf-local-runtime.mjs \
  /home/bai/tmp/kitesurf-upstream-20261114
```

启动器输出 JSON，其中 `endpoint` 是本次 CDP 地址，端口由系统分配。
Node 的 `--use-env-proxy` 读取已有的 `HTTP_PROXY`、`HTTPS_PROXY` 和
`NO_PROXY` 配置，让引擎的真实出站请求经本机代理解析公网域名。启动器核对
`global_fetch_strictly_public` 和私网开关；公网页面访问回环地址仍由引擎拒绝。

将输出的端点设置为测试环境变量后执行：

```powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
$env:KITESURF_CDP_ENDPOINT = '<启动器输出的 endpoint>'
pnpm --dir packages/versebrowser build
pnpm --dir packages/versebrowser exec vitest run tests/kitesurf-cdp.test.ts tests/kitesurf-live.test.ts --maxWorkers=1
node scripts/kitesurf-live-verify.mjs
node scripts/kitesurf-loopback-cdp-verify.mjs
```

真实动作测试从 CDP 地址推导 fixtures 和版本探测地址。公网验收核对
`https://example.com/` 的 HTTP 200、可见段落、快照页面身份和
`documentation examples` 正文；它不依赖站点旧版的 `h1` 元素。
私网用例另行核对引擎的拒绝原因与目标服务器的零次访问。

协议、真实动作和独立 CLI 收据写入
`harness/specs/fixtures/kitesurf-loopback-cdp/`，包含 agent 归属和当前源码哈希。
失败及筛选运行保留上一份完整收据。独立 CLI 关闭会话后再尝试快照，必须返回
`E_NO_SESSION`，并确认控制进程和会话目录已删除。

SDK 关闭会话会先取消挂起的受控传输，再等待原生页面退出。弹窗在页面事件
之前发出的 console 消息由 context 事件收集，仍归属该弹窗的观察窗口。
legacy 指针操作先激活会话持有的页面，再发送单次原生手势。

完整验收结果见该目录中的 `acceptance-20261115.md`。

CI 验收先执行完整类型检查、构建和 Agent Dev E2E。重复诊断可用
`node scripts/agent-dev-deep-test.mjs --reuse-build`，继续运行完整类型检查和 E2E。
完整门禁的退出收据与
诊断报告分开保存；复用报告保留 `requiredFullGates`。类型缓存同时绑定
workspace 配置、测试源码及导入的 VerseBrowser 类型声明。
已有 `pnpm-workspace.yaml` 的内容修改也会使缓存失效，覆盖主仓库和 runtime。
