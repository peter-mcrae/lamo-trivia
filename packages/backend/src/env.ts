/** Cloudflare Secret Store binding — call .get() to retrieve the value */
interface SecretStoreSecret {
  get(): Promise<string>;
}

export interface Env {
  GAME_LOBBY: DurableObjectNamespace;
  GAME_ROOM: DurableObjectNamespace;
  PRIVATE_GROUP: DurableObjectNamespace;
  SCAVENGER_HUNT_ROOM: DurableObjectNamespace;
  TRIVIA_KV: KVNamespace;
  R2_HUNT_PHOTOS: R2Bucket;
  FRONTEND_URL: string;
  /** Shared secret for authenticating POST /api/seed — set via wrangler secret put SEED_SECRET */
  SEED_SECRET?: string;
  /**
   * OpenAI API key — resolved from (in priority order):
   * 1. Secret Store binding (.get()) — wrangler v4+
   * 2. Classic Worker secret (string) — wrangler secret put
   * 3. .dev.vars string — local dev
   */
  OPENAI_API_KEY?: SecretStoreSecret | string;
  /** Anthropic API key for Claude vision (scavenger hunt photo verification) */
  ANTHROPIC_API_KEY?: SecretStoreSecret | string;
  /** Resend API key for sending magic code emails */
  RESEND_API_KEY?: SecretStoreSecret | string;
  /** Stripe secret key */
  STRIPE_SECRET_KEY?: SecretStoreSecret | string;
  /** Stripe webhook signing secret */
  STRIPE_WEBHOOK_SECRET?: string;
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

/** Resolve ANTHROPIC_API_KEY from Secret Store, classic secret, or .dev.vars */
export async function getAnthropicKey(env: Env): Promise<string> {
  const key = env.ANTHROPIC_API_KEY;

  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Set it via wrangler secret put ANTHROPIC_API_KEY');
  }

  if (typeof key === 'string') {
    return key;
  }

  if (typeof key.get === 'function') {
    return key.get();
  }

  throw new Error('ANTHROPIC_API_KEY binding has unexpected type');
}

/** Resolve RESEND_API_KEY */
export async function getResendKey(env: Env): Promise<string> {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured');
  if (typeof key === 'string') return key;
  if (typeof key.get === 'function') return key.get();
  throw new Error('RESEND_API_KEY binding has unexpected type');
}

/** Resolve STRIPE_SECRET_KEY */
export async function getStripeKey(env: Env): Promise<string> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (typeof key === 'string') return key;
  if (typeof key.get === 'function') return key.get();
  throw new Error('STRIPE_SECRET_KEY binding has unexpected type');
}
