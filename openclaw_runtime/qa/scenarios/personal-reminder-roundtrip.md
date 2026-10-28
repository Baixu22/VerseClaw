# A local reminder reaches its QA conversation

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

```yaml qa-scenario
id: personal-reminder-roundtrip
title: A local reminder reaches its QA conversation
surface: cron + qa-channel
objective: Create and force one disposable reminder, verify its real Gateway run
  and channel delivery, then remove it.
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Create a disposable reminder through Gateway
    actions:
      - call: createSession
        args:
          - ref: env
          - expr: scenario.id
        saveAs: session
      - set: afterTs
        value:
          expr: Date.now()
      - call: env.gateway.call
        args:
          - cron.add
          - agentId: qa
            name: TF-0578 local reminder
            enabled: true
            deleteAfterRun: false
            schedule:
              kind: at
              at:
                expr: new Date(Date.now() + 3600000).toISOString()
            sessionTarget: isolated
            payload:
              kind: agentTurn
              message: "Personal reminder marker. Reply exactly: PERSONAL-REMINDER-OK"
            delivery:
              mode: announce
              channel: qa-channel
              to: dm:qa-operator
        saveAs: job
      - assert:
          expr: typeof job.id === 'string' && job.id.length > 0
          message: Gateway must assign a real reminder ID
  - name: Execute the reminder and verify delivery
    actions:
      - call: env.gateway.call
        args:
          - cron.run
          - id:
              ref: job.id
            mode: force
          - timeoutMs: 60000
        saveAs: trigger
      - call: waitForCronRunCompletion
        args:
          - callGateway:
              lambda:
                params:
                  - method
                  - params
                  - options
                expr: env.gateway.call(method, params, options)
                async: true
            jobId:
              ref: job.id
            afterTs:
              ref: afterTs
            timeoutMs: 60000
            intervalMs: 200
        saveAs: cronRun
      - assert:
          expr: cronRun.status === 'ok' && cronRun.deliveryStatus === 'delivered'
          message: The reminder must finish and be delivered
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes('PERSONAL-REMINDER-OK')
          - 60000
        saveAs: reminderReply
      - call: runAgentPrompt
        args:
          - ref: env
          - sessionKey:
              ref: session
            message: "Local reminder verification marker. Reply exactly: PERSONAL-REMINDER-VERIFIED"
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes("PERSONAL-REMINDER-VERIFIED")
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: transcript.finalText.includes("PERSONAL-REMINDER-VERIFIED")
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - call: env.gateway.call
        args:
          - cron.remove
          - id:
              ref: job.id
        saveAs: removed
      - set: effect
        value:
          expr: ({jobId:job.id,cronRun,reminderReply:reminderReply.text,removed})
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
