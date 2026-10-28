# A fresh task reads a recorded workspace preference

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

```yaml qa-scenario
id: personal-memory-preference-recall
title: A fresh task reads a recorded workspace preference
surface: workspace preference readback
objective: Recall an agent-seeded persistent preference through the real read
  tool in a fresh session; use no retired memory flags.
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Read a recorded preference rather than guess it
    actions:
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "PREFERENCES.md")
          - |
            # Recorded user preferences
            For QA movie night, the user prefers lemon pepper wings with blue cheese.
          - utf8
      - call: createSession
        args:
          - ref: env
          - expr: scenario.id
        saveAs: session
      - call: runAgentPrompt
        args:
          - ref: env
          - sessionKey:
              ref: session
            message: Personal preference recall check. Consult the recorded preference and report it.
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes("PERSONAL-PREFERENCE-RECALL-OK")
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: transcript.finalText.includes("PERSONAL-PREFERENCE-RECALL-OK")
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - assert:
          expr: transcript.finalText.includes('lemon pepper wings with blue cheese')
          message: The final preference must match the recorded file
      - call: fs.readFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "PREFERENCES.md")
          - utf8
        saveAs: preference
      - set: effect
        value:
          ref: preference
  - name: Retain observed final state and raw local events
    actions:
      - set: proof
        value:
          expr: ({schema:'QaScenarioFinalState/v1',driven_by:'agent',actor:'codex-tf0578-qa-pack',scenarioId:scenario.id,sessionKey:session,runId:turn.started.runId,waitStatus:turn.waited.status,finalText:transcript.finalText,effect,workspaceDir:env.gateway.workspaceDir,tempRoot:env.gateway.tempRoot})
      - call: fetchJson
        args:
          - expr: env.mock.baseUrl.replace(/\/v1\/?$/, '') + '/debug/requests'
        saveAs: providerEvents
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, scenario.id + '.events.json')
          - expr: JSON.stringify({driven_by:'agent',actor:'codex-tf0578-qa-pack',bus:state.getSnapshot(),provider:providerEvents},null,2) + '\n'
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, scenario.id + '.proof.json')
          - expr: JSON.stringify(proof,null,2) + '\n'
          - utf8
    detailsExpr: JSON.stringify(proof)
```
