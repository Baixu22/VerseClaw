# An agent denial stops the requested command effect

Agent-driven source-host fixture. Scripted replies prove control flow and tool semantics; they do not measure model quality.

The separate observer uses the QA runner's existing admin authority to receive
requests bound to its ephemeral RPC connection. The delivery-route guard stays active.

```yaml qa-scenario
id: personal-approval-denial-stop
title: An agent denial stops the requested command effect
surface: Gateway approval + exec policy
objective: Resolve a real two-phase Gateway approval as deny, exercise a denied
  exec turn and verify the requested file was never created.
gatewayConfigPatch:
  tools:
    exec:
      host: gateway
      security: deny
      ask: off
risk: medium
successCriteria:
  - The real Gateway final response matches deterministic effect readback.
  - A failure, denial or missing artifact cannot be counted as success.
execution:
  kind: flow
```

```yaml qa-flow
steps:
  - name: Record an agent denial and reject the command
    actions:
      - call: fs.writeFile
        args:
          - expr: path.join(env.gateway.workspaceDir, "personal-denied-command.cjs")
          - expr: >-
              "require('node:fs').writeFileSync(" +
              JSON.stringify(path.join(env.gateway.workspaceDir, 'personal-denied-effect.txt')) +
              ", 'FORBIDDEN');\n"
          - utf8
      - call: createSession
        args:
          - ref: env
          - expr: scenario.id
        saveAs: session
      - set: approvalId
        value:
          expr: "'qa-personal-denial-' + randomUUID()"
      - set: approvalApi
        value:
          expr: await qaImport((await qaImport('node:url')).pathToFileURL(path.join(env.repoRoot, 'dist/plugin-sdk/gateway-runtime.js')).href)
      - set: approval
        value:
          expr: >-
            await (async () => {
              let resolveReady, rejectReady;
              const ready = new Promise((resolve,reject) => {resolveReady=resolve;rejectReady=reject;});
              const approvalEvents = [];
              const observer = new approvalApi.GatewayClient({
                url: env.gateway.wsUrl, token: env.gateway.token,
                clientName: 'gateway-client', mode: 'backend',
                scopes: ['operator.admin'], deviceIdentity: null,
                onHelloOk: () => resolveReady(), onConnectError: rejectReady,
                onEvent: event => {
                  if (event.event === 'exec.approval.requested' || event.event === 'exec.approval.resolved') approvalEvents.push(event);
                }
              });
              try {
                observer.start();
                await ready;
                const requested = await env.gateway.call('exec.approval.request', {
                  id: approvalId, command: 'node personal-denied-command.cjs',
                  cwd: env.gateway.workspaceDir, host: 'gateway', security: 'allowlist',
                  ask: 'always', agentId: 'qa', sessionKey: session,
                  timeoutMs: 10000, twoPhase: true
                }, {expectFinal: false, timeoutMs: 15000});
                if (requested.status !== 'accepted') throw new Error('Approval request was not accepted');
                const resolved = await env.gateway.call('exec.approval.resolve', {id: approvalId, decision: 'deny'});
                const decision = await env.gateway.call('exec.approval.waitDecision', {id: approvalId});
                if (!approvalEvents.some(event => event.event === 'exec.approval.requested' && event.payload.id === approvalId)) throw new Error('Approval event was not delivered');
                return {requested,resolved,decision,approvalEvents};
              } finally {
                await observer.stopAndWait();
              }
            })()
      - assert:
          expr: approval.decision.decision === 'deny'
          message: The Gateway must retain the actual agent denial
      - call: runAgentPrompt
        args:
          - ref: env
          - sessionKey:
              ref: session
            message: Personal approval denial check. Attempt the requested local command and report its denied outcome.
            timeoutMs: 60000
        saveAs: turn
      - call: waitForOutboundMessage
        args:
          - ref: state
          - lambda:
              params:
                - message
              expr: message.text.includes("PERSONAL-APPROVAL-DENIED-OK")
          - 60000
        saveAs: reply
      - call: readSessionTranscriptSummary
        args:
          - ref: env
          - ref: session
        saveAs: transcript
      - assert:
          expr: transcript.finalText.includes("PERSONAL-APPROVAL-DENIED-OK")
          message: The Gateway transcript must contain the final response
      - assert:
          expr: "!transcript.hasDirectReplySelfMessage"
          message: The final reply must not be duplicated by a self-send
      - set: deniedEffectExists
        value:
          expr: await fs.access(path.join(env.gateway.workspaceDir, 'personal-denied-effect.txt')).then(() => true, () => false)
      - assert:
          expr: "!deniedEffectExists"
          message: A denied command must not create its file
      - set: effect
        value:
          expr: ({approvalId,...approval,deniedEffectExists,denialMechanism:"agent Gateway decision with approval observer plus deny exec policy"})
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
