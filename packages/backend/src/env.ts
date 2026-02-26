/** Cloudflare Secret Store binding — call .get() to retrieve the value */
interface SecretStoreSecret {
  get(): Promise<string>;
}

export interface Env {
  GAME_LOBBY: DurableObjectNamespace;
  GAME_ROOM: DurableObjectNamespace;
  TRIVIA_KV: KVNamespace;
  FRONTEND_URL: string;
  /**
   * OpenAI API key — resolved from (in priority order):
   * 1. Secret Store binding (.get()) — wrangler v4+
   * 2. Classic Worker secret (string) — wrangler secret put
   * 3. .dev.vars string — local dev
   */
  OPENAI_API_KEY?: SecretStoreSecret | string;
}

/** Resolve OPENAI_API_KEY from Secret Store, classic secret, or .dev.vars */
export async function getOpenAIKey(env: Env): Promise<string> {
  const key = env.OPENAI_API_KEY;

  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured. Set it via wrangler secret put OPENAI_API_KEY');
  }

  // Classic Worker secret or .dev.vars — plain string
  if (typeof key === 'string') {
    return key;
  }

  // Secret Store binding — has .get() method
  if (typeof key.get === 'function') {
    return key.get();
  }

  throw new Error('OPENAI_API_KEY binding has unexpected type');
}
