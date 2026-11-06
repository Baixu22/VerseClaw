**IPC 接入门禁修复验收 · 2026-11-05**

TF-0787 的限定验收通过；TF-0786/TF-0628 继续推进。执行均由 agent 驱动，无真人、独立多人或整体 GA 声明。

候选 11adcfbdb1892618332babe6a52dd91b069a642c，tree 626b11cd105375eb416b556466a6ae7e7cfd2feb；十项门禁运行前后均为干净候选。

72/72 项测试通过，38 项真实 CLI 负例拒绝，0 failed / 0 skipped。完整 node/web/test 类型、契约、scoped lint、产物保留、引用、Harness context/validate/dry-run 与提交 diff 检查全部 exit 0。

- typecheck-ready: exit 0，46.04s
- unit: exit 0，108.68s
- contract: exit 0，5.09s
- lint: exit 0，7.36s
- artifacts: exit 0，8.78s
- evidence: exit 0，0.74s
- diff-check: exit 0，0.72s
- harness-context: exit 0，2.26s
- harness-validate: exit 0，14.23s
- harness-dry-run: exit 0，3.05s

原扫描漏掉计算属性和空白；模板预扫描盲区也已补反例修复。旧 acfb26319 的绿灯未升级为最终通过。八份已有 RSI 日志只修 ignore/requiredInputs 声明，日志和旧 verdict 未改。

运行时源码、Host API、权限与默认值零 diff。依赖明确复用，VerseBrowser 从本树源码构建。未验证 fresh install、全量单测、Electron E2E、完整构建、runtime 全局门禁或 live-provider 收益。

后续为小依赖环、runtime 反向依赖、陈旧权威描述和关系约束复验。本报告不代表整体架构成熟；静态局部别名覆盖不等于全程序数据流或反射覆盖。

详细事实见 report.json、gates.json、unit.json、typecheck.json、boundaries.json 和前后反例 JSON。SHA256SUMS 覆盖全部保留文件，credential-scan.json 记录扫描。
