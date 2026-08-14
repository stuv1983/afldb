/**
 * Signed access tokens, verifiable in BOTH runtimes.
 *
 * The beta gate lives in middleware, which Next.js runs on the edge
 * runtime: no Node crypto, no database driver. Everything here therefore
 * uses only Web Crypto (`globalThis.crypto`), which Node 18+ provides
 * natively, so one implementation serves middleware and server code and
 * the two can never disagree about what a valid token looks like.
 *
 * The token is an HMAC-signed claim, not a session pointer:
 *
 *   base64url(payload JSON) + "." + base64url(HMAC-SHA256(payload))
 *
 * For BETA access that is the whole story — the claim says "admitted via
 * code N until T" and revocation works by epoch: bumping the epoch (an
 * admin action recorded in the database) invalidates every earlier
 * token. For ADMIN access the cookie is only the outer fence; every
 * admin page ALSO checks its database session, which is individually
 * revocable. Middleware keeps unauthenticated traffic out cheaply;
 * authorisation happens where the database is.
 */

const encoder = new TextEncoder();

export type AccessClaim = {
  v: 1;
  kind: 'beta' | 'admin';
  /** Who or what was admitted: a code id, an email, a user id. */
  sub: string;
  /** Unix seconds. */
  exp: number;
  /** Beta revocation epoch; tokens from earlier epochs are dead. */
  epoch: number;
};

function base64urlEncode(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(text: string): Uint8Array | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  );
}

export async function signClaim(claim: AccessClaim, secret: string): Promise<string> {
  const payload = encoder.encode(JSON.stringify(claim));
  const key = await hmacKey(secret);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return `${base64urlEncode(payload)}.${base64urlEncode(mac)}`;
}

/**
 * Verify a token and return its claim, or null.
 *
 * `crypto.subtle.verify` is constant-time; expiry and epoch are checked
 * only after the signature, so an attacker learns nothing from timing.
 */
export async function verifyClaim(
  token: string | undefined,
  secret: string,
  expected: { kind: AccessClaim['kind']; minEpoch?: number },
): Promise<AccessClaim | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payloadBytes = base64urlDecode(token.slice(0, dot));
  const macBytes = base64urlDecode(token.slice(dot + 1));
  if (!payloadBytes || !macBytes) return null;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC', key, macBytes as BufferSource, payloadBytes as BufferSource,
  );
  if (!valid) return null;

  let claim: AccessClaim;
  try {
    claim = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }

  if (claim.v !== 1 || claim.kind !== expected.kind) return null;
  if (claim.exp * 1000 < Date.now()) return null;
  if (expected.minEpoch !== undefined && claim.epoch < expected.minEpoch) return null;
  return claim;
}

/**
 * Whether the beta gate is on. Kept here in the edge-safe module so the
 * middleware door and the server-only mint/check side (session.ts) share one
 * definition of "on" rather than each inlining `=== 'on'`.
 */
export function betaGateOn(): boolean {
  return process.env.AFLDB_BETA_GATE === 'on';
}

/**
 * Read and validate the beta revocation epoch.
 *
 * Absent (or empty) means the default epoch 1, which every cookie is minted
 * at. A value that is PRESENT but not an integer is an operator error —
 * almost always a fumbled kill-switch bump — and must fail LOUD rather than
 * silently disable the switch. `Number('epoch-2')` is NaN and `claim.epoch <
 * NaN` is always false, so the previous inline `Number(process.env... ?? 1)`
 * admitted every outstanding cookie at exactly the moment someone was trying
 * to revoke them. Throwing turns that fail-open into a fail-closed the caller
 * surfaces (a 503 at the edge, an error on the mint side).
 */
export function betaEpoch(): number {
  const raw = process.env.AFLDB_BETA_EPOCH;
  if (raw === undefined || raw === '') return 1;
  const epoch = Number(raw);
  if (!Number.isInteger(epoch)) {
    throw new Error(
      `AFLDB_BETA_EPOCH must be an integer; got ${JSON.stringify(raw)}. `
      + 'Refusing to run rather than silently disable the beta kill switch.',
    );
  }
  return epoch;
}

export const BETA_COOKIE = 'afldb_beta';
export const ADMIN_COOKIE = 'afldb_admin';

/** Beta admissions last 90 days; a code, once used, should not nag. */
export const BETA_TTL_SECONDS = 90 * 24 * 3600;

/** Admin sessions last 12 hours; sign in again tomorrow. */
export const ADMIN_TTL_SECONDS = 12 * 3600;
