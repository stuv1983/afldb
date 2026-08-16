# SEO

What AFLDB tells search engines, and where each decision lives in the code.

This is the durable half of the August 2026 pre-launch SEO audit. The audit's
findings and priorities are a point-in-time document; the policies below are
the ones a new route has to follow.

---

## 1. The indexing gate

Two independent flags, and they must not be conflated again.

| Flag | Decides | Read by |
| --- | --- | --- |
| `AFLDB_ENV=production` | Transport security: Secure cookies, HSTS, the CSP without `unsafe-eval` | `next.config.ts`, `src/lib/auth/session.ts` |
| `AFLDB_INDEXING=on` | Whether this deployment may be indexed | `src/lib/indexing.ts` |

`indexingEnabled()` fails closed, and the beta gate overrides it regardless: a
crawler behind a gate can only index the door. Four things read that one
predicate, so they cannot disagree:

- the root layout's `robots` metadata (`src/app/layout.tsx`)
- `robots.txt` (`src/app/robots.ts`)
- the sitemap index (`src/app/sitemap.xml/route.ts` — 404 when off)
- every sitemap segment (`src/app/sitemap.ts` — empty when off)

`deploy/Caddyfile.production` adds `X-Robots-Tag: noindex, nofollow` on the
beta host as belt to those braces, covering responses the proxy generates
itself. **Remove that header when the file is switched to serve the apex.**

`AFLDB_BASE_URL` becomes `metadataBase`. On an indexed host it must be the
bare production origin over https. `siteUrlProblem()` states the rule and
`tests/seo.test.ts` fails the build on any host where indexing is on and the
base URL is not publishable.

---

## 2. What is indexable

**Indexable** — one permanent URL, content from a fixed query:

```
/                              /records/{category}
/players/{slug}-{id}           /brownlow            /brownlow/{year}
/players/{slug}-{id}/matches   /awards              /awards/{slug}
/clubs/{slug}                  /awards/{slug}/{season}
/seasons/{year}                /hall-of-fame        /honour-teams/{slug}
/matches/{id}                  /draft               /venues  /venues/{slug}
/players  /clubs  /seasons  /records  /match-search  /players/compare  /about
/aflw and every /aflw/… equivalent
```

**Crawlable but not indexable** (`noindex, follow`) — a view OF an indexable
page. Filtered, sorted or paged states of any list surface. They stay
`follow` because their links are how a crawler reaches players deep in a
result set.

**Not crawled** (`Disallow` in `robots.txt`) — `/api/`, `/admin`, `/beta`,
`/search`, `/grid-solver`.

**Redirects, never indexed** — `/advanced-search` (308 to `/players`), a stale
player slug, a mixed-case club or venue slug.

### Why filtered states are `noindex` rather than canonicalised

The canonical on a filtered list already points at the bare path. Left at
that alone, the site would be asking Google to fold materially different
result sets into one URL — the one canonical mistake that gets canonicals
ignored wholesale. `noindex, follow` says the same thing truthfully.

The combinatorial space behind `/players` is unbounded, but the **discoverable**
space is not: filters are a GET form, not a grid of links, so a crawler only
finds the five example searches, the seven sort links and the pager. If server
logs later show crawl waste, the next lever is `Disallow: /*?*_min=` and
`/*?*_max=` — not before, because a robots.txt disallow also hides the
`noindex` from the crawler that would act on it.

---

## 3. Writing metadata for a new route

Use `pageMetadata` from `src/lib/seo.ts`. Never hand-assemble a `Metadata`
object: three things go wrong silently if you do.

```ts
export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Venues — Every Ground Since 1897',
  description: '…',
  path: '/venues',
});
```

For a route that reads `searchParams`:

```ts
export async function generateMetadata({ searchParams }): Promise<Metadata> {
  return pageMetadata({ …, path: '/players', noindex: isFilteredView(await searchParams) });
}
```

What it handles that hand-written metadata does not:

1. **`og:url`.** Next emits it only when `openGraph.url` is set explicitly.
2. **The wholesale `openGraph` replacement.** Next replaces this object
   between segments rather than merging it, so a page that sets its own loses
   the root layout's `siteName` and `locale`.
3. **`robots`.** `pageMetadata` only ever emits a NEGATIVE. A page that set
   `index: true` would override the deployment gate and publish a beta one
   page at a time.

Use `notFoundMetadata('Player')` on the miss branch of a `generateMetadata`.

### Title templates

`Primary entity + search intent | AFLDB`, where the suffix comes from the root
layout's template. Aim for under 60 characters before the suffix.

