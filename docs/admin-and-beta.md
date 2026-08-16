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

**`afldb_app` must not be able to *read* the operational tables either.**
That used to take more than never granting it: `public` carried a
schema-wide default privilege (set during role setup) that handed
`afldb_app` `SELECT` on every table `afldb_owner` created, statistical or
not. Migration 023 assumed omission was enough and was wrong (fixed by
031); migration 037 read 031's warning, reasoned about it, and made the
same mistake with `site_media` (fixed by 038).

Twice was enough. **Migration 039 inverted the default**, so the rule is
now the opposite of what it was:

- A new table in `public` is **unreadable** by `afldb_app` until someone
  says otherwise. Forgetting denies access; it no longer grants it.
- A statistical table opts in with one line in its own migration:
  `SELECT afldb_meta.grant_app_read('my_table');`, which registers it in
  `afldb_meta.app_readable_tables` and grants the `SELECT` together.
- An operational table does nothing at all and is safe.
- `tests/integration/privileges.test.ts` asserts that what `afldb_app`
  can read is exactly what the registry lists, so an unclassified table
  fails CI whichever kind it is — and separately asserts that no default
  privilege has crept back.

The registry is a table rather than a list in a script because a
`pg_restore` runs with `--no-privileges`: the dump carries the registry,
so `npm run db:privileges` can rebuild the entire grant model from the
backup. See `docs/backup-restore.md` §6.

`afldb_import` is confined the same way (039): the identical default
privilege had given the ETL role full write plus `TRUNCATE` on every
operational table, including `auth_users` and `site_media`. It now holds
the statistical tables and migration 023's narrow submission read.

`site_settings` (migration 034) is the one deliberate exception: the
public role is *meant* to read it, because the home page renders the
layout and record-of-the-week choices stored there. It holds no secret
and never should; the write grant is still `afldb_auth`'s alone, and the
"holds no write privilege on any table" assertion covers it like every
other table. It is registered in
`afldb_meta.app_readable_tables` and listed in the test's positive read
check, rather than in `OPERATIONAL_TABLES`.

### One-time setup on the server

```bash
sudo bash ~/projects/afldb/tools/maintenance/02_add_auth_role.sh   # creates afldb_auth, updates .env
npm run db:migrate                                                 # migration 023 (order with the script doesn't matter)
sudo systemctl restart afldb
```

The script APPENDS to `.env` (`AFLDB_AUTH_DATABASE_URL`,
`AFLDB_SESSION_SECRET`); it never rewrites it, unlike the full installer.

## 2. Administrators

Three roles: `admin`, `super_admin` and `contributor`. A super admin may
always invite and manage other admins; a plain admin may only if a super
admin has ticked `can_manage_admins` for their account — a delegated
power, independent of role, granted per account rather than by promoting
someone outright.

A `contributor` is upload-only: they sign in the same way (password +
TOTP) but `requireAdmin()` (`src/lib/auth/session.ts`) redirects that
role to `/admin/upload` rather than admitting it, so every existing
admin page and action is closed to a contributor without needing its
own check. `requireUploader()` is the narrower guard, used only by the
upload page/action and by the submission-status page (which additionally
checks the submission belongs to that contributor) — reach for
`requireAdmin()` everywhere else, and it will keep a contributor out
correctly on its own.

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
delegated admin manager can invite a plain admin or a contributor, never
a peer or better, so delegation can never compound.

Creating an invite writes a row to `admin_invites` (only the token's
sha256, exactly like `beta_login_tokens`) with a 7-day expiry, and
returns the link **once**, in the page, for the inviting admin to copy
and send however they like — there is no email sending, matching the
beta-access codes above.

Because accepting an invite upserts on email (see below), an invite aimed
at an address that already has an account is a **credential reset** for
it, not just a new account — so the same "never a peer or better" line is
drawn over the target as over the role. A delegated admin manager may
only invite an address that is free or belongs to a contributor;
`createInvite` refuses one that already belongs to an admin or super
admin and audits the refusal as `admin.invite_refused`. Acceptance checks
again, and independently: `confirmEnrolment` refuses to overwrite an
account whose current role outranks what the invite grants
(`admin.invite_rejected`), which is what covers an invite issued before
the target was promoted. Between them, an invite can never be the route
by which someone is demoted or locked out.

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

