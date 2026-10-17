/**
 * 敏感键名的**唯一**判定来源。
 *
 * 抽成叶子模块的原因：`redact-secrets.ts` 用它做文本 / JSON 脱敏，`net-policy/redact-sensitive-url.ts`
 * 用它做 URL 查询串脱敏，而后者又被前者 import——直接互相引用会形成循环导入。放在这里两边共用一份，
 * 不再各自维护清单：URL 侧此前就因为自维护清单漏掉了 session / sid / csrf / xsrf / cookie / credential。
 */

/** 常见敏感键名；`auth` / `pass` 只在独立词或 -/_ 分隔处命中，避免 author / passThrough 这类误伤。 */
export const SECRET_KEY_PATTERN =
  /(password|passwd|(?:^|[_-])pass(?:$|[_-])|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|(?:^|[_-])auth(?:$|[_-]))/i;

/** 网络字段名与 URL 查询串额外覆盖 session cookie 与 CSRF token。 */
export function isSensitiveNetworkName(name: string): boolean {
  // C96/TF-0123: `otp`/`pin` are one-time codes, not URL aliases, but every caller that had its
  // own list already treated them as secret (readFieldState, the runtime-read executor, the
  // audit trail). Keeping them here is what lets those callers drop their local extras instead
  // of growing another list. Measured 2026-10-14: `otp`/`pin` were the last names still leaking
  // through network-context and tool-artifacts while every other family name was covered.
  // C96/TF-0123: the short aliases match as **word components**, not as raw substrings. A bare
  // substring test redacted English words that merely contain one (`consider` / `president` /
  // `residue` / `pinto` / `inside` / `opinion` / `siding` / `beside` - measured 2026-10-14), and
  // that predicate feeds the key checks in the URL, console, network and audit paths alike.
  // Component names (`x-session-id`, `csrf_token`, `_csrf`) still match.
  return SECRET_KEY_PATTERN.test(name) || /(?:^|[^a-z0-9])(?:session|sid|csrf|xsrf|otp|pin)(?:$|[^a-z0-9])/i.test(name);
}
