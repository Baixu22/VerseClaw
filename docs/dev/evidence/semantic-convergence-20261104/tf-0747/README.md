# TF-0747 收益复算

10组发现有逐项verdict；decision.status=keep-retired，persist=false。权重保持，未测的impact/cost为空，0.65..1是记分卡上下界而非收益百分比。node scripts/semantic-convergence-benefit.mjs --verify复算报告，TF-0746/recompute.mjs复核原始行为证据。全部产物driven_by:agent。
