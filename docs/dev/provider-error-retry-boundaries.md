# Provider 错误与重试边界（2026-10-09）

- 关联问题：GitHub #117（错误原文外泄）与 #119（Retry-After 被截短）。
- driven_by: agent；actor: codex-provider-boundaries。
- 原则：复用现有 redaction、500 字符预览和 retry runner，不新增服务、配置或依赖。

## 运行时行为

1. `resolveOpenAiCompatError` 在最终公共边界清洗 message 和 code；Chat Completions 与 Responses 的 JSON/SSE 共用该转换器。
2. `redactProviderErrorBody` 强制保留内建敏感模式，日志设置为 off 或自定义模式不能关闭公共错误保护；启用的自定义模式仍保留。清洗发生在截断之前。
3. 对应 handler 的失败日志使用同一有界清洗器；原 Error 不被修改，内部诊断分类和可读 request_id 保留。500 字符预算针对预览，不包括日志固定前缀。
4. 合法 Retry-After 是有限、非负的等待下界；分数毫秒向上取整。超过现有 maxDelayMs 或平台 timer 上限时，在 sleep/onRetry/再次调用之前停止，并保留原错误及重试信息。
5. 可满足的 hint 使用正向 jitter；等于上限时可以落在上限，绝不能提前。非法 hint 使用正常指数退避；timer 溢出也不能使 Node 提前触发。
6. channel 默认仍为 3 次、400ms 最小延迟、30 秒上限和 0.1 jitter。`retry_after=120` 在该默认预算下停止；strictShouldRetry 不被限流信息绕过。

这落实错误治理 DEC-04 的等待预算语义及 DEC-05/06/11 的公共错误边界；当前检出不存在单独的 reliability-boundaries 规则，因此规则落在 `harness/specs/rules/provider-error-retry-boundaries.md`，不伪造已存在的规范文件。

## 可重复验证

```sh
pnpm exec vitest run tests/unit/provider-error-retry-boundaries.test.ts tests/unit/provider-error-http-boundaries.test.ts --maxWorkers=1
pnpm harness validate --spec harness/specs/tasks/provider-error-retry-boundaries.md
pnpm run comms:replay
pnpm run comms:compare
```

原始报告位于本地 `artifacts/provider-error-retry-boundaries/`；命令、退出码和耗时见 `checks.json`，最终汇总与源码摘要见 `report.json`。

| 开发验证 | 磁盘证据及结果 |
| --- | --- |
| 回归 | `tests.json`：48/48 通过，0 跳过；32 条边界/计时回归，16 条 loopback JSON/SSE 回归 |
| 源码类型 | `typecheck.log` + `checks.json`：runtime 原始配置派生的五文件 tsgo 探针 exit 0；含传递依赖，不冒充全仓类型检查 |
| 格式/lint | 五个 runtime 文件 oxfmt/oxlint、两个测试 ESLint 均 exit 0 |
| Harness | diff-aware validate/dry-run 为 PASS WITH RESIDUAL；14 个既有/并行文件明确排除所有权，未跳过 diff 检查 |
| 通信 | replay/compare 均 exit 0；读取并保留 metrics 和 compare report |
| 差异 | 本批作用域 diff-check exit 0；全工作区 exit 2 来自未触碰的 `electron/main/index.ts` 五处行尾 |

Harness dry-run 的六个实际执行步骤是 skipped，不代表 full fast/typecheck/build/Electron 已运行。上述为本地开发验证；工作区仍 dirty，新增文件尚未提交，不满足干净候选和正式收口要求。TF-0304 保留 review_needed，GitHub issues 未关闭。


HTTP 验证运行真实 loopback 服务、请求解析、错误 handler 与 JSON/SSE 序列化；模型执行和 Gateway 身份/所有权配置由 fixture 代替。不代表真实上游、认证集成、桌面、安装包、跨平台或全系统验收。没有收费请求，没有真人数据。

## 保留边界

- #116 的其余 FailoverReason 映射及未知 Chat SSE 的 stop/零用量语义未在本批修改；#118 的 Host 错误透传同样不在范围内。
- P0 #62 仍缺失 29 个 Git 对象；三个缺失提交的非破坏性远端 fetch 均返回 not our ref（exit 128）。未删除 rescue 分支，未 gc/prune/reset，也未改变分支指向。该问题未解决，不声称收口。
- 未发布、未修改产品锁或默认开关；原工作区的其他未提交改动保留。
