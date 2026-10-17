/**
 * One-shot live verification for CLI / scripts (TF-0094).
 *
 * The CLI builds a facade per process and live sessions live inside that
 * process, so `vb open` followed by `vb verify --session <id>` cannot chain
 * across two commands. This helper runs the whole closed loop — open →
 * verify → close — inside one process, which is what the documented example
 * actually promises. Multi-step, long-lived sessions belong to MCP (one
 * process, many ops).
 */
import type { AgentBrowserFacade } from './facade.ts';
import type { ToolResult, VerifyExpectation } from '../contracts/index.ts';

export type OneShotVerifyOptions = {
  facade: AgentBrowserFacade;
  url: string;
  mode?: 'headless' | 'visible';
  selectors?: string[];
  expect?: VerifyExpectation[];
  screenshot?: boolean;
  evidenceDirName?: string;
};

export type OneShotVerifyOutcome = {
  /** verify_flow result, or the open/verify failure that prevented it. */
  result: ToolResult;
  sessionId?: string;
  /** True only when the session was closed before returning. */
  closed: boolean;
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(code: string, message: string, sessionId?: string): ToolResult {
  return {
    ok: false,
    content: message,
    ...(sessionId ? { data: { sessionId } } : {}),
    error: { code, message },
  };
}

/**
 * Open `url`, run verify_flow, always close the session, and report whether
 * the close succeeded. Never leaves a browser behind on the happy path.
 */
export async function verifyUrlOneShot(
  options: OneShotVerifyOptions,
): Promise<OneShotVerifyOutcome> {
  const { facade, url } = options;
  const opened = await facade.open({
    url,
    ...(options.mode ? { mode: options.mode } : {}),
  });
  if (!opened.ok) return { result: opened, closed: false };

  const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id;
  if (!sessionId) {
    return {
      result: failure('E_OPEN', 'open did not return a session id'),
      closed: false,
    };
  }

  let verified: ToolResult | undefined;
  let verifyError: unknown;
  try {
    verified = await facade.verifyFlow({
      sessionId,
      selectors: options.selectors ?? [],
      ...(options.expect && options.expect.length > 0 ? { expect: options.expect } : {}),
      ...(options.screenshot === false ? { screenshot: false } : {}),
      ...(options.evidenceDirName ? { evidenceDirName: options.evidenceDirName } : {}),
    });
  } catch (error) {
    verifyError = error;
  }

  const closed = (await facade.close(sessionId).catch(() => undefined))?.ok === true;
  if (verified) return { result: verified, sessionId, closed };
  return {
    result: failure('E_VERIFY', `verify failed: ${toMessage(verifyError)}`, sessionId),
    sessionId,
    closed,
  };
}
