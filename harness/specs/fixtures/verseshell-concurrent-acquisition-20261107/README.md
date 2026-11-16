# VerseShell 并发获取与容量回收验收

本目录支持 TF-0828 的实现验收和后续回归，候选及命令在 report.json。
开发合同见 ../../tasks/verseshell-concurrent-acquisition-20261107.md。

- 329 个 focused case 通过，18 个既有 opt-in 二进制/平台 case 按原配置跳过，失败 0；逐项记录见 tests.json。
- 真实 Node 子进程实现 ACI 握手协议：3 个生命周期，每周期 16 个并发客户端，共创建 3 个子进程，退出后 owned PID=0。它验证宿主 manager，不执行 Rust payload。
- 改动源码和测试的依赖闭包类型检查通过。runtime 全量检查保留基点错误；基点 119 条、候选 118 条，无新增诊断。
- 三个关键回归在基点源码上按预期失败，保留于 negative-controls.json。
- 依赖通过 junction 复用已安装目录，未做全新依赖安装验收。原始日志与哈希的恢复位置见 raw-archive-index.json。

复跑：在干净候选执行 `node scripts/verify-verseshell-acquisition.mjs --output D:/tmp/verseshell-acquisition-recheck --baseline-types harness/specs/fixtures/verseshell-concurrent-acquisition-20261107/baseline-runtime-types.log`。
编译器和测试入口直接解析已安装包，不触发 pnpm 自动安装。

本目录作为精选最终证据跟踪；Task Forest 图、proposal 与会话交接保留在本地。
