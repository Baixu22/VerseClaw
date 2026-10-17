/**
 * Product red-line policy (TF-0040).
 *
 * versebrowser is a **developer acceptance** control plane, not a bot toolkit.
 * These checks are product semantics: playbook registration, automation goals,
 * and skill triggers must refuse captcha-bypass / public mass-signup productization.
 */

export type RedlineCode =
  | 'E_REDLINE_CAPTCHA_BYPASS'
  | 'E_REDLINE_MASS_SIGNUP'
  | 'E_REDLINE_PUBLIC_SITE_ABUSE'
  | 'E_REDLINE_STEALTH_PROXY';

export type RedlineDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: RedlineCode;
      message: string;
      matched: string;
    };

/** Patterns that mean "productize bypass / abuse" — not legitimate HITL. */
const REDLINE_RULES: ReadonlyArray<{ code: RedlineCode; re: RegExp; hint: string }> = [
  {
    code: 'E_REDLINE_CAPTCHA_BYPASS',
    // No \b — Chinese tokens are not JS word chars.
    re: /(?:captcha|recaptcha|hcaptcha|geetest|capsolver|2captcha|anticaptcha|打码|过码|验证码\s*识别|人机验证\s*绕过)/iu,
    hint: 'Do not productize captcha solving/bypass. Human completes challenges (HITL); we never auto-solve.',
  },
  {
    code: 'E_REDLINE_MASS_SIGNUP',
    re: /(?:批量注册|账号农场|mass\s*regist|bulk\s*sign[\s-]?up|register\s*thousands|farm\s*account)/iu,
    hint: 'No public-site mass registration playbooks. Authorized/local signup acceptance only.',
  },
  {
    code: 'E_REDLINE_PUBLIC_SITE_ABUSE',
    re: /(?:刷单|养号|click\s*farm|botnet)/iu,
    hint: 'Public abuse automation is out of scope.',
  },
  {
    code: 'E_REDLINE_STEALTH_PROXY',
    re: /(?:住宅代理轮换|隐身指纹军备|residential\s*proxy\s*rotation|stealth\s*fingerprint)/iu,
    hint: 'No stealth/proxy arms-race features.',
  },
];

/** True when the whole string is a prohibition / red-line doc, not a product goal. */
export function isRedlineDocumentation(text: string): boolean {
  const source = String(text ?? '');
  if (/(?:不提供|不做|禁止|拒绝|不得|严禁)[^\n]{0,80}(?:打码|过码|captcha|CAPTCHA|批量注册|人机验证|账号农场)/iu.test(source)) {
    return true;
  }
  if (/红线/u.test(source) && /(?:不提供|不做|禁止|拒绝|不得)/u.test(source)) {
    return true;
  }
  return false;
}

/**
 * Evaluate a free-text goal / playbook title / prompt / skill trigger.
 * Fail-closed on red-line language that markets bypass capability.
 */
export function evaluateRedline(text: string): RedlineDecision {
  const source = String(text ?? '');
  if (isRedlineDocumentation(source)) {
    return { allowed: true };
  }
  for (const rule of REDLINE_RULES) {
    const match = rule.re.exec(source);
    if (match) {
      return {
        allowed: false,
        code: rule.code,
        message: `${rule.hint} (matched: ${match[0]})`,
        matched: match[0],
      };
    }
  }
  return { allowed: true };
}

/** Throw if red-line language is present (product gate). */
export function assertRedlineAllowed(text: string, context = 'automation goal'): void {
  const decision = evaluateRedline(text);
  if (!decision.allowed) {
    const error = new Error(`${context}: ${decision.message}`) as Error & {
      code: string;
      matched: string;
    };
    error.code = decision.code;
    error.matched = decision.matched;
    throw error;
  }
}

export const REDLINE_DOCS_SNIPPET = `
### 红线（永远不做）

- 不提供验证码识别 / 打码 / CAPTCHA bypass 产品化
- 不提供公共站点批量注册 / 账号农场 playbook
- 不提供住宅代理轮换 / 隐身指纹军备
- 合法路径：**仅授权/自有系统**的表单与注册验收；人机验证由 **人完成（HITL）** 后恢复会话
`.trim();
