# AFLDB — The apex coming-soon page

> **STATUS: BUILT, NOT DEPLOYED.** `afldb.com` still resolves to a parked ad
> page on another host. Nothing in this document has been run.

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
| `deploy/coming-soon/index.html` | The page. Metadata, JSON-LD, copy. |
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
- **Questions** — add, reorder, remove. Each is short text, long text or a
  choice, and can be required.
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

## 8. Keeping the page current

The hero statistics (13,361 players, 17,027 matches, 130 seasons, 694,209
player games) and the screenshots are a **snapshot**. They only move when a
season is loaded. Refresh both together, then re-copy to `/var/www/afldb-soon`.

Screenshots were captured at 1440×900, device scale 2, dark theme except the
one light pairing, cropped to 16:10 and re-encoded as WebP at quality 82. The
capture drives a real browser through the beta gate with an access code cut at
`/admin/access`.
