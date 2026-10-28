# Personal-agent QA scenarios

The pack IDs are owned by `extensions/qa-lab/src/scenario-packs.ts`. These are agent-driven, source-host, mock-provider fixtures.

```yaml qa-pack
version: 1
agent:
  identityMarkdown: >-
    # Local QA operator

    Perform only disposable local tasks. Record exact effects and failures;
    publication requires separate authorization.
kickoffTask: Run the canonical personal-agent pack with deterministic artifact
  assertions. All fixture input and approval decisions are agent-driven.
```
