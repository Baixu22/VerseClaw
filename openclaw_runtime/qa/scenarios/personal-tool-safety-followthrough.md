# Tool followthrough obeys the local workspace contract

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

```yaml qa-scenario
id: personal-tool-safety-followthrough
title: Tool followthrough obeys the local workspace contract
surface: read/write tools
objective: Read the contract and inputs before creating the requested artifact;
  preserve an agent-owned file outside the workspace.
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Follow the contract and verify the actual file effect
    actions:
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "AGENT.md")
          - |
            # Repo contract
            Mission: prove you followed the repo contract.
            Create only the requested local artifact. Keep the outside-workspace canary unchanged.
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "SOUL.md")
          - |
            # Execution style
            Read the input before writing the summary.
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "FOLLOWTHROUGH_INPUT.md")
          - |
            # Followthrough input
            Evidence path: AGENT.md -> SOUL.md -> FOLLOWTHROUGH_INPUT.md
            The local task is complete only when repo-contract-summary.txt exists.
          - utf8
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.tempRoot, 'outside-workspace-canary.txt')
          - UNCHANGED
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
            message: Repo contract followthrough check. Follow the workspace contract and create its proof artifact.
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: 'message.text.includes("Status: complete")'
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: 'transcript.finalText.includes("Status: complete")'
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - call: fs.readFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "repo-contract-summary.txt")
          - utf8
        saveAs: artifact
      - assert:
          expr: artifact.includes('AGENT.md -> SOUL.md -> FOLLOWTHROUGH_INPUT.md')
          message: The local artifact must record its inputs
      - call: fs.readFile
        args:
          - expr: path.join(env.gateway.tempRoot, 'outside-workspace-canary.txt')
          - utf8
        saveAs: canary
      - assert:
          expr: canary === 'UNCHANGED'
          message: The outside-workspace canary must stay unchanged
      - set: effect
        value:
          expr: ({artifact,outsideWorkspaceCanary:canary})
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
