// P5-2 CLI/TUI Deletion: WizardSession re-exports the relocated runtime.
//
// In P5-1 this barrel re-exported the WizardSession type and runtime
// class from wizard/session.js so each gateway file could route through
// a single indirection while commands/, cli/, and wizard/ still lived
// under src/. In P5-2 wizard/session.ts has been physically moved to
// gateway/wizard-runtime/session.ts and the gateway remains the only
// consumer, so the barrel now re-exports the relocated runtime directly.
//
// Both the type and the runtime class are re-exported because the
// gateway needs the constructor in server-methods/wizard.ts to instantiate
// wizard sessions, while the rest of the gateway only consumes the
// WizardSession type for tracker maps and request context plumbing.
export { WizardSession } from "../wizard-runtime/session.js";
