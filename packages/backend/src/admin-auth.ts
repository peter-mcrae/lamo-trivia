import type { Env } from './env';
import { timingSafeEqual } from './auth';

export interface AdminIdentity {
  email: string;
  method: 'cloudflare-access' | 'seed-secret';
}

/**
 * Verify that the incoming request is from an authorized admin.
 *
 * Production: Validates `Cf-Access-Jwt-Assertion` header JWT using
 * Cloudflare Access JWKS endpoint.
 *
 * Dev fallback: Accepts `Authorization: Bearer {SEED_SECRET}` when
 * CF_ACCESS_AUD is not set.
 *
 * Returns AdminIdentity on success, null on failure.
 */
export async function verifyAdminAccess(
  request: Request,
  env: Env,
): Promise<AdminIdentity | null> {
  // --- Production: Cloudflare Access JWT ---
  if (env.CF_ACCESS_AUD && env.CF_ACCESS_TEAM_DOMAIN) {
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!jwt) return null;

    try {
      const identity = await validateAccessJWT(
        jwt,
        env.CF_ACCESS_TEAM_DOMAIN,
        env.CF_ACCESS_AUD,
      );
      return identity;
    } catch {
      return null;
    }
  }

  // --- Dev fallback: Bearer SEED_SECRET ---
  // Only available when CF Access is NOT configured (local dev).
  // In production, CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN must be set;
  // if they are, this fallback is never reached (see guard above).
  // If neither CF Access nor SEED_SECRET is configured, admin access is denied.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ') || !env.SEED_SECRET) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const match = await timingSafeEqual(token, env.SEED_SECRET);
  if (!match) return null;

  return { email: 'dev-admin@local', method: 'seed-secret' };
}

// --- Cloudflare Access JWT validation ---

interface JWK {
  kty: string;
  n: string;
  e: string;
  kid: string;
  alg: string;
}

interface JWKS {
  keys: JWK[];
}

interface AccessJWTPayload {
  aud: string[];
  email: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
  type: string;
}

// Simple in-memory JWKS cache (per isolate)
let jwksCache: { keys: JWKS; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchJWKS(teamDomain: string): Promise<JWKS> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL) {
    return jwksCache.keys;
  }

  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);

  const jwks = (await res.json()) as JWKS;
  jwksCache = { keys: jwks, fetchedAt: now };
  return jwks;
}

function base64UrlDecode(str: string): Uint8Array {
  // Convert base64url to base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function validateAccessJWT(
  jwt: string,
  teamDomain: string,
  aud: string,
): Promise<AdminIdentity> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to get kid
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64))) as {
    kid: string;
    alg: string;
  };

  if (header.alg !== 'RS256') throw new Error(`Unsupported algorithm: ${header.alg}`);

  // Fetch JWKS and find matching key
  const jwks = await fetchJWKS(teamDomain);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('No matching key found in JWKS');

  // Import the public key
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Verify signature
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data);
  if (!valid) throw new Error('Invalid JWT signature');

  // Decode and validate payload
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadB64)),
  ) as AccessJWTPayload;

  // Validate audience
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) throw new Error('Invalid audience');

  // Validate expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('JWT expired');

  // Validate issuer
  const expectedIssuer = `https://${teamDomain}.cloudflareaccess.com`;
  if (payload.iss !== expectedIssuer) throw new Error('Invalid issuer');

  return { email: payload.email, method: 'cloudflare-access' };
}

// Export for testing
export { validateAccessJWT as _validateAccessJWT, fetchJWKS as _fetchJWKS, jwksCache };

/** Reset JWKS cache (for testing) */
export function _resetJWKSCache(): void {
  jwksCache = null;
}
