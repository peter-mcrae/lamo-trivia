import type { Env } from './env';
import { sendToGA } from './ga';

export type AnalyticsEventType =
  | 'game_created'
  | 'game_started'
  | 'game_finished'
  | 'hunt_created'
  | 'hunt_started'
  | 'hunt_finished'
  | 'photo_verified'
  | 'vision_comparison';

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

const TTL_180_DAYS = 180 * 24 * 60 * 60; // seconds

/**
 * Fire-and-forget analytics event logger.
 * Never throws — all errors are silently caught and logged to console.
 */
export async function logEvent(
  env: Env,
  type: AnalyticsEventType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const now = Date.now();
    const dateStr = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
    const id = crypto.randomUUID().slice(0, 8);
    const key = `evt:${type}:${dateStr}:${id}`;

    const event: AnalyticsEvent = { type, timestamp: now, data };

    const metadata = {
      type,
      ts: now,
      ...buildMetadataSummary(type, data),
    };

    await env.TRIVIA_KV.put(key, JSON.stringify(event), {
      expirationTtl: TTL_180_DAYS,
      metadata,
    });

    // Also forward to GA4 (fire-and-forget)
    const gaClientId = String(data.gameId || data.huntId || id);
    sendToGA(env, gaClientId, [
      { name: type, params: buildMetadataSummary(type, data) },
    ]).catch(() => {});
  } catch (err) {
    console.error('Analytics logEvent failed', {
      type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Build a small metadata summary for KV list operations.
 * KV metadata must be < 1KB, so keep it minimal.
 */
function buildMetadataSummary(
  type: AnalyticsEventType,
  data: Record<string, unknown>,
): Record<string, unknown> {
  switch (type) {
    case 'game_created':
    case 'game_started':
    case 'game_finished':
      return {
        gameId: data.gameId,
        mode: data.gameMode || 'trivia',
        players: data.playerCount,
      };
    case 'hunt_created':
    case 'hunt_started':
    case 'hunt_finished':
      return {
        huntId: data.huntId,
        players: data.playerCount,
        items: data.itemCount,
      };
    case 'photo_verified':
      return {
        model: data.model,
        accepted: data.accepted,
        ms: data.latencyMs,
      };
    case 'vision_comparison':
      return {
        agree: data.agreement,
        sMs: data.sonnetLatencyMs,
        hMs: data.haikuLatencyMs,
      };
    default:
      return {};
  }
}
