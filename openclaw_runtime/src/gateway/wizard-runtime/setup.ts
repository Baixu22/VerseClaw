// P5-2 CLI/TUI Deletion: Setup wizard runtime stubs.
//
// In P5-1 the setup wizard implementation lived in `wizard/setup.js` and
// was re-exported through the gateway's `wizardRuntime` barrel. With the
// `cli/`, `commands/`, and `wizard/` directories deleted in P5-2, the
// wizard implementation has been retired and only the minimal type
// surface is preserved so the gateway can still compile and tests that
// inject a custom `wizardRunner` continue to type-check.
//
// The default `wizardRunner` is now a no-op that resolves immediately.
// Hosts that previously relied on the CLI setup wizard (e.g. to prompt
// for first-time API keys) must provide a custom `wizardRunner` via
// `GatewayServerOptions.wizardRunner`.
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

export type OnboardOptions = {
  mode?: string;
  workspace?: string;
};

export async function runSetupWizard(
  _opts: OnboardOptions,
  _runtime: RuntimeEnv,
  _prompter: WizardPrompter,
): Promise<void> {
  // No-op: the setup wizard has been removed along with the `wizard/`
  // directory in P5-2. Tests and production hosts that need wizard
  // behavior should pass a custom wizardRunner via GatewayServerOptions.
}
