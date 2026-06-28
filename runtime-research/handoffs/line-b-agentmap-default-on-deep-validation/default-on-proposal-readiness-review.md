# Default-On Proposal Readiness Review

Current recommendation: enter default-on proposal planning only. Default-on remains no, and default cutover remains no.

Proposal readiness can be recommended only if:

- corpus has at least 100 cases,
- focused tests pass,
- typecheck passes,
- harness context/validate pass or clean overlay proof is recorded,
- rollback drill is 100 percent,
- leakage count is 0,
- provider ordering drift is 0,
- default reviewer prompt byte drift is 0,
- fail-closed rate is 100 percent,
- candidate persistence is 0,
- new service/listener/database/server count is 0,
- renderer direct IPC/Gateway count is 0,
- scorecard is at least 95,
- no hard veto fires.

All criteria above passed or were covered by clean-overlay proof where the live dirty tree blocked normal harness validate. The allowed positive status is `ready_for_default_on_proposal`; it is not permission to enable default-on.
