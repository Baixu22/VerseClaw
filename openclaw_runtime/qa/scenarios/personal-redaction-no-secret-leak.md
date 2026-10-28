# Private fixture values stay out of the reply

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

```yaml qa-scenario
id: personal-redaction-no-secret-leak
title: Private fixture values stay out of the reply
surface: share-safe diagnostics artifact
objective: Read agent-seeded diagnostic inputs, create a local share-safe
  summary and verify private fixture data is absent.
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Create and verify a redacted diagnostic artifact
    actions:
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "DIAGNOSTICS_REQUEST.md")
          - |
            # Personal diagnostics request
            Prepare a local share-safe summary. Public release authorization is absent.
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "PERSONAL_DIAGNOSTICS_RAW.md")
          - |
            # Raw personal diagnostics fixture
            Fake secret: fixture-private-canary-0578
            Raw chat text: fixture-private-chat-0578
            Account id: fixture-account-0578
            Message id: fixture-message-0578
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
            message: Personal share-safe diagnostics check. Read the local inputs and create the redacted artifact.
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes("PERSONAL-DIAGNOSTICS-SAFE-OK")
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: transcript.finalText.includes("PERSONAL-DIAGNOSTICS-SAFE-OK")
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - call: fs.readFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "personal-diagnostics-summary.txt")
          - utf8
        saveAs: artifact
      - assert:
          expr: "artifact.includes('Redaction confirmed: yes') && !/fixture-(?:private|account|message)/.test(artifact + transcript.finalText)"
          message: Raw private fixture values must not appear in the share-safe result
      - set: effect
        value:
          ref: artifact
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
