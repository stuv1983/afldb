# AFLDB — Administration, beta access and vetted data uploads

How data gets into AFLDB after the bulk migration, and who gets into AFLDB
before public launch. One access model serves both.

## 1. Roles: who may write what

| Role | Used by | May write |
|---|---|---|
| `afldb_app` | the public site | **nothing** (read-only, verified by test) |
| `afldb_auth` | login, beta gate, uploads | only the migration-023 operational tables |
| `afldb_import` | ETL tools **and submission promotion** | statistical tables |
| `afldb_owner` | migrations | schema |

The public site cannot write statistics; the auth path cannot write
statistics; a vetted submission is promoted by the same import role, with
the same import-batch bookkeeping, as the bulk migration. There is one
way into the statistical tables.

### One-time setup on the server

```bash
sudo bash ~/projects/afldb/tools/maintenance/02_add_auth_role.sh   # creates afldb_auth, updates .env
npm run db:migrate                                                 # migration 023 (order with the script doesn't matter)
sudo systemctl restart afldb
```

The script APPENDS to `.env` (`AFLDB_AUTH_DATABASE_URL`,
`AFLDB_SESSION_SECRET`); it never rewrites it, unlike the full installer.

## 2. Administrators

Two roles: `admin` and `super_admin`. A super admin may always invite and
manage other admins; a plain admin may only if a super admin has ticked
`can_manage_admins` for their account — a delegated power, independent of
role, granted per account rather than by promoting someone outright.

### The first super admin

There is no invitation without an existing super admin to send one, so the
very first account is always minted from the server shell:

```bash
AFLDB_ADMIN_PASSWORD='a-long-password' npx tsx tools/admin/create-admin.ts you@example.com super_admin
```

The tool prints a TOTP secret and `otpauth://` URI **once**. Enter it
into an authenticator app immediately: sign-in at `/admin/login` always
requires the password **and** a current 6-digit code. Re-running the tool
for the same email resets the password, role and secret, and revokes every
live session for that account. Omit the role (or pass `admin`) for a plain
admin created the same way.

### Every subsequent admin: invited from the web

A super admin (or a delegated admin manager) creates an invite at
`/admin/admins` — see "Inviting a new admin" below. The invitee sets their
own password and scans a QR code to enrol MFA; nobody but them ever sees
their TOTP secret, which the CLI path above cannot say. The CLI remains
available for break-glass account recovery.

### Inviting a new admin

`/admin/admins` shows an "Invite an admin" form to anyone with admin-
management access. Only an actual `super_admin` may set the invited
role to `super_admin` or tick "can also invite/manage admins" — a
delegated admin manager can only invite plain admins, so delegation can
never compound into a peer or better.

Creating an invite writes a row to `admin_invites` (only the token's
sha256, exactly like `beta_login_tokens`) with a 7-day expiry, and
returns the link **once**, in the page, for the inviting admin to copy
and send however they like — there is no email sending, matching the
beta-access codes above.

Accepting an invite at `/admin/invite/<token>` is two steps, and nothing
sensitive ever round-trips through the browser between them:

1. **Choose a password.** The server hashes it and mints a fresh TOTP
   secret, storing both on the invite row (`pending_password_hash`,
   `pending_totp_secret`) — the `auth_users` row does not exist yet.
2. **Scan the QR code and confirm a live code.** The secret is rendered
   as a scannable QR (`qrcode`'s `toDataURL`, the same library the CLI
   already depends on) with the raw key available only as a "can't scan
   it?" fallback. Only once a real 6-digit code from that secret
   verifies does the server create (or update, on a re-invited email)
   the `auth_users` row, immediately burn that code's step the same way
   login does, revoke any sessions the email already had, and mark the
   invite used.

An invite that is never finished leaves no account behind — only a dead
row in `admin_invites` with a password hash and secret nobody can reach
without also holding the one-time link. `/admin/invite/*` is reachable
without a session (the unguessable token in the path is the gate, same
trust model as `/beta/verify`); every write it triggers still goes
through `afldb_auth`, same as everything else in this document.

