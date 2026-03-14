import type { Env } from './env';

const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

interface GA4Event {
  name: string;
  params?: Record<string, unknown>;
}

/**
 * Send events to GA4 via the Measurement Protocol.
 * Fire-and-forget — never throws.
 */
export async function sendToGA(
  env: Env,
  clientId: string,
  events: GA4Event[],
): Promise<void> {
  const measurementId = env.GA_MEASUREMENT_ID;
  const apiSecret = env.GA_API_SECRET;

  if (!measurementId || !apiSecret) return;

  try {
    const url = `${GA_ENDPOINT}?measurement_id=${measurementId}&api_secret=${apiSecret}`;

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        events,
      }),
    });
  } catch (err) {
    console.error('GA4 sendToGA failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