| Page | Template |
| --- | --- |
| Player | `{name} — {VFL\|AFL} Stats, Games & Career Record` |
| Club | `{name} — Players, Seasons, Records & History` |
| Season | `{year} {league} Season — Ladder, Results & Finals` |
| Match | `{home} v {away} — {round}, {season} {league}` |
| Venue | `{name} — AFL/VFL Matches & Venue Record` |
| Record board | `{title} — {Career\|Single-Match\|Single-Season} VFL/AFL Record` |
| Brownlow year | `{year} Brownlow Medal — Winner, Votes & Leaderboard` |
| Award | `{name} — Every Winner and Full History` |
| Award season | `{year} {name} — Winner and Full Result` |
| AFLW | `{entity} — AFLW …`, always naming the competition |

**The competition name follows the record, not the search volume.** A career
that ended before 1990 is a VFL career and a 1954 final was a VFL match;
`leagueOf()` on the player route and `season.league` on the season route both
encode that. Writing "AFL" everywhere would be keyword consistency bought with
a false statement.

### Descriptions

One or two factual sentences built from the row, ~120–170 characters. Every
clause conditional on the datum existing — `careerSentence()` on the player
route omits the Brownlow clause entirely rather than writing "0 Brownlow
votes" about a player who retired in 1910. That is the NULL-versus-zero rule
of `src/lib/format.ts` applied to metadata.

---

## 4. Structured data

Builders live in `src/lib/structured-data.ts` and render through
`<JsonLd data={…} />`. Serialisation goes through `jsonLdHtml`, which escapes
`<` so a club nickname containing `</script>` cannot close the element early.

| Type | Where |
| --- | --- |
| `WebSite` (+ `SearchAction`, `Organization` publisher) | home page only |
| `BreadcrumbList` | every page using `<Breadcrumbs>` |
| `Person` | `/players/{slug}-{id}` |
| `SportsTeam` | `/clubs/{slug}` |
| `SportsEvent` | `/matches/{id}` |
| `ItemList` | `/records/{category}` and `/brownlow/{year}`, unfiltered only |

Rules:

- `compact()` drops any property whose value is null, undefined or empty. A
  property is emitted only when the database holds the fact.
- A disputed date of birth is **omitted**. The page shows the conflict;
  JSON-LD has no way to, and publishing one side would assert it as settled.
- A historical club identity is a `SportsTeam` under its own name, with the
  modern name as `alternateName`. Never renamed.
- An `ItemList` is emitted only for the whole board. A filtered cut is a
  different, shorter list under the same URL, and marking it up as the record
  would misstate it.
- No `attendance`, no scoreline, no `eventStatus` on `SportsEvent`:
  Schema.org has no property that means those things here, so they stay in
  the description as prose rather than being claimed structurally.

---

## 5. Sitemaps

`/sitemap.xml` is an index over segments at `/sitemap/{id}.xml`.

| Segment | Contents |
| --- | --- |
| 0 | static routes, clubs, seasons, venues |
| 1 | the curated landing pages: record boards, Brownlow counts, awards, award seasons, honour teams, Hall of Fame |
| 100+ | players, 5,000 per file |
| 200+ | matches, 5,000 per file |
| 300 | the whole AFLW competition |

Inclusion rules: canonical URLs only; nothing `noindex`; no parameters; no
redirect sources; nothing when `indexingEnabled()` is false.

**No `<lastmod>`, anywhere.** Imports do not stamp rows, so AFLDB has no
per-URL modification time to publish. The index used to carry
`new Date()` — a fact about the server, not the content — which teaches a
crawler the site changed every time the cache expired.

---

## 6. Headings and semantics

One `<h1>` per page, naming its subject. Every collapsible section title is an
`<h2>` inside its `<summary>` (`CollapsiblePanel`), which is what puts a
player's "Career", "Season by season" and "Match log" into the document
outline a screen reader and a crawler both navigate by. `font: inherit` on
`.table-details-title` keeps the change structural rather than visual.

Content stays in the server-rendered HTML: `<details>` keeps collapsed panels
in the DOM, and `ReorderableSections` renders the server's order first and only
reorders after mount. No SEO-critical content is behind a click, a client
fetch or `localStorage`.

---

## 7. Tests

- `tests/seo.test.ts` — unit. Base-URL validity, the `pageMetadata` contract,
  the filtered-view predicate, `robots.txt`, the sitemap gate, and the
  structured-data honesty rules. Mocks `@/db/client`, so it runs without a
  database. Includes the launch gate: on any host with `AFLDB_INDEXING=on`,
  `AFLDB_BASE_URL` must be publishable.
- `tests/e2e/seo.spec.ts` — Playwright, against the production build. Served
  metadata, JSON-LD that parses, one `<h1>`, real 404s for invalid entities,
  `robots.txt` agreeing with the page metadata, and a stale slug redirecting
  in one permanent hop.
