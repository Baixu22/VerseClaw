# 按需知识交互

Chat 的知识模式决定何时读取，检索方案决定查询路径，来源范围决定可询问的 owner。默认组合仍为 scope=none、mode=suggest、profile=local，界面显示关闭。

| 模式 | 行为 |
| --- | --- |
| 关闭 | 不启动后台查询或自动附加；主动选择来源可重新启用 Wiki 范围。 |
| 手动 | 搜索并选择来源，按 owner、当前版本与原文范围读取。 |
| 建议 | 输入停顿 650 ms 后读取候选，Preflight 的附加动作确认本次来源。 |
| 自动读取 | 发送时按准入结果附加最多 3 个片段。 |

本地、质量、研究方案独立于模式；切换模式保留所选方案。手动指定来源走精确读取，方案的召回与重排设置用于按需查询。Host 和 Runtime 共同执行各方案的预算与可用性检查。

Preflight 显示当前来源版本、候选原文范围的 UTF-8 字节数、命中原因和冲突状态。查看来源重新经过 owner 检查，在只读窗口展示当前 pin 对应的原文；窗口内也可附加该来源。拒绝访问或版本失效时不展示正文。Dismiss 保留草稿，并在同一会话、workspace、范围、模式、方案和完整查询下抑制重复建议 10 分钟。

AutoReadAdmission/v1 要求当前 owner 权限和版本有效、状态 active、trust 为 confirmed 或 high-trust、verifiedAt 或 updatedAt 至少一项可解析、存在内容且没有未解决冲突。还须为唯一精确来源，或达到已验证校准的相关性准入条件。当前 owner 实现使用唯一精确来源分支；普通 lexical、dense、RRF 和未校准的重排分数不能触发自动读取。

前端最多等待自动读取 5 秒，建议、手动搜索和原文检查各 12 秒；Host 保留自己的查询期限。取消使这次可选读取立即结束。已经请求发送的 Auto-read 在取消、超时或不可用时继续普通发送；会话、workspace、范围、方案、查询或草稿附件发生变化时保留新草稿，结束旧发送准备。旧请求的晚到响应不重新打开 Preflight 或原文窗口。扩展 before-send 检查结束后也会核对草稿身份。

普通 Chat 在运行期间可通过 Enter 或排队按钮提交后续消息。消息进入现有普通发送队列，保留已选引用、附件和会话绑定；自动读取也在排队前经过同一准入与等待期限。活动长任务使用其已有 inputMode=queue 路径。

Used Knowledge 从本次运行的最终 RetainedEvidenceManifest/v1 读取片段、字符数及估算 token，显示实际保留的来源和未保留的已选来源数。token 使用收据声明的 utf8-bytes-div4 方法估算。ACK 绑定运行 ID 与准入引用，历史合并保留这份本地绑定。运行未结束时显示等待状态；终态收据发布存在短暂先后次序时有限重试，缺少收据时明确显示用量记录不可用。

自动回归入口为 `tests/unit/project-rag-chat-policy.test.tsx`、`tests/unit/chat-input.test.tsx`、`tests/unit/project-rag-plan-owner.test.ts` 和 `tests/e2e/project-rag-chat-modes.spec.ts`。Electron 使用真实本地 owner、源 Runtime、DCS 和脚本模型；延迟交付与 provider 超时在 Host 边界注入并记录为 agent 驱动模拟。
