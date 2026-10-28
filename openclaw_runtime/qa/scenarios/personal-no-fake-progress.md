# A completion claim has a real local proof file

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

```yaml qa-scenario
id: personal-no-fake-progress
title: A completion claim has a real local proof file
surface: completion honesty
objective: Verify the actual proof file and deny any claimed external publish,
  send, upload or merge.
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Create and verify a proof-backed local status
    actions:
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "PROGRESS_REQUEST.md")
          - |
            # Progress request
            Record local evidence only; no external publication or upload is authorized.
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "PROGRESS_EVIDENCE.md")
          - |
            # Progress evidence
            The local request was reviewed. No external effect occurred.
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
            message: Personal no-fake-progress check. Read both inputs and create the local proof artifact.
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes("PERSONAL-NO-FAKE-PROGRESS-OK")
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: transcript.finalText.includes("PERSONAL-NO-FAKE-PROGRESS-OK")
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - call: fs.readFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "personal-progress-proof.txt")
          - utf8
        saveAs: artifact
      - assert:
          expr: artifact.includes('not sent; not published; not uploaded; not merged') && transcript.finalText.includes('not sent, not published, not uploaded, not merged')
          message: Local progress must not be presented as an external effect
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
