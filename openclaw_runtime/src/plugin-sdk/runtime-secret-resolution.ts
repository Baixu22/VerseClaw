/**
 * @deprecated Compatibility subpath. Import command secret helpers from
 * `openclaw/plugin-sdk/runtime` and lower-level secret helpers from
 * `openclaw/plugin-sdk/secret-ref-runtime` instead.
 */

/** @deprecated Import from `openclaw/plugin-sdk/runtime` instead. */
export { resolveCommandSecretRefsViaGateway } from "../gateway/cli-runtime/command-secret-gateway.js";
/** @deprecated Import from `openclaw/plugin-sdk/runtime` instead.
 *  Note: getChannelsCommandSecretTargetIds was renamed to getAgentRuntimeCommandSecretTargetIds
 *  in the gateway stub. For scoped usage, use getScopedChannelsCommandSecretTargets. */
export { getAgentRuntimeCommandSecretTargetIds as getChannelsCommandSecretTargetIds } from "../gateway/cli-runtime/command-secret-targets.js";
/** @deprecated Import from `openclaw/plugin-sdk/secret-ref-runtime` instead. */
export { resolveSecretRefValues } from "../secrets/resolve.js";
/** @deprecated Import from `openclaw/plugin-sdk/secret-ref-runtime` instead. */
export { applyResolvedAssignments, createResolverContext } from "../secrets/runtime-shared.js";
