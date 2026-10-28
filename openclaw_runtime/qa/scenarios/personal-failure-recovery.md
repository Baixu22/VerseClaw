# A failed local operation is followed by a successful task

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

```yaml qa-scenario
id: personal-failure-recovery
title: A failed local operation is followed by a successful task
surface: failure + continuation
objective: Observe a real missing-file operation failure, report the external
  retry boundary, then complete a fresh local task.
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Observe a bounded failure and finish a new local task
    actions:
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
            message: "Tool progress error QA check. Read `absent-external-calendar.json`. Reply exactly: PERSONAL-EXPECTED-TOOL-FAILURE"
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes("PERSONAL-EXPECTED-TOOL-FAILURE")
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: transcript.finalText.includes("PERSONAL-EXPECTED-TOOL-FAILURE")
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - set: failedTurn
        value:
          expr: ({sessionKey:session,runId:turn.started.runId,finalText:transcript.finalText})
      - call: fetchJson
        args:
          - expr: env.mock.baseUrl.replace(/\/v1\/?$/, '') + '/debug/requests'
        saveAs: failureEvents
      - set: missingOperation
        value:
          expr: failureEvents.find(request => request.allInputText.includes('absent-external-calendar.json') && (request.toolOutputStructuredError || /ENOENT|no such file|not found/i.test(request.toolOutput)))
      - assert:
          expr: Boolean(missingOperation)
          message: The actual Gateway tool result must contain a missing-file failure
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "FAILURE_RECOVERY_REQUEST.md")
          - |
            # Failure recovery request
            An external calendar update is not authorized. Capture the local failure and continue with a local proof task.
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "FAILURE_RECOVERY_EVIDENCE.md")
          - |
            # Failure recovery evidence
            Observed local failure: Gateway read tool reported the missing calendar file.
            External calendar update was not attempted.
          - utf8
      - call: createSession
        args:
          - ref: env
          - expr: scenario.id + '-continued'
        saveAs: session
      - call: runAgentPrompt
        args:
          - ref: env
          - sessionKey:
              ref: session
            message: Personal failure recovery check. Read the failure evidence and complete the permitted local recovery task.
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes("PERSONAL-FAILURE-RECOVERY-OK")
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: transcript.finalText.includes("PERSONAL-FAILURE-RECOVERY-OK")
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - call: fs.readFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "personal-failure-recovery.txt")
          - utf8
        saveAs: artifact
      - assert:
          expr: "artifact.includes('Failed step: external calendar update was not attempted') && artifact.includes('Retry boundary: do not retry')"
          message: A recovery report must preserve the failed external boundary
      - set: effect
        value:
          expr: ({failedTurn,toolFailure:missingOperation.toolOutput,newRunId:turn.started.runId,artifact})
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
