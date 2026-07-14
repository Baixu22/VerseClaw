---
name: agent-reach-login-handoff
description: Use when a Reach reader returns status browser_login_required and the user must complete an authenticated Twitter or Xiaohongshu browser session before retrying.
user-invocable: false
---

# Agent Reach Login Handoff

Use the existing `agent_browser` session returned by a Reach reader. Never
request, inspect, repeat, or return cookies, tokens, authorization headers, or
other credential values.

## Login Loop

1. Confirm the result has `status: "browser_login_required"`, plus `profile`,
   `sessionId`, `loginUrl`, and `retryTool`.
2. Continue with `agent_browser` using exactly the returned `profile` and
   `sessionId`. Do not open a replacement profile or headless session.
3. Let the user complete passwords, CAPTCHA, 2FA, consent, or other manual
   authentication in the visible session.
4. Check only visible page state to determine whether login completed. Do not
   run the `cookies` command or expose browser storage.
5. Invoke the tool named by `retryTool.name` once with the unchanged
   `retryTool.arguments`.
6. If the retry again requires login, keep the same session and report the
   visible blocker instead of looping or switching profiles.

## Result Handling

- Return the retried Reach reader result, not browser internals.
- Keep the visible session open when user action is still required.
- Do not place credential material in tool arguments, logs, model context, or
  summaries.
