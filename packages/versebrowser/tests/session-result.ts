/**
 * Shared test helper: read the session id out of an `open` result.
 *
 * The difference from the inline `(opened.data as { session: { id: string } }).session.id`
 * that most suites use: **a failed open throws an error that carries the real
 * reason**. `facade.open()` reports failure as `ok: false` plus `content`
 * (`E_OPEN` + the underlying message) and deliberately does not throw, so the
 * inline form turns a failed open into
 * `TypeError: Cannot read properties of undefined (reading 'session')`
 * and the actual cause is lost.
 *
 * 2026-10-14: under 4-worker load `open` fails intermittently, and several
 * suites used the unchecked form - every such failure left only a TypeError
 * behind, which is the direct reason this flake family could not be localised.
 */
export function sessionIdOf(result: { ok?: boolean; content?: string; data?: unknown }): string {
  if (result.ok !== true) {
    const detail =
      typeof result.content === 'string' && result.content.length > 0
        ? result.content
        : JSON.stringify(result)?.slice(0, 300) ?? '(no content)';
    throw new Error(`open failed: ${detail}`);
  }
  const id = (result.data as { session?: { id?: unknown } } | undefined)?.session?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(
      `open reported ok but returned no session id: ${JSON.stringify(result.data)?.slice(0, 200) ?? '(no data)'}`,
    );
  }
  return id;
}
