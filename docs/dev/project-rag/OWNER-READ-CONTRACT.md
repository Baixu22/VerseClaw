# Owner 读取合同

Wiki 的公开读取接口返回 `OwnerReadSnapshot/v1`。`SourceRef/v2` 记录 owner、namespace、正文版本、完整原始 UTF-8 digest、policy epoch 和实际读取范围；`ReadAdmissionContext/v1` 描述从可信 session/workspace 事实派生的本次读取约束。

`sourceDigest` 覆盖完整原始文件，包括 frontmatter、BOM 和 CRLF。`contentDigest` 覆盖实际返回的正文片段。locator 的字节从 0 计数，结束位置不包含在范围内；原始行从 1 计数并包含 frontmatter。旧接口的 `fromLine` 使用正文行，按实际 locator 映射，携带范围 pin 重开时保留同一段字节。

读取执行 owner 的 status、trust、privacy/sensitivity、ACL、scope 和 retention。缺失政策采用 Wiki owner 的既有默认值；显式非法值拒绝读取。权限检查先于范围解析，拒绝结果不包含 owner 正文。读取结束前再次核对版本和政策；旧 pin 的版本、完整 digest、policy epoch 或范围改变时明确失效。

SourceSet 的候选正文、digest、身份、政策和 raw locator 必须与 owner snapshot 一致。合格集合为空时跳过 embedding；使用前的 owner 复查可以移除候选，失效的显式 pin 同时进入缺失记录。其余有效来源保留，回答状态为 partial。

公开实现入口：`openclaw_runtime/extensions/memory-wiki/runtime-api.ts`；通用数据合同与校验：`openclaw_runtime/src/runtime-core/knowledge-owner-read.ts`；共享 Host 类型：`shared/knowledge/owner-read-contract.ts`。固定回归入口为 `tests/unit/project-rag-owner-read.test.ts`。Host/Gateway/模型消费者的完整接线由 RAG-01 的验收覆盖，记录在对应候选证据中。
