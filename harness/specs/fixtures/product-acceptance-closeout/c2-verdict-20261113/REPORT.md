# Windows 产品验收执行记录（2026-11-13）

driven_by: agent；actor: codex/windows-inline-closeout；realHumanEvidence: false。

## 当前判定

本轮没有完成功能、打包或独立验收闭环。`functionalReadiness=needs-fix`，`distributionReadiness=not-proven`，发布、GA、liveReady 与默认开启均未改变。

## 实际执行

- 候选 `2150b71b8` 完成了 Vite 与 Runtime 构建，矩阵收集 33 文件、86 例。
- Playwright 结果为 85 unexpected、1 skipped 和 1 个测试外错误；不能把进度行当作业务通过。
- 失败分类：67 次首窗超时、14 次运行中 dirty 拒绝、1 次测试超时，另有清理/启动错误。原报告和逐例 JSON 原样保存。
- 长批次运行期间 spec 与 verifier 的开发修改触发 source mutation guard。后续采用 `811bdab40` 的不可变 detached 检出，两个 Channels 探针仍在 electron.launch 超时。
- 编码候选 `6c58b168e` 的正式执行器为 NO_GO；由于失败没有启动 Verifier。60 个原始报告/日志保存在 D:/tmp/windows-inline-closeout-20261112/coding-final-6c58-clean-env/。
- VerseShell 正式重建在 parking_lot_core build script 遇到 os error 5。最小 Rust 探针通过不能替代这次正式重建。
- 类型失败包含 VerseBrowser 包类型产物缺失；根全量单测超时且有失败。release 基线缺固定历史 ref；Agent Dev 证据过期；shrinkwrap 因网络 ECONNRESET 失败。

## 已完成的局部验证

- 产品定向单测 76/76、Runtime 记忆 32/32、Doctor 4/4、产品合同 56/56。
- 测试/node/web 三套串行类型检查、contract、i18n、通信 replay/compare、docs policy 10/10 通过。
- 编码候选的 Runtime 720+1004 单测、integration 32、Vite/Runtime build 与 smoke 通过。
- 编码验收器的 WP6/验收定向 85 项与新增身份 17 项通过。spec 归属遗漏在后续 `2bfe53243` 修复，但没有据此重写 `6c58b168e` 的门禁结果。

## 后续执行条件

1. 解决或稳定隔离 Electron 启动握手，重新执行不可变候选的 86 例。
2. 在干净验收检出中生成 VerseBrowser 类型产物，并修复根全量单测/超时。
3. 解决 VerseShell build script 的执行权限，重新生成当前候选 win-unpacked 三 profile。
4. 提供 release 基线的固定历史输入，刷新 Agent Dev 当前证据，并在稳定网络/缓存下完成 shrinkwrap 检查。
5. 同一干净候选重新执行独立 Executor/Verifier；当前没有 package 或独立验收通过证据。

`summary.json` 和 `SHA256SUMS` 给出机器可读计数与文件绑定。原始失败、旧报告和已有任务状态不被改写为通过。
