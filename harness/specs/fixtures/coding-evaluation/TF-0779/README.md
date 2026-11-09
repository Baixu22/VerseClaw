# TF-0779 joint encoding evaluation

This fixture binds two independent Python workspaces through three arms: Git worktree plus native full tests, VG/JJ full, and VG/JJ with STS selected followed by an independent final full. Each workspace runs three times. The evaluator also retains six Git worktree/full lanes, targeted ClawX conflict and mutation tests, and six VG/JJ recovery suites.

All evidence is agent-driven. The runner is scripted and never calls a language-model provider, so token usage is explicitly not applicable and no live-model quality claim is made.

The report records source/tool hashes, workspace content manifests, managed tree identities, command output hashes, wall/CPU/peak RSS costs, planted-failure rejection, selected/final-full scope, conflict/recovery results, and cleanup. The independent verifier accepted the report and rejected all seven structural or digest tamper cases.

No product default, product lock, release, GA, or net-benefit claim is changed by this fixture.
