/**
 * Mock infrastructure for testing Cloudflare Workers Durable Objects and KV
 * without needing miniflare or the full Workers runtime.
 */

import type { Env } from '../env';

// --- Mock KV Namespace ---

export function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: async (key: string, opts?: any) => {
      const val = store.get(key);
      if (val === undefined) return null;
      if (opts === 'json' || opts?.type === 'json') return JSON.parse(val);
      return val;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({
      keys: Array.from(store.keys()).map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

// --- Mock WebSocket ---

export interface MockWebSocket extends WebSocket {
  _sent: string[];
  _closed: boolean;
  _attachment: unknown;
}

export function createMockWebSocket(): MockWebSocket {
  const ws: MockWebSocket = {
    _sent: [],
    _closed: false,
    _attachment: null,
    send(data: string) {
      ws._sent.push(data);
    },
    close() {
      ws._closed = true;
    },
    serializeAttachment(value: unknown) {
      ws._attachment = value;
    },
    deserializeAttachment() {
      return ws._attachment;
    },
    accept() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  } as unknown as MockWebSocket;
  return ws;
}

/** Parse all sent JSON messages from a mock WebSocket */
export function getSentMessages(ws: MockWebSocket): any[] {
  return ws._sent.map((s) => JSON.parse(s));
}

/** Get the last sent JSON message from a mock WebSocket */
export function getLastMessage(ws: MockWebSocket): any {
  const messages = getSentMessages(ws);
  return messages[messages.length - 1];
}

// --- Mock Durable Object State ---

export interface MockDurableObjectState extends DurableObjectState {
  _storage: Map<string, unknown>;
  _alarm: number | null;
  _webSockets: WebSocket[];
}

export function createMockDurableObjectState(): MockDurableObjectState {
  const storage = new Map<string, unknown>();
  const webSockets: WebSocket[] = [];
  let alarm: number | null = null;

  const state: MockDurableObjectState = {
    _storage: storage,
    _alarm: null,
    _webSockets: webSockets,
    id: { toString: () => 'mock-id' } as DurableObjectId,
    storage: {
      get: async (key: string) => storage.get(key) ?? null,
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') {
          storage.set(key, value);
        }
      },
      delete: async (key: string) => storage.delete(key),
      deleteAll: async () => storage.clear(),
      setAlarm: async (scheduledTime: number | Date) => {
        state._alarm = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
      },
      getAlarm: async () => state._alarm,
      deleteAlarm: async () => {
        state._alarm = null;
      },
      list: async () => new Map(storage),
    } as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async (callback: () => Promise<void>) => {
      await callback();
    },
    acceptWebSocket: (ws: WebSocket) => {
      webSockets.push(ws);
    },
    getWebSockets: () => webSockets,
    waitUntil: () => {},
    abort: () => {},
  } as unknown as MockDurableObjectState;

  return state;
}

// --- Mock Env ---

export function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    GAME_LOBBY: {
      idFromName: () => ({ toString: () => 'lobby-id' }),
      get: () => ({
        fetch: async () => Response.json({ games: [] }),
      }),
    } as unknown as DurableObjectNamespace,
    GAME_ROOM: {
      idFromName: () => ({ toString: () => 'room-id' }),
      get: () => ({
        fetch: async () => Response.json({ ok: true }),
      }),
    } as unknown as DurableObjectNamespace,
    PRIVATE_GROUP: {
      idFromName: () => ({ toString: () => 'group-id' }),
      get: () => ({
        fetch: async () => Response.json({ ok: true }),
      }),
    } as unknown as DurableObjectNamespace,
    SCAVENGER_HUNT_ROOM: {
      idFromName: () => ({ toString: () => 'hunt-room-id' }),
      get: () => ({
        fetch: async () => Response.json({ ok: true }),
      }),
    } as unknown as DurableObjectNamespace,
    TRIVIA_KV: createMockKV(),
    R2_HUNT_PHOTOS: {
      put: async () => {},
      get: async () => null,
      delete: async () => {},
      list: async () => ({ objects: [], truncated: false }),
    } as unknown as R2Bucket,
    FRONTEND_URL: 'http://localhost:5173',
    ...overrides,
  };
}
