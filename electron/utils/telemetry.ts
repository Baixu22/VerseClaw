import { PostHog } from 'posthog-node';
import { machineIdSync } from 'node-machine-id';
import { app } from 'electron';
import { getSetting, setSetting } from './store';
import { logger } from './logger';

/**
 * PostHog is an optional, build/runtime-configured outbound integration.
 * The repository must not ship an ingest identifier tied to an operator-owned
 * analytics account. Configure both values in the release/build environment:
 *   VERSE_CLAW_POSTHOG_API_KEY
 *   VERSE_CLAW_POSTHOG_HOST (optional; defaults to the PostHog US endpoint)
 */
const POSTHOG_API_KEY = process.env.VERSE_CLAW_POSTHOG_API_KEY?.trim() ?? '';
const POSTHOG_HOST = process.env.VERSE_CLAW_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

type TelemetrySession = {
    client: PostHog;
    controller: AbortController;
    distinctId: string;
    ready: Promise<void>;
};

let activeSession: TelemetrySession | null = null;
let consentRevision = 0;
let hasReportedOpen = false;

function getCommonProperties(): Record<string, string> {
    return {
        $app_version: app.getVersion(),
        $os: process.platform,
        os_tag: process.platform,
        arch: process.arch,
    };
}

function discardSession(session: TelemetrySession): void {
    // Permanently revoke this lifetime before any asynchronous SDK cleanup.
    session.controller.abort();
    void session.client.disable().then(() => session.client.shutdown()).catch((error) => {
        logger.debug('Failed to finish disabled telemetry cleanup:', error);
    });
}

async function initializeSession(session: TelemetrySession): Promise<void> {
    let id = await getSetting('machineId');
    if (activeSession !== session) return;
    if (!id) {
        id = machineIdSync();
        await setSetting('machineId', id);
        if (activeSession !== session) return;
        logger.debug('Generated a machine ID for telemetry');
    }
    session.distinctId = id;
    const hasReportedInstall = await getSetting('hasReportedInstall');
    if (activeSession !== session) return;
    const properties = getCommonProperties();
    if (!hasReportedInstall) {
        session.client.capture({ distinctId: id, event: 'app_installed', properties });
        await setSetting('hasReportedInstall', true);
        if (activeSession !== session) return;
        logger.info('Reported app_installed event');
    }
    if (!hasReportedOpen) {
        session.client.capture({ distinctId: id, event: 'app_opened', properties });
        hasReportedOpen = true;
        logger.debug('Reported app_opened event');
    }
}

/** Apply persisted consent without a restart. Re-enabling never revives an old queue. */
export function setTelemetryEnabled(enabled: boolean): Promise<void> {
    consentRevision += 1;
    if (!enabled) {
        const revoked = activeSession;
        activeSession = null;
        if (revoked) discardSession(revoked);
        return Promise.resolve();
    }
    if (activeSession) return activeSession.ready;
    if (!POSTHOG_API_KEY) {
        logger.info('Telemetry is enabled but VERSE_CLAW_POSTHOG_API_KEY is not configured');
        return Promise.resolve();
    }

    const controller = new AbortController();
    const client = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        fetch: async (url, options) => {
            // SDK disable() does not clear an already queued batch. A local 204
            // discards it during shutdown/retry; it is NOT a collector response.
            if (controller.signal.aborted) return new Response(null, { status: 204 });
            const consent = await getSetting('telemetryEnabled');
            if (consent !== true || controller.signal.aborted) return new Response(null, { status: 204 });
            const signal = options.signal
                ? AbortSignal.any([options.signal, controller.signal])
                : controller.signal;
            return fetch(url, { ...options, signal });
        },
    });
    const session: TelemetrySession = { client, controller, distinctId: '', ready: Promise.resolve() };
    activeSession = session;
    session.ready = initializeSession(session).catch((error) => {
        if (activeSession === session) activeSession = null;
        discardSession(session);
        logger.error('Failed to initialize telemetry:', error);
    });
    return session.ready;
}

/** Initialize once from persisted consent; a later setting change wins over a stale read. */
export async function initTelemetry(): Promise<void> {
    const revision = consentRevision;
    try {
        const enabled = await getSetting('telemetryEnabled');
        if (revision !== consentRevision) return;
        await setTelemetryEnabled(enabled === true);
        if (!enabled) logger.info('Telemetry is disabled in settings');
    } catch (error) {
        logger.error('Failed to initialize telemetry:', error);
    }
}

/** Backwards-compatible settings entry point; the lifetime change is synchronous. */
export async function applyTelemetrySettingChange(enabled: boolean): Promise<void> {
    await setTelemetryEnabled(enabled);
}

export function trackMetric(event: string, properties: Record<string, unknown> = {}): void {
    logger.info(`[metric] ${event}`, properties);
}

export function captureTelemetryEvent(event: string, properties: Record<string, unknown> = {}): void {
    const session = activeSession;
    if (!session?.distinctId || session.controller.signal.aborted) return;
    try {
        session.client.capture({
            distinctId: session.distinctId,
            event,
            properties: { ...getCommonProperties(), ...properties },
        });
    } catch (error) {
        logger.debug(`Failed to capture telemetry event "${event}":`, error);
    }
}
