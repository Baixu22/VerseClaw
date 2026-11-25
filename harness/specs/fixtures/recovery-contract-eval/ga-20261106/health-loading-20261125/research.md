# G3 启动路径资料与代码对照（2026-11-25）

driven_by: agent
actor: codex/g3-r44

用户授权主代理诊断、子代理通过 VerseSearch 调研。两位 WorkBuddy 子代理和一次重发均回复任务正文为空，没有产生调研结果。主代理接手 VerseSearch → Exa Search，保存三组原始结果于 D:/tmp/g3-research-20261125-r44/exa-{0,1,2}.json。web.run 搜索/打开调用未返回可读结果。没有向搜索服务发送仓库源码、日志或凭据。

## 可采用的经验

Electron 官方 Performance 指南建议先剖析实际运行代码，再缩小启动加载的模块及依赖范围。其模块加载案例直接对应本地 health-state 静态导入健康探测和 updater 的问题。
来源：https://www.electronjs.org/docs/latest/tutorial/performance

Node 官方 module 文档解释，compile cache 主要减少相同模块的再次编译；首次生成可能更慢，主动 flush 用于退出前把缓存提供给后续进程。当前实现已经启用并在启动及执行边界 flush，因此本轮继续压缩加载图。网页滚动版本为 Node 26 文档；本地 Node 24 的已有 cache API 由实际 import probe 验证。
来源：https://nodejs.org/api/module.html#module-compile-cache

Vite 官方 Performance 指南指出，barrel 会使不需要的依赖参与加载与转换。当前主会话键是纯函数，已有 config/sessions/main-session.ts 为原始所有者，所以直接导入该文件。指南还建议使用 profile 定位插件及解析开销；构建已有并行及限并发哈希优化，本轮未从波动的总时间推断新的构建改法。
来源：https://vite.dev/guide/performance
构建 profile 的上游实现：https://github.com/vitejs/vite/pull/10719

## 本地诊断和实施

- 编译产物 server.impl 静态依赖：416 个模块。沿 health-state 访问健康摘要时带入 session migration、provider health 等执行依赖，读取更新提示又带入 update-startup。
- buildGatewaySnapshot 是同步握手元数据接口。保留同步缓存读取；refreshGatewayHealthSnapshot 在原有异步刷新入口内加载 getHealthSnapshot。公共/敏感 pending promise、错误 finally、广播和版本更新仍由原函数管理。
- 更新缓存、比较及通知函数整体移至 update-available-state。update-startup 继续使用并导出同一状态。避免在两个模块各建缓存。
- server.impl 与 health-state 直接使用原 main-session 键解析器；health-state 直接使用原 agent-scope-config 默认 agent 解析器。
- 生产构建后静态模块数 380，减少 36 个。热缓存三次独立导入：修改前 4138.27/2110.87/2558.83 ms，修改后 1221.17/1179.06/1132.01 ms；中位数 2558.83 → 1179.06 ms。机器运行负载波动显著，真实恢复数据单独记录。

## 保持的边界

没有改变 readiness、认证、配置校验、重连退避、恢复重试、性能阈值或插件 owner。完整健康刷新仍调用原探测逻辑，升级通知仍只对变化的值发事件。所有机器回执标注 agent 驱动。
