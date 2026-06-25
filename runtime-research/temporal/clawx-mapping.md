# Temporal -> ClawX Mapping

Source Concept: workflow history replay  
ClawX Target: `Workflow Checkpoint Engine`  
Reuse Level: copy idea  
Dependencies: append-only task event log、deterministic state reducer、tool result store  
Risks: LLM 决策天然非确定；不能把 replay 设计成重新询问模型。  
First Implementation Slice: 为 Mission task loop 记录 `TaskEvent[]`，实现 reducer 从事件恢复状态。  
Tests Needed: replay completed/failed/waiting、缺失 tool result、重复 tool result、schema version marker。

Source Concept: RetryPolicy  
ClawX Target: tool/step retry semantics  
Reuse Level: adapt code  
Dependencies: retry scheduler、error taxonomy  
Risks: 对非幂等工具盲目重试会造成副作用。  
First Implementation Slice: 为 readonly 工具启用指数退避；写操作默认不自动重试，除非声明 idempotent。  
Tests Needed: retryable error、non-retryable error、max attempts、cancel during backoff。

Source Concept: continue-as-new  
ClawX Target: context/history compaction for long missions  
Reuse Level: rewrite  
Dependencies: context compressor、checkpoint serializer、parent/child run relation  
Risks: 压缩丢失 open obligations 会导致任务“看似完成”。  
First Implementation Slice: 当 event log 超阈值，生成 compressed checkpoint 并开启新 task run。  
Tests Needed: obligations 保留、evidence 保留、父子 run 查询、压缩后恢复。
