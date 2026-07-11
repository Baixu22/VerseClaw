/** @deprecated Provider-owned login helpers; use provider auth hooks instead. */
import { loadBundledPluginPublicSurfaceModuleSync } from "./facade-runtime.js";

type ChutesFacade = Pick<typeof import("../../extensions/chutes/api.js"), "loginChutes">;

function loadChutesFacade(): ChutesFacade {
  return loadBundledPluginPublicSurfaceModuleSync<ChutesFacade>({
    dirName: "chutes",
    artifactBasename: "api.js",
  });
}

/** @deprecated Chutes provider-owned login helper; use provider auth hooks instead. */
export const loginChutes: ChutesFacade["loginChutes"] = (...args) =>
  loadChutesFacade().loginChutes(...args);

/** @deprecated Provider-owned login helpers; use provider auth hooks instead. */
export { loginOpenAICodexOAuth } from "../plugins/provider-openai-chatgpt-oauth.js";
/** @deprecated Provider-owned login helpers; use provider auth hooks instead. */
export { githubCopilotLoginCommand } from "./github-copilot-login.js";
