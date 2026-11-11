# TF-0770 journal terminal persistence

Agent-driven only. Candidate a4ab0635b0786c96788dd569f532d92a2fdacc0f.

41 host and 64 runtime tests; tracked-source projection tests; readonly/storage failure controls; real SQLite effect receipt readback; three child-process SIGKILL/restart windows. See acceptance.json for scope and limitations, gates.json for commands/exits/timing.

normal journal remains committed/applied. Failed terminal persistence returns recovery_required and effectApplied=true while disk and in-memory journal remain prepared; the receipt is unknown with a recovery reference. Repeating explicit undo after the first completed recovery makes no second file effect.

No package, power-loss atomicity, GA, live-model quality or release approval claim.
