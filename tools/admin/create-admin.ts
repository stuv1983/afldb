#!/usr/bin/env tsx
/**
 * Create or reset an administrator account.
 *
 *   npx tsx tools/admin/create-admin.ts admin@example.com
 *
 * Prompts for the password without echoing it, so nothing sensitive
 * reaches shell history or `ps` output. For an unattended run, set
 * AFLDB_ADMIN_PASSWORD instead — but note that an inline
 * `AFLDB_ADMIN_PASSWORD=... npx tsx ...` DOES land in shell history.
 *
 * Runs on the server, against AFLDB_AUTH_DATABASE_URL. Prints the TOTP
 * secret, otpauth:// URI and a scannable QR code ONCE — enter it into an
 * authenticator app (by scan or manual entry) before signing in, because
 * login requires the code from day one.
 *
 * Re-running for an existing email resets the password and secret and
 * revokes every live session for that account.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';

import postgres from 'postgres';
import QRCode from 'qrcode';

// Reuse the app's own crypto so the CLI and the login path can never
// disagree about hash formats.
import { generateTotpSecret, hashPassword, totpUri } from '../../src/lib/auth/crypto';
import { CTRL_C, applyEditing, takeLine } from '../../src/lib/auth/line-input';

const MIN_PASSWORD_LENGTH = 12;

function loadEnv(): void {
  // Same tolerant .env loader the migration tools use, inlined to keep
  // this runnable with npx tsx alone.
  const file = resolve(__dirname, '../../.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (!(key in process.env)) process.env[key.trim()] = rest.join('=').trim();
  }
}

/**
 * Input that arrived after the line the previous prompt consumed.
 *
 * A terminal delivers whatever is available in one chunk, so a paste —
 * or any input arriving faster than a keystroke at a time — can carry
 * both the password and its confirmation in a single read. Discarding
 * the remainder would leave the second prompt waiting forever for
 * something already delivered.
 */
let pendingInput = '';

function promptHidden(question: string): Promise<string> {
  stdout.write(question);

  // Satisfy the prompt from input already buffered, without touching the
  // terminal again.
  const buffered = takeLine(pendingInput);
  if (buffered) {
    pendingInput = buffered.rest;
    stdout.write('\n');
    return Promise.resolve(applyEditing(buffered.line));
  }

  return new Promise((accept) => {
    let buffer = pendingInput;
    pendingInput = '';

    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const detach = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };

    const onData = (chunk: string) => {
      // Ctrl-C must leave the terminal usable: raw mode does not restore
      // itself, and an abandoned prompt would eat the shell.
      if (chunk.includes(String.fromCharCode(CTRL_C))) {
        detach();
        process.exit(130);
      }
      buffer += chunk;
      const taken = takeLine(buffer);
      if (!taken) return;
      pendingInput = taken.rest;
      detach();
      accept(applyEditing(taken.line));
    };

    stdin.on('data', onData);
  });
}

async function main(): Promise<number> {
  loadEnv();

  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: npx tsx tools/admin/create-admin.ts admin@example.com');
    return 1;
  }

  const dsn = process.env.AFLDB_AUTH_DATABASE_URL;
  if (!dsn) {
    console.error(
      'AFLDB_AUTH_DATABASE_URL is not set. Run tools/maintenance/02_add_auth_role.sh first.',
    );
    return 1;
  }

  let password = process.env.AFLDB_ADMIN_PASSWORD ?? '';
  if (!password) {
    if (!stdin.isTTY) {
      console.error('Set AFLDB_ADMIN_PASSWORD (no terminal available to prompt on).');
      return 1;
    }
    password = await promptHidden(`Password for ${email}: `);
    const again = await promptHidden('Confirm password: ');
    if (password !== again) {
      console.error('Passwords did not match.');
      return 1;
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Refusing: the password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    return 1;
  }

  const sql = postgres(dsn, { max: 1, onnotice: () => {} });
  try {
    const passwordHash = await hashPassword(password);
    const secret = generateTotpSecret();

    await sql`
      INSERT INTO auth_users (email, role, password_hash, totp_secret)
      VALUES (${email}, 'admin', ${passwordHash}, ${secret})
      ON CONFLICT (email) DO UPDATE
        SET password_hash  = EXCLUDED.password_hash,
            totp_secret    = EXCLUDED.totp_secret,
            -- A new secret starts a new counter. Carrying the old step
            -- over would reject every code from the fresh authenticator
            -- until the clock passed it, which for a reset performed
            -- minutes after the last sign-in is a locked-out admin.
            totp_last_step = NULL,
            disabled_at    = NULL
    `;
    // A reset invalidates every live session for the account.
    await sql`
      UPDATE auth_sessions SET revoked_at = now()
       WHERE user_id = (SELECT id FROM auth_users WHERE email = ${email})
         AND revoked_at IS NULL
    `;

    console.log(`\nAdministrator ${email} is ready.\n`);
    console.log('Add this to your authenticator app NOW (shown only once):\n');
    // Grouped for typing, unbroken for pasting. Authy, Google
    // Authenticator and 1Password all strip the spaces; a few older apps
    // do not, which is why the raw form is offered as well.
    console.log(`  Secret (to type)  : ${secret.replace(/(.{4})/g, '$1 ').trim()}`);
    console.log(`  Secret (to paste) : ${secret}`);
    console.log(`  Settings          : time-based, SHA-1, 6 digits, 30 seconds`);
    console.log(`  URI (for a QR)    : ${totpUri(secret, email)}\n`);
    console.log('Scan this with your authenticator app (or enter the secret above manually):\n');
    console.log(await QRCode.toString(totpUri(secret, email), { type: 'terminal', small: true }));
    console.log('Authy: Add Account -> Enter key manually -> paste the secret,');
    console.log('and make sure the token length is set to 6 digits, not 7 or 8.\n');
    console.log('Sign in at /admin/login with the password and a current code.');
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then((code) => process.exit(code));
