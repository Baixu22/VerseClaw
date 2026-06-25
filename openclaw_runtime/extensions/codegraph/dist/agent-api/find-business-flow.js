"use strict";
/**
 * find_business_flow API
 *
 * Locates business flows matching a query and returns
 * the entry point, service chain, and categorized participants.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findBusinessFlow = findBusinessFlow;
function findBusinessFlow(_queries, entryPointDetector, flowDetector, input) {
    const maxSteps = input.maxSteps ?? 20;
    const flows = flowDetector.detectFlowByName(input.flow);
    const entryPoints = entryPointDetector.detectAll().entryPoints;
    // Find matching entry point
    const matchingEntry = entryPoints.find((ep) => ep.controller.toLowerCase().includes(input.flow.toLowerCase()) ||
        ep.entrypoint.toLowerCase().includes(input.flow.toLowerCase()));
    // Collect categorized participants from flows
    const services = new Set();
    const repositories = new Set();
    const validators = new Set();
    const controllers = new Set();
    const events = new Set();
    let totalSteps = 0;
    for (const flow of flows) {
        totalSteps += flow.steps.length;
        for (const step of flow.steps.slice(0, maxSteps)) {
            switch (step.semanticRole) {
                case 'service':
                    services.add(step.symbol);
                    break;
                case 'repository':
                    repositories.add(step.symbol);
                    break;
                case 'validator':
                case 'checker':
                    validators.add(step.symbol);
                    break;
                case 'handler':
                case 'controller':
                    controllers.add(step.symbol);
                    break;
                default:
                    services.add(step.symbol);
                    break;
            }
        }
    }
    // If no flow found, try to build from entry point
    if (flows.length === 0 && matchingEntry) {
        const flow = flowDetector.detectFlowFromEntry(matchingEntry, 5);
        if (flow) {
            for (const step of flow.steps) {
                totalSteps++;
                switch (step.semanticRole) {
                    case 'service':
                        services.add(step.symbol);
                        break;
                    case 'repository':
                        repositories.add(step.symbol);
                        break;
                    case 'validator':
                        validators.add(step.symbol);
                        break;
                    default:
                        services.add(step.symbol);
                        break;
                }
            }
        }
    }
    return {
        flowName: input.flow,
        entry: matchingEntry ?? null,
        services: Array.from(services).slice(0, 30),
        repositories: Array.from(repositories).slice(0, 20),
        validators: Array.from(validators).slice(0, 10),
        controllers: Array.from(controllers).slice(0, 10),
        events: Array.from(events).slice(0, 10),
        totalSteps,
    };
}
//# sourceMappingURL=find-business-flow.js.map