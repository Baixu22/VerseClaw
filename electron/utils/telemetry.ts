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

let posthogClient: PostHog | null = null;
let distinctId: string = '';
let telemetryEnabled = false;

async function stopPostHogClient(): Promise<void> {
    const client = posthogClient;
    posthogClient = null;
    distinctId = '';
    telemetryEnabled = false;
    if (!client) return;
    try {
        await client.shutdown();
    } catch (error) {
        logger.debug('Failed to shut down telemetry client:', error);
    }
}

function getCommonProperties(): Record<string, string> {
    return {
        $app_version: app.getVersion(),
        $os: process.platform,
        os_tag: process.platform,
        arch: process.arch,
    };
}

/**
 * Initialize PostHog telemetry
 */
export async function initTelemetry(): Promise<void> {
    try {
        const enabled = await getSetting('telemetryEnabled');
        telemetryEnabled = enabled;
        if (!enabled) {
            await stopPostHogClient();
            logger.info('Telemetry is disabled in settings');
            return;
        }
        if (!POSTHOG_API_KEY) {
            await stopPostHogClient();
            logger.info('Telemetry is enabled but VERSE_CLAW_POSTHOG_API_KEY is not configured');
            return;
        }
        if (posthogClient) {
            return;
        }

        // Initialize PostHog client
        posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });

        // Get or generate machine ID
        distinctId = await getSetting('machineId');
        if (!distinctId) {
            distinctId = machineIdSync();
            await setSetting('machineId', distinctId);
            logger.debug(`Generated new machine ID for telemetry: ${distinctId}`);
        }

        const properties = getCommonProperties();

        // Check if this is a new installation
        const hasReportedInstall = await getSetting('hasReportedInstall');
        if (!hasReportedInstall) {
            posthogClient.capture({
                distinctId,
                event: 'app_installed',
                properties,
            });
            await setSetting('hasReportedInstall', true);
            logger.info('Reported app_installed event');
        }

        // Always report app opened
        posthogClient.capture({
            distinctId,
            event: 'app_opened',
            properties,
        });
        logger.debug('Reported app_opened event');

    } catch (error) {
        logger.error('Failed to initialize telemetry:', error);
    }
}

export function trackMetric(event: string, properties: Record<string, unknown> = {}): void {
    logger.info(`[metric] ${event}`, properties);
}

/**
 * Apply a settings change without waiting for an app restart. Disabling stops
 * the client and clears its identity before any queued event can be flushed.
 */
export async function applyTelemetrySettingChange(enabled: boolean): Promise<void> {
    telemetryEnabled = enabled;
    if (!enabled) {
        await stopPostHogClient();
        return;
    }
    await initTelemetry();
}

export function captureTelemetryEvent(event: string, properties: Record<string, unknown> = {}): void {
    if (!telemetryEnabled || !posthogClient || !distinctId) {
        return;
    }

    try {
        posthogClient.capture({
            distinctId,
            event,
            properties: {
                ...getCommonProperties(),
                ...properties,
            },
        });
    } catch (error) {
        logger.debug(`Failed to capture telemetry event "${event}":`, error);
    }
}
