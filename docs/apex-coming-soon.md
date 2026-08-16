# AFLDB — The apex coming-soon page

> **STATUS: LIVE.** `afldb.com`, `www.afldb.com` and `beta.afldb.com` all
> resolve to the droplet, each with its own Let's Encrypt certificate, and the
> apex serves this page over HTTPS. Verified 16 Aug 2026: `http://` 308s to
> `https://` on both apex and www, `www` 301s to the apex, and the page reports
> no mixed content. HSTS on the apex is still deliberately absent — see §7 of
> `deploy/Caddyfile.production` for the ramp.
>
> The page's text and images are edited at **`/admin/content`**, not in this
> repository. See §8.

`afldb.com` gets a real page — what AFLDB is, what it does, screenshots, and a
"Request early access" button — while `beta.afldb.com` keeps serving the gated
application. The apex page is indexable; the beta is not.

## 1. Why the apex is static

The page is plain HTML/CSS/JS served straight from disk by Caddy, **not** by
the Next.js app.

- **It cannot go down with the app.** The apex is the hostname that
  accumulates search history. A static file server does not 502 while
  `afldb` restarts, does not time out on a slow query, and does not care
  whether PostgreSQL is up.
- **It sidesteps three host-aware forks.** The app is beta-gated in
  middleware, its `robots.ts` disallows everything while the gate is on, and
  its `sitemap.ts` advertises thousands of URLs. Serving the apex from the
  app would mean branching all three on `Host`, in code that has no such
  branch today.
- **Nothing is thrown away at launch.** Same hostname, same certificate, same
  logs — only the Caddy block's body changes. See §7.

The one dynamic path is the early-access form's endpoint, which Caddy proxies
to the app on the **same origin**.

```text
afldb.com/                    → /var/www/afldb-soon        (static, indexable)
afldb.com/api/early-access    → 127.0.0.1:3100             (the app)
www.afldb.com/*               → 301 to https://afldb.com
beta.afldb.com/*              → 127.0.0.1:3100             (gated, noindex)
```

## 2. What is in the repository

| Path | What it is |
|---|---|
| `deploy/coming-soon/index.html` | The page **as originally hand-written**. Now a reference copy: the published page is rendered from the database (§8). |
| `deploy/coming-soon/style.css` | The almanac palette, copied from `src/styles/globals.css`. |
| `deploy/coming-soon/app.js` | Fetches the form definition and posts it back. No dependencies. |
| `deploy/coming-soon/robots.txt` | Allows indexing. **Different from the app's.** |
| `deploy/coming-soon/sitemap.xml` | One URL, deliberately. |
| `deploy/coming-soon/img/*.webp` | Seven screenshots, 338 kB in total. |
| `deploy/Caddyfile.production` | The `afldb.com` and `www.afldb.com` blocks. |

The page loads **nothing** from a third party: no fonts, no analytics, no CDN.
Its CSP is correspondingly strict — no `'unsafe-inline'` anywhere, unlike the
application's own.

## 3. Before touching DNS

The application side ships first, because the form endpoint has to exist
before the page can call it.

```bash
cd ~/projects/afldb
git pull
npm ci
npm run db:migrate            # 035_early_access_answers.sql
npm run build
sudo systemctl restart afldb
```

Confirm the endpoint answers, and that it says the form is closed (it is, until
a super admin opens it at `/admin/settings`):

```bash
curl -s http://127.0.0.1:3100/api/early-access
# {"open":false,"intro":"…","questions":[]}
```

## 4. Deploy the page