### Site settings (`/admin/settings`, super admin only)

The handful of choices that used to be hard-coded, stored one jsonb row
per key in `site_settings` (migration 034) and audited as
`settings.saved`:

| Key | Controls |
|---|---|
| `home.sections` | Which of the four home-page blocks are shown, and in what order. Applies to `/` and `/aflw` alike — the two pages carry the same layout, so one setting drives both. |
| `home.record_of_the_week` | Which career record the AFL front page leads with. Limited to the five categories the career leaderboard can answer. |
| `home.aflw_leaders` | The AFLW counterpart, ranked off `aflw.player_careers`. |
| `grid_solver.audience` | Who may reach `/grid-solver`: super admins (default), admins, any signed-in staff account, or everyone. |
| `site.footer` | The colophon under **every** page of the site and under the apex coming-soon page. Edited at `/admin/content`, not here. |
| `apex.content` | The whole coming-soon page: copy, images, cards, search metadata. Edited at `/admin/content`. Excluded from the settings read on public pages — it is kilobytes of prose that nothing on the site renders. |

Not open to a plain admin, delegated or not: what the front page shows
and who may reach the grid solver are publication decisions, the same
line `requireSuperAdmin()` already draws for the query builder.

Every value is re-parsed on the way in through the same functions the
read path uses (`src/lib/site-settings.ts`), so a hand-posted form field
lands on the default rather than in the database. On the way out, a row
that names a section this build no longer has is dropped and a new one is
appended, which is what lets a settings row survive a deploy in either
direction. Saving revalidates both home pages, which are otherwise
ISR-cached for an hour.

### Page content (`/admin/content`, super admin only)

The text and images of the two pages a super admin writes rather than
codes: the coming-soon page at `afldb.com`, and the footer every page
carries. Audited as `content.saved`, `content.published`,
`content.media_uploaded` and `content.media_deleted`.

The footer is one document shared by both renderers — the root layout
draws it under every application page, and the publisher writes the same
lines into the static apex page — so the two colophons cannot drift
apart. The apex omits the "About this data" link, having no `/about` of
its own to point at.

Saving also **publishes**: the apex page is rendered and written to
`AFLDB_APEX_DIR`, where Caddy serves it as static files. The application
is that page's publisher, never its server, which is what preserves the
reliability argument in `docs/apex-coming-soon.md` §1. The database is
written first and the files second, so a failed publish costs the publish
alone and **Republish** is the whole retry. Full details in
`docs/apex-coming-soon.md` §8.

Uploaded images live in `site_media` (migration 037; readable by
`afldb_auth` only, which 038 had to revoke and 039 made the default), not
on disk: the
nightly dump then covers them, the published directory stays derived, and
the service needs no second writable path. An upload is identified by its
**magic bytes** — `src/lib/image-probe.ts` — so neither the file name nor
the declared `Content-Type` decides what gets written into a directory a
web server publishes.

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

  Ticking **Unlimited** stores a NULL `max_uses` (migration 036), which
  the redeem query reads the same way it already reads a NULL
  `expires_at`: no cap. That is the right shape for a standing code held
  by a small group of trusted testers, where an arbitrary number would
  only run out at an inconvenient moment. It still expires, `use_count`
  still counts, and revoking still stops it — unlimited means uncapped,
  not unrevocable. Everything else stays single-use by default, and the
  uncapped case cannot be reached by fumbling the form: the checkbox has
  to be ticked deliberately.
* **Allowlisted emails** — the visitor requests a single-use, 30-minute
  magic link on `/beta`. The response never reveals whether the address
  was on the list. Configure an SMTP relay (`AFLDB_SMTP_*`, see
  [apex-coming-soon.md](apex-coming-soon.md) §6) and the link is
  delivered; without one it is written to the service log instead:
  `journalctl -u afldb | grep magic`. Revoking the email wins even
  against an already-issued, unclicked link.