Passwords are scrypt-hashed (N=2¹⁵, r=8, p=1); TOTP is RFC 6238 with ±1
step of drift; both are implemented on Node's own crypto with no
third-party auth dependency. Each code is accepted **once**: the step it
matched is recorded in `auth_users.totp_last_step` by the same statement
that tests it, so the next sign-in needs a code from a later step and a
code read over your shoulder is dead as soon as you have used it. A
consequence worth knowing at the terminal: signing in twice inside the
same 30-second window means waiting for the authenticator to roll.

Admin sessions are database rows (sha256 of the cookie token),
individually revocable, 12-hour TTL. Everything an administrator does
lands in `auth_audit_log`, which the app role can only INSERT into.

## 3. Beta gate

```
AFLDB_BETA_GATE=on     # in .env, then restart
```

While on, every page except `/beta`, `/beta/verify`, `/admin/login`,
`/api/health` and `/robots.txt` redirects to `/beta`, and robots.txt
serves disallow-all. Two ways in, both managed at `/admin/access`:

* **Access codes** — created with a label ("Dave from the footy forum"),
  a use limit and an expiry. The clear text is shown once at creation;
  only its sha256 is stored. Redemption is atomic, so a code cannot be
  double-spent. Revoking a code stops new admissions.
* **Allowlisted emails** — the visitor requests a single-use, 30-minute
  magic link on `/beta`. The response never reveals whether the address
  was on the list. Until SMTP exists the link is written to the service
  log: `journalctl -u afldb | grep magic`. Revoking the email wins even
  against an already-issued, unclicked link.

Admission sets a signed 90-day cookie carrying a **revocation epoch**.
Bumping `AFLDB_BETA_EPOCH` invalidates every outstanding admission at
once — the kill switch. Admin sessions pass the beta gate.

Middleware verifies signatures only (edge runtime, no database); admin
pages re-check their session against the database on every request.

## 4. Vetted data uploads

`/admin/upload` accepts a CSV (≤5 MB) for a registered dataset and walks
it through:

```
staged  ->  validated  ->  approved  ->  promoted
                     \->  rejected        \->  failed (rolled back)
```

* **Staged** — the file is stored byte-for-byte (`data_submissions.content`)
  with its sha256, and parsed into per-row JSON. Malformed CSV, missing
  columns or an oversized file are refused with the reason.
* **Validated** — every row gets `ok` / `warning` / `error` with reasons:
  unknown seasons and duplicate keys are errors; a player or club the
  resolver cannot confidently identify is a **warning**, because
  importing the source spelling unlinked is AFLDB's standard treatment,
  not a failure. Player resolution uses name + season + club stint and
  never guesses between candidates.
* **Approved** — a human read the report. The transition is guarded in
  SQL: a file with error rows cannot be approved.
* **Promoted** — applied in ONE transaction under `afldb_import`,
  recorded as an import batch (`tool = 'admin-upload'`), upserting by
  `(award_id, source_record_id)` so re-promoting a corrected file
  updates rather than duplicates. Any failure rolls the whole thing back
  and marks the submission `failed` with the error.

### Registered datasets

| Key | Feeds | Layout |
|---|---|---|
| `rising_star` | `award_nominations` | FootyWire export (`source_key, season, round_number, player, club`, stats…) |
| `all_australian` | `award_winners` | DraftGuru export (`Player, Club, Position, Captain, Year`) |

Adding a dataset is one `DatasetSpec` in `src/lib/ingest/datasets.ts`
(columns, file key, per-row validator, per-row upsert); the UI and
pipeline are generic.

## 5. Bulk award history (Phase 3b)

The historical award load remains a Python importer, run on the server:

```bash
.venv/bin/python tools/migration/import_awards.py            # idempotent full reload
.venv/bin/python tools/migration/import_awards.py --list-groups
```

It fills `awards` (39 definitions), `award_winners` (2,968 rows: 1,810
draftguru awards + 1,158 All-Australian selections from two sources),
`award_nominations` (766 Rising Star), `hall_of_fame` (343),
`honour_team_members` (113) and `captaincies` (1,375). Groups that share
tables (`awards`, `all_australian`, `rising_star`) are pulled in
together automatically so a partial run cannot cascade-empty another
group's rows.

Club references resolve through the identity of the era (a 1980 Charles
Sutton Medal reads **Footscray**), and names the sources could not link
to a player are imported unlinked with the source spelling preserved —
95 Hall of Fame inductees and the pre-1979 All-Australians are
state-league figures with no VFL/AFL record, and that is stated on the
pages rather than hidden.
