# RAG-15 复验命令

在干净 Windows 检出切换到 report.json 的 candidate，将 TEMP/TMP 指向 D:/tmp。
各阶段实际 argv、cwd、退出码和耗时位于 gates/<phase>/receipt.json；复验时将原执行根路径替换为当前检出。

- unit：Vitest 执行 required-test-coverage.json 列出的新增测试及原任务/Host/目录回归，单 worker、禁用 cache。
- runtime-unit：按 agent-tools 与 context-views 的原 Vitest config 执行 context 工具、pack、impact 与 FactStore 回归。
- types：node scripts/typecheck-agent-dev.mjs --no-cache，覆盖 node/web/test。
- build：node scripts/build-openclaw-runtime.mjs；随后 pnpm run build:vite。
- electron：pnpm run test:e2e:run tests/e2e/project-rag-research.spec.ts --workers=1 --retries=0。
- control-e2e：pnpm run test:e2e:run tests/e2e/agent-dev-quality.spec.ts --workers=1 --retries=0。
- checks：contract、i18n、catalog、comms replay/compare，以及绑定 task spec 的 Harness validate 与 run --dry-run。
- lint/runtime-lint/format：使用对应阶段 receipt.json 固定的文件集与命令；format 为 --check。
- ci：node scripts/harness-ci.mjs。

依赖版本由候选 lockfile 绑定；本轮借用既有已安装依赖。Electron 使用隔离 fixture 与本地脚本 provider。