```bash
sudo mkdir -p /var/www/afldb-soon
sudo cp -r ~/projects/afldb/deploy/coming-soon/. /var/www/afldb-soon/
sudo chown -R caddy:caddy /var/www/afldb-soon
sudo find /var/www/afldb-soon -type f -exec chmod 644 {} +
sudo find /var/www/afldb-soon -type d -exec chmod 755 {} +

sudo cp ~/projects/afldb/deploy/Caddyfile.production /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`caddy validate` **must** pass before the reload. It catches a malformed block;
it does not catch an apex-redirects-to-itself loop, which is why `afldb.com`
and `www.afldb.com` are separate blocks and must stay that way.

## 5. Verify before DNS, then move DNS

With DNS still pointing at the parking host, prove the config against the
droplet directly:

```bash
IP=209.38.87.252
curl --resolve afldb.com:443:$IP https://afldb.com/            | head -20
curl --resolve afldb.com:443:$IP -I https://afldb.com/robots.txt
curl --resolve afldb.com:443:$IP https://afldb.com/robots.txt  # must ALLOW
curl --resolve afldb.com:443:$IP https://afldb.com/api/early-access
curl --resolve afldb.com:443:$IP -I https://www.afldb.com/     # must 301
```

Check that the response carries **no** `X-Robots-Tag` — this host is meant to
be indexed, and that header on the beta block is what keeps the two apart.

Then, at the registrar:

```text
afldb.com.      300  IN  A      209.38.87.252
www.afldb.com.  300  IN  CNAME  afldb.com.
```

Lower the TTL to 300 **at least 24 hours beforehand** if it is currently
higher, so a rollback propagates in minutes. Raise it back to 3600 after 48
hours of stability. Caddy issues the certificate automatically on the first
HTTPS request once DNS resolves.

Add HSTS only after that certificate has issued and the site has served
cleanly for a day or two — ramped, per the comment in the Caddyfile.

## 6. Running the early-access form

### Turning it on

`/admin/settings`, super admin only:

- **Accept requests** — the master switch. Off, the button does not appear and
  the endpoint refuses submissions.
- **Intro text** — shown above the form.
- **Questions** — add, reorder, remove. Each is short text, long text, a single
  choice or **select all that apply**, and can be required.
- **Suggested questions** — a catalogue of ready-made questions (about the
  visitor and their footy, why they want AFLDB, how much beta testing they will
  do, and what skills they could contribute) grouped and ticked on or off
  individually or a section at a time. Their ids are fixed, so unticking one
  stops it being asked without deleting a single answer already given to it,
  and ticking it back on reunites the question with its history. Once added,
  a suggested question is an ordinary question: reword, reorder or delete it.

A "select all that apply" answer is stored as a **list**, not a joined string,
so each tick stays a separate fact; `/admin/access` shows them on one line.
- **Notification** — whether each request is emailed, and to where
  (`requests@afldb.com` by default).

Email address and name are always asked and are not editable: approving a
request allowlists that address in `beta_allowed_emails`, so the flow has no
meaning without it.

**Question ids are stable and answers are keyed by them.** Editing a
question's wording keeps its previous answers readable. Removing a question
hides it from the form but never deletes what people already wrote — old
answers still appear at `/admin/access`, labelled with their bare id and
marked "removed".

### Where requests go

A request **never admits anybody**. It inserts a pending row in
`beta_join_requests`, which a human approves or denies at `/admin/access`;
approving allowlists the email through the normal path. That was already true
of the older form on the `/beta` gate, and is unchanged.

### Email

There was no outbound email in this project before this change. The sender
(`src/lib/email/send.ts`) needs an SMTP **relay** — the droplet is on
DigitalOcean, where outbound port 25 is blocked and mail from a droplet IP is
filed as spam regardless.

Set these in `~/projects/afldb/.env` (mode 600) and restart the service:

```bash
AFLDB_SMTP_HOST=smtp.example.net
AFLDB_SMTP_PORT=587
AFLDB_SMTP_USER=…
AFLDB_SMTP_PASSWORD=…
AFLDB_SMTP_FROM=AFLDB <no-reply@afldb.com>
```

Then use **Send test** on `/admin/settings` to confirm delivery before ticking
the notification box.

The credentials are deliberately **not** editable from the admin UI.
`site_settings` is public-readable by design (migration 034 says so in as many
words), so a relay password in it would be readable by the same database role
that renders the home page. The admin screen configures behaviour; `.env`
holds the secret.

If no relay is configured, the notification checkbox is disabled and says why.
Requests are still saved and still reviewable — delivery is a courtesy on top
of the database row, never a precondition for it.

## 7. What changes at the real launch

When the application takes over the apex:

1. In `deploy/Caddyfile.production`, delete the two `handle` blocks from the
   `afldb.com` site and give it the same `reverse_proxy` body
   `beta.afldb.com` has.
2. Delete `/var/www/afldb-soon`.
3. The app's own `robots.ts` and `sitemap.ts` take over — set
   `AFLDB_ENV=production` and turn the beta gate off, or they will keep
   serving `Disallow: /`.
4. Decide what `beta.afldb.com` becomes. Leaving it serving the same app on a
   noindex header is fine; pointing it at the apex is tidier.

The hostname, the certificate and the accumulated search history all carry
over untouched. That is the point of putting a real page here now.

## 8. Editing the page — `/admin/content`

The page's words and pictures are **content, not code**. A super admin edits
them at `/admin/content` and presses Save; nothing here needs a deploy.

### The application publishes the page, it does not serve it

This is the whole design, and it is what keeps §1 true. Saving writes the two
documents to PostgreSQL and then **renders the page to disk** at
`AFLDB_APEX_DIR`. From that moment Caddy serves plain files with the
application entirely out of the path — so the apex still cannot 502 because
the app restarted, cannot time out on a slow query, and does not care whether
PostgreSQL is up. The strict CSP survives too, because nothing published is
inline.

```text
/admin/content  ──save──▶  PostgreSQL          (the source of truth)
                              │
                              ├─ renders ─▶ /var/www/afldb-soon/index.html
                              └─ writes  ─▶ /var/www/afldb-soon/img/u/*
                                                    │
                              visitor ──▶ Caddy ────┘   (app not involved)
```

`/var/www/afldb-soon` is therefore **derived and disposable**. Everything in
it comes either from `deploy/coming-soon/` in git or from the database, so
deleting the directory and pressing **Republish** is a complete recovery.

### What is editable

Every text field, the images, and the two repeating card lists — the "What it
does" features and the "Built like a record book" notes can be added to,
removed and reordered. Images are uploaded from any slot, stored in
`site_media` (migration 037, revoked from the public role by 038) and written
to `img/u/` on publish. An upload is
identified by its **magic bytes**, not its name or declared type: PNG, JPEG
and WebP only, 2 MB each.

The canonical URL, `og:url` and the origin of `og:image` are **not** editable.
They are deployment facts, and a typo in one is invisible on the page and
expensive in the index.

### The hero statistics are now live

The four figures are read from the database **at publish time**, using the
same query the application's own home page uses, so the two can never
disagree. This retires the standing chore this section used to describe. Any
figure can still be overridden with fixed text; clearing the box hands it back
to the database.

### Republish

Save publishes automatically. **Republish** rebuilds the directory from what
is already stored, without saving anything, and is the answer to all three of:

- the server was rebuilt, or `/var/www/afldb-soon` was deleted
- a deploy changed `style.css`, `app.js` or a shipped screenshot — those come
  from git, so they only reach the apex on a publish
- a publish failed and the cause has been fixed

### Configuration

`AFLDB_APEX_DIR` must be set **only on the host that serves the apex**. Unset
means "save to the database, publish nothing", which is the correct state in
development, and the admin screen says so rather than failing. The production
droplet additionally needs the `ReadWritePaths=/var/www/afldb-soon` line in
`deploy/afldb.service` — the service is `ProtectSystem=strict`, so without it
every publish fails with `EACCES` — and the directory must be owned by the
service user:

```bash
sudo chown -R arm:caddy /var/www/afldb-soon
sudo chmod 750 /var/www/afldb-soon
```

### Screenshots

The originals were captured at 1440×900, device scale 2, dark theme except the
one light pairing, cropped to 16:10 and re-encoded as WebP at quality 82,
driving a real browser through the beta gate with an access code cut at
`/admin/access`. Replacements are uploaded through `/admin/content` and need
no particular size, but matching that recipe keeps the page looking of a piece.
