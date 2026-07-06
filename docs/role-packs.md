# Role Packs

> Domain role bundles for OpenClaw — packaged as config examples, not new built-ins. Area 3 §3.5 of the role-driven architecture refinement.

## What is a Role Pack?

A **Role Pack** is a documented YAML bundle containing `roles:[...]` and `teams:[...]` entries that a user pastes or merges into their OpenClaw config (`config.openclaw.json` under `agents.roles` and `agents.teams`). Packs are **examples**, not new built-ins — they exercise the existing config-defined role path (`role-registry.ts`) and keep `BUILT_IN_ROLE_CONTRACTS` a stable software-dev core.

## Why packs instead of new built-ins?

- **Stable core**: built-in roles are a dev-focused set (planner, architect, implementer, tester, reviewer, security-reviewer, docs-writer, skeptic). Domain packs (writing, research) don't belong in every registry consumer.
- **User-extensible**: users can remove or edit pack roles without forking. Built-ins can't be removed.
- **Exercises existing validation**: `validateRoleContract` + `normalizeTeamTemplate` already reject malformed entries with issues. The pack doc points at `roles.list` `issues` output for debugging.

## Pack shape

```yaml
# A role pack is a YAML document with two top-level arrays:
roles:
  - name: outliner           # kebab-case, starts with a letter
    display_name: Outliner
    role_prompt: |
      Structure the work into a section-by-section outline.
    tools: ["bash", "read_file"]
    permissions:
      filesystem: read
      network: none
    effort: medium
    output_schema:
      format: markdown
      sections: ["Outline", "Open questions"]
    routing_keywords: ["outline", "structure", "plan"]   # Area 3 §3.5
    tags: ["writing"]

teams:
  - id: writing-team
    mode: lead-workers
    default_lead_role: outliner
    roles:
      - role_name: outliner
      - role_name: drafter
      - role_name: line-editor
      - role_name: fact-checker
    verifier_role: fact-checker
```

## How to install a pack

1. Copy the pack's `roles:` entries into your `config.openclaw.json` under `agents.roles`.
2. Copy the pack's `teams:` entries under `agents.teams`.
3. Restart the gateway (or reload config).
4. Verify with `gateway.rpc('roles.list')` — the response includes pack roles with `origin: 'config'` (Area 1 badge).
5. If any role has validation issues, the `issues` array on the role entry explains what to fix.

## Routing keywords (Area 3 §3.5)

Pack roles declare `routing_keywords` to make themselves routable on equal footing with built-in roles. `scoreRole` reads these with the same +2 weight as `ROLE_KEYWORDS`. Users write keywords in their own language — there is no EN-only limitation for pack roles.

Example: a `data-scientist` pack role with `routing_keywords: ["data", "model", "建模"]` routes on "train a model on the customer dataset" and "对用户行为数据进行建模" alike.

## Available example packs

| Pack | File | Roles | Use case |
|------|------|-------|----------|
| Writing | `writing-pack.example.yaml` | outliner, drafter, line-editor, fact-checker | Long-form writing workflows with verification |
| Research | `research-pack.example.yaml` | searcher, synthesizer, critic | Research workflows with adversarial review |

These are **starting points**, not canonical. Edit them to fit your domain.

## Relationship to Area 3 features

- **Routing memo store (§3.1)**: pack roles participate in memo recall/record like any role. A pack role that successfully leads a similar task gets a bounded +2 memo boost.
- **Synthesis contract (§3.2)**: pack roles with `output_schema.sections` contribute structured sections to the Lead's synthesis prompt.
- **Handoff artifacts (§3.4)**: pack roles connected by `handoff` edges receive predecessor output sections in their spawn prompt (when the pilot is enabled).
- **Trusted orchestration presets (§3.3)**: pack role teams can be pre-approved per workspace to reduce approval friction for daily-run combinations.

## Boundary notes

- Pack roles follow the same `spawnRoleSubagent` hard allowlist/deny as built-ins. No tools or permissions are granted by declaring a pack — the role contract's `permissions` and `tools` fields are enforced at spawn time.
- Pack roles are not added to `BUILT_IN_ROLE_CONTRACTS`. Code that falls back to `BUILT_IN_ROLE_CONTRACTS` when no config roles are provided will not see pack roles — always pass `request.roles` from `listRoleContracts(cfg)`.
