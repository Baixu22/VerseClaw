"use strict";
/**
 * get_minimal_context API
 *
 * Core API: given a task description, returns the minimal set of files
 * and symbols the agent needs to understand to complete the task.
 * Target: Token consumption reduced by 80%+ vs reading all files.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMinimalContext = getMinimalContext;
function getMinimalContext(compressor, input) {
    return compressor.getMinimalContext(input);
}
//# sourceMappingURL=minimal-context.js.map