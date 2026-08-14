import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Password hashing and TOTP, on Node's own crypto.
 *
 * No password or OTP library is imported: scrypt is built into Node, and
 * RFC 6238 is thirty lines of HMAC. Fewer dependencies in the
 * authentication path means fewer parties whose compromise is ours.
 *
 * Deliberately NOT marked `server-only`. This module computes; it reads
 * no cookie, environment variable or database, so there is nothing here
 * to keep from a browser that `node:crypto` does not already keep — a
 * client bundle importing it fails to build regardless. The marker sits
 * on session.ts and authClient.ts, which do touch those things, and
 * leaving it here only broke the one legitimate non-Next caller:
 * tools/admin/create-admin.ts, which must share this exact code so the
 * CLI and the login path can never disagree about hash formats.
 */

// promisify() drops the options overload, so wrapped by hand.
function scrypt(
  password: string, salt: Buffer, keylen: number, options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

// scrypt parameters: N=2^15, r=8, p=1 — the OWASP-recommended setting
// for interactive login (~100ms). Encoded in the hash so parameters can
// be raised later without invalidating existing hashes.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const key = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024,
  });
  return [
    'scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P,
    salt.toString('base64url'), key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nText, rText, pText, saltText, keyText] = parts;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(keyText, 'base64url');
  const key = await scrypt(password, salt, expected.length, {
    N: Number(nText), r: Number(rText), p: Number(pText),
    maxmem: 128 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, SHA-1, 30-second step, 6 digits)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  // 20 random bytes -> 32 base32 characters, the conventional size.
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let secret = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      secret += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) secret += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return secret;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000);
  return code.toString().padStart(6, '0');
}

/**
 * Accepts the current step and one either side: clock skew between the
 * server and a phone is normal; a wider window is not.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const step = Math.floor(now / 1000 / 30);
  for (const drift of [0, -1, 1]) {
    const expected = totpAt(secret, step + drift);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) return true;
  }
  return false;
}

/** otpauth:// URI for authenticator apps (manual entry or QR elsewhere). */
export function totpUri(secret: string, email: string): string {
  const issuer = 'AFLDB';
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`
    + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------------------------------------------------------------------------
// Opaque tokens
// ---------------------------------------------------------------------------

/** 256-bit random token; the database stores only its sha256. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
