# RAG-17～19 开发记录

源码提交：`6fddc5c7b01afcbdd1d9257dd1c45aee535bb911`，tree `6c0b088b7d799f29ad7fb1f86591bd06435a711c`。

检索诊断与owner策略晋级、独立交付校验器、冻结查询/任务执行器和72小时读回工具已实现。根目录142项和owner评测2项共144项定向回归通过；四项定向类型及八项静态检查通过。原始通过/失败回执和输入摘要保留在本目录的JSON中，所有记录均为agent驱动。

Harness CI第10阶段的Agent Dev审计因四份证据已42小时而拒绝；后续两个轻量检查单独通过。WorkBuddy R2反馈已处置，R3返回占位内容且置信度0.01，最终独立复核待补齐。所有者已暂缓完整验收；节点保留Electron、五平台、240查询、540任务、72小时及工程双角色的实际待办。

重放根回归时，从`root-unit.json`的`testResults[].name`取10个测试文件，运行`pnpm exec vitest run <files> --maxWorkers=1 --cache=false`。owner用`pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs extensions/memory-wiki/retrieval-policy-evaluation.test.ts --maxWorkers=1 --cache=false`。`checks-readback.json`保存实际argv、退出码、日志内容和四份实际类型配置；其他检出重放时将工作树路径换成本检出，并把配置写到D盘临时目录。类型工具沿用已安装的native-preview，未执行新依赖安装。

操作参数与证据布局见[离线驱动](../../../../../docs/dev/project-rag/OFFLINE-DRIVERS.md)。
