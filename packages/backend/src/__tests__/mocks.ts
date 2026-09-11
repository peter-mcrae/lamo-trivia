/**
 * Mock infrastructure for testing Cloudflare Workers Durable Objects and KV
 * without needing miniflare or the full Workers runtime.
 */

import type { Env } from '../env';

/**
 * Take a value out of the caller's hands, the way a real store does.
 *
 * KV and Durable Object storage both serialize on write and deserialize on
 * read, so nothing a handler keeps in memory is ever the same object the
 * store holds. A mock that hands back a live reference cannot tell
 * "persisted it" apart from "mutated it in memory and forgot to persist" —
 * every assertion about storage passes either way, which is precisely the
 * blind spot that let a wave of missing-persist bugs ship green.
 *
 * structuredClone is what the DO storage API actually uses, so this also
 * inherits its failure mode: a value the runtime could not store (a function,
 * a class instance with methods) throws here too, instead of being silently
 * accepted.
 */
function snapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

// --- Mock KV Namespace ---

export function createMockKV(): KVNamespace {
  const store = new Map<string, unknown>();
  const metadataStore = new Map<string, unknown>();

  return {
    get: async (key: string, opts?: any) => {
      const val = store.get(key);
      if (val === undefined) return null;
      if (opts === 'json' || opts?.type === 'json') {
        return typeof val === 'string' ? JSON.parse(val) : snapshot(val);
      }
      return typeof val === 'string' ? val : snapshot(val);
    },
    put: async (key: string, value: string, opts?: any) => {
      // Real KV takes bytes; anything else is stored as a snapshot so a
      // caller can never mutate what it already wrote.
      store.set(key, typeof value === 'string' ? value : snapshot(value));
      if (opts?.metadata) {
        metadataStore.set(key, snapshot(opts.metadata));
      }
    },
    delete: async (key: string) => {
      store.delete(key);
      metadataStore.delete(key);
    },
    list: async (opts?: any) => {
      const prefix = opts?.prefix || '';
      const keys = Array.from(store.keys())
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name, metadata: snapshot(metadataStore.get(name)) ?? null }));
      return { keys, list_complete: true, cacheStatus: null };
    },
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
      // Snapshot on the way in and on the way out. The real DO storage API
      // structured-clones in both directions, so a handler that mutates the
      // object it read, or the object it wrote, changes nothing durable until
      // it calls put() again. Returning the live object here is what made
      // `state._storage.get('room')` assertions vacuous.
      get: async (key: string) => (storage.has(key) ? snapshot(storage.get(key)) : null),
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') {
          storage.set(key, snapshot(value));
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
      list: async () => new Map(Array.from(storage, ([k, v]) => [k, snapshot(v)])),
    } as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async (callback: () => Promise<void>) => {
      await callback();
    },
    // Route through state._webSockets so tests can simulate disconnects by
    // reassigning it (e.g. state._webSockets = state._webSockets.filter(...))
    acceptWebSocket: (ws: WebSocket) => {
      state._webSockets.push(ws);
    },
    getWebSockets: () => state._webSockets,
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
