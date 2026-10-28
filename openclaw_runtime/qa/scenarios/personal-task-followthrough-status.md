# Task status separates a local result from publishing

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

```yaml qa-scenario
id: personal-task-followthrough-status
title: Task status separates a local result from publishing
surface: task status artifact
objective: Create a local status file from recorded task evidence and keep
  publication blocked.
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Read the task ledger and verify its status artifact
    actions:
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "PERSONAL_TASK_LEDGER.md")
          - |
            # Personal task ledger
            Task: prepare a local OpenClaw PR readiness note.
            Publishing remains blocked pending explicit authorization.
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "FOLLOWTHROUGH_NOTE.md")
          - |
            Task: prepare a local OpenClaw PR readiness note.
            Done: local evidence captured in personal-task-status.txt.
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
            message: Personal task followthrough check. Report local completion and the publication boundary.
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: 'message.text.includes("Done: local evidence captured in personal-task-status.txt")'
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: 'transcript.finalText.includes("Done: local evidence captured in personal-task-status.txt")'
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - call: fs.readFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "personal-task-status.txt")
          - utf8
        saveAs: artifact
      - assert:
          expr: "artifact.includes('Blocked: publishing needs explicit user approval') && artifact.includes('Done: local evidence captured')"
          message: Local completion must not imply publication
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
