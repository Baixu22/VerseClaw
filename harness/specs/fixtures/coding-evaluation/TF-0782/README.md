# TF-0782 编码能力成熟度与发布前结论

本目录聚合 TF-0764–TF-0781 的候选绑定证据，并保留当前 Windows win-unpacked 重验、两个角色的全量门报告和独立 verifier 结果。

功能、质量、性能、运营、分发和发布分别裁决：

- 功能与 A1-A10 修复以各叶 acceptance、SHA256SUMS 和候选谱系为准。
- 性能保留 STS selection 的 `improvement-unproven`，不把无收益结果写成收益门通过。
- 分发只声明 Windows `win-unpacked`；installer 保持 `not-run`。
- 默认保持 off 或显式 opt-in，GA、default-on、M4、land/admission authority 和发布批准不变。

正式文件由 `scripts/coding-evaluation/final_evaluation.py` 从叶证据、full-gate reports 和当前 package evidence 生成；`scripts/coding-evaluation/verify_final_evaluation.py` 在独立 worktree 中复算并运行篡改反例。