# C02：语义状态与来源保真

源码候选 `205be98dc2d6b6c56a488d7a6e20ad763d098d47`，树 `03bb460cdd5ef8471a7eecec05782d83cbfd125a`。独立检出从受管源码构建，复用已安装依赖。

CompressionArtifact、Main聊天和会话预览、continuity与后续压缩输入保留原状态、否定极性、scope、逐项引用和替代/冲突关系。派生旧字段携带语义来源ID；归档补引用后仍保持同一来源。未知或不适用范围不进入活跃视图；来源失联有诊断，关键目标/约束缺口阻止续行。Working Context接受状态保持owner语义。

干净候选106/106定向测试通过（含退役Memory flags）；实际三轮归档写入、校验、恢复、Main RPC和脚本续行通过。桌面与Runtime构建、严格定向类型、接口契约、Harness validate/dry-run、通信回放和比较通过。真实Electron+Gateway连续上下文旅程1/1通过；无重试，源码与提交身份不变。星驰ccs-ai/gpt-6.1-sol的autoreview r17通过，无可操作发现。

初次干净复验缺少本地包dist，补仓库构建后通过；第一次Electron使用源码tsx入口启动失败，同候选Runtime构建并通过启动smoke后，新跑次通过。原始失败、日志、trace和资源回执保留，路径和摘要见validation.json。脚本消费者记录为agent驱动，模型质量收益留给C13的冻结配对评测。

独立子代理 c02-frozen-verifier 已逐项复算并验收 accepted；记录见 independent-verdict.json。
