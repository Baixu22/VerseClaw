# Agency Role Memory Import Design

Agency role packages may propose governed Role Memory only after the exact
package review is active and completely materialized. The package source is
parsed with a Markdown AST. Recognized rules, procedures, risks, and handoffs
become preview candidates; identity, personality, tools, commands, code,
mission, templates, and unknown sections remain handbook material.

Every candidate is role-scoped, system-sourced, long-term, normal sensitivity,
and confidence `0.6`, which forces the existing gatekeeper review path. The
feature never writes memory directly. Operators preview and submit candidates
through the existing `memory.previewProposal` and `memory.propose` APIs.
Duplicate and conflict handling remains owned by Role Memory.

Role packages remain usable while Role Memory is disabled. In that state the
import controls are disabled and no proposal generation or submission occurs.

