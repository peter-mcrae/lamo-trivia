/** Cloudflare Secret Store binding — call .get() to retrieve the value */
interface SecretStoreSecret {
  get(): Promise<string>;
}

export interface Env {
  GAME_LOBBY: DurableObjectNamespace;
  GAME_ROOM: DurableObjectNamespace;
  TRIVIA_KV: KVNamespace;
  FRONTEND_URL: string;
  /** Secret Store in production, plain string from .dev.vars locally */
  OPENAI_API_KEY: SecretStoreSecret | string;
}

/** Resolve OPENAI_API_KEY from either Secret Store (.get()) or plain .dev.vars string */
export async function getOpenAIKey(env: Env): Promise<string> {
  if (typeof env.OPENAI_API_KEY === 'string') {
    return env.OPENAI_API_KEY;
  }
  return env.OPENAI_API_KEY.get();
}