* **Early access requests** — a visitor with neither can ask, either on
  `/beta` or through the form on `afldb.com`. Both queue a pending row
  for review here; neither admits anybody. The apex form's questions are
  configured at `/admin/settings`.

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
| `match_results` | `matches` | One row per match: `season, round_code, match_date, venue, home_club, away_club, home_score, away_score`, optional goals/behinds/attendance |
| `player_match_stats` | `player_match_stats` | One row per player per match: `season, round_code, home_club, away_club, player, club`, plus the box score (kicks, disposals, goals, …) |

A sample CSV for every registered dataset is linked from `/admin/upload`
itself (`public/samples/<dataset-key-with-dashes>.csv`) — a format
template with placeholder rows, not real data to promote as-is.

Adding a dataset is one `DatasetSpec` in `src/lib/ingest/datasets.ts`
(columns, file key, per-row validator, per-row upsert); the UI and
pipeline are generic. `awardSlug` is optional on a spec — set it only
for datasets that feed the `awards` tables; `match_results` and
`player_match_stats` feed their fact tables directly and leave it unset.

**Match/player-stat datasets differ from the award ones in one
important way**: `matches.home_club_id`/`away_club_id` and
`player_match_stats.player_id` are all `NOT NULL`, so unlike an
unmatched player on an award row (a warning, imported unlinked with the
source spelling), an unmatched club or player on these two datasets is
a hard **error** — there is no unlinked representation the schema can
hold for a match or a player-game row. `player_match_stats` also
requires its match to already exist (upload `match_results` first);
`resolveMatch()` looks it up by season, round and the two clubs.

Promoting either of these two datasets changes source-of-truth fact
tables that `player_career_stats` (and Advanced Search) are derived
from. Run `tools/migration/rebuild_derived.py` afterward — the
submission page does not trigger this automatically.

## 5. Email-in CSV intake

A second channel into the same pipeline, for an admin who would rather
email a file than open the browser. `tools/email_intake/
fetch_and_stage.py` polls a mailbox on a systemd timer; for each unseen
message it finds with a CSV attachment, it reads the **subject line as
the dataset key** (`match_results`, `player_match_stats`,
`rising_star`, `all_australian` — spaces become underscores, so
"match results" also works) and POSTs the attachment to
`POST /api/admin/email-intake`.

**This route is authenticated by a shared secret
(`AFLDB_EMAIL_INTAKE_SECRET`), never a session** — the poller runs
unattended on the server, machine to machine. The secret proves the
*caller* is the trusted poller; it says nothing about who *sent* the
email, so the route independently re-resolves the claimed `From`
address against `auth_users` itself and refuses anything that is not a
known, enabled account. Nothing the poller or the email claims is
trusted beyond that.

Contributors count as senders here, the same as they do at
`/admin/upload`: this is that form's email counterpart, submitting data
is the whole reason the role exists, and an emailed file reaches exactly
as far as a web upload does — staged and validated, with an admin still
reviewing before promotion.

**The script never touches PostgreSQL directly** and carries no
database credential — it calls `stageSubmission` then
`validateSubmission` through the HTTP route, the exact same two pipeline
functions `/admin/upload`'s form calls. Deliberately **not**
`promoteSubmission`: an emailed file reaches `staged`/`validated` only,
exactly like a web upload, so a human still reviews the report and
approves/promotes at `/admin/submissions/<id>`. "Processed by a
script" means *validated*, not auto-applied — nothing about this
channel is allowed to bypass the human-approval step the web path has.

The script never deletes mail. A processed message — success or
failure — is copied to a `Processed` or `Errors` IMAP folder (created
automatically) and marked `\Seen` so it is not picked up again; the
original always stays in the mailbox as a record.

### One-time server setup

```bash
# .env: AFLDB_EMAIL_INTAKE_SECRET and AFLDB_INTAKE_IMAP_* (see .env.example)
sudo cp deploy/afldb-email-intake.service deploy/afldb-email-intake.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now afldb-email-intake.timer
```

Polls every 5 minutes (`OnUnitActiveSec=5min` in the timer unit).
`journalctl -u afldb-email-intake` shows each run. Dry-run without
touching the mailbox or the app: `python3 tools/email_intake/
fetch_and_stage.py --dry-run`.

## 6. Bulk award history (Phase 3b)

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
