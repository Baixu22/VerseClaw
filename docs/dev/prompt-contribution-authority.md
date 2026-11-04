# Prompt contribution authority (TF-0737)

Plugin declarations belong to registration metadata. `api.on` copies the declaration
and freezes its authority/scope arrays, so later mutation of plugin-owned input cannot
upgrade the grant. `source` equals `api.id`; `reason` is nonempty; scope names exact
result fields. Declarations returned inside hook results are ignored.

```ts
api.on("before_prompt_build", () => ({ appendSystemContext: "Plugin guidance" }), {
  promptContribution: {
    source: api.id,
    authority: ["append_instruction"],
    scope: ["appendSystemContext"],
    reason: "Supply the plugin's static system guidance",
  },
});
```

| Hook field | Required authority |
|---|---|
| systemPrompt, including an empty string | replace_system_prompt |
| prependContext, appendContext | append_data |
| prependSystemContext, appendSystemContext | append_instruction |

The same checks govern `before_prompt_build` and legacy `before_agent_start` prompt
fields. Each hook is checked before priority results merge; one producer's declaration
cannot authorize another. Model/provider override fields retain their existing behavior.

`createHookRunner(registry, { promptAuthorityMode: "enforce" })` admits undeclared data
appends only. Other mutations require matching source, scope and authority. Failure
throws `PromptContributionAuthorityError`, with code, source, scope, requiredAuthority
and reason. The runner's normal catchErrors/fail-open behavior cannot swallow a deny,
return partially merged prompts or silently turn a replacement into an append.

Existing hosts retain warn mode: missing/mismatched grants are reported and existing
results continue. This task supplies and tests enforcement; it does not switch every
production host into enforce mode, introduce a persistent configuration default, or
graduate product flags. Appended data is not semantically classified. A malicious
in-process plugin is outside this contract. The Context Orchestrator has an equivalent
admitting-host boundary described in `context-orchestrator.md`; native assembly,
post-orchestrator accounting and seal coverage remain separate gates.

Reproduce the behavioral checks with
`pnpm exec vitest run tests/unit/semantic-convergence-prompt-authority.test.ts --maxWorkers=1`.
All fixtures are agent driven; no provider credentials or real-human evidence are used.
