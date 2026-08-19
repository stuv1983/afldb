import { createHmac } from 'node:crypto';

/**
 * RFC 6238 TOTP (SHA-1, 30s step, 6 digits) — exactly the parameters
 * tools/admin/create-admin.ts prints and src/lib/auth/crypto verifies.
 *
 * Diagnostic-harness-only: this exists so the admin-navigation Playwright
 * test can sign in to the DEV deployment with a purpose-made test account
 * whose secret is supplied via AFLDB_E2E_ADMIN_TOTP_SECRET. It does not
 * weaken the application's auth path in any way — the login form receives
 * a genuine, current code.
 */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, at: Date = new Date()): string {
  const step = Math.floor(at.getTime() / 1000 / 30);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}
