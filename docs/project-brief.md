# AFLDB.com — Greenfield Public AFL Historical Database

You are building a completely new public web application called:

**AFLDB**

Production domain:

```text
afldb.com
```

The domain is already owned.

However:

**DO NOT deploy, redirect, modify DNS, expose, or otherwise put `afldb.com` into production during this project unless explicitly instructed.**

All development, database migration, functional testing, performance testing and deployment testing must occur on the **development server first**.

The project should be treated as a new production-grade web product, not as a modification of the existing Sports Data Lab application.

---

# 1. Core Objective

Build a modern public historical AFL/VFL statistics database designed to become:

```text
afldb.com
```

The site should provide extremely fast and intuitive access to Australian Football history.

It should support:

- players
- clubs
- seasons
- matches
- venues
- records
- awards
- Brownlow history
- drafts
- relationships
- player game logs
- player season statistics
- career statistics
- club statistics
- historical results
- advanced statistical search

The project should preserve the strengths of the existing AFL data while creating a purpose-built public web architecture.

AFLDB should ultimately function as a modern historical AFL reference and research site.

---

# 2. Important Project Boundary

This is a **new application**.

Do not convert the existing Sports Data Lab application into AFLDB.

Do not redesign Streamlit.

Do not reuse the existing frontend.

Do not add AFLDB pages to Sports Data Lab.

Instead:

```text
Existing Sports Data Lab
        │
        │ source data
        │ validation
        │ reusable AFL logic
        ▼
     AFLDB ETL
        │
        ▼
   PostgreSQL
        │
        ▼
      AFLDB
```

The existing application should be treated primarily as:

- legacy AFL data source
- source-data reference
- statistical validation oracle
- source of known-good queries
- source of reusable AFL parsing logic
- source of AFL import/update logic where appropriate

Do not modify the existing project unless explicitly instructed.

---

# 3. Development Location

Create the new project in a completely separate folder on the development server.

Preferred location:

```text
/home/arm/projects/afldb
```

Do not create AFLDB inside:

```text
sports_data_lab
```

The repositories must remain independent.

Desired structure:

```text
/home/arm/projects/

├── sports_data_lab/
│
└── afldb/
```

---

# 4. Authoritative Test Environment

All meaningful testing must occur on the development server.

This includes:

- PostgreSQL
- schema migrations
- data migration
- Next.js
- production builds
- server rendering
- Advanced Search
- indexing
- migration validation
- page load testing
- query performance
- deployment
- restart behaviour
- reverse proxy testing
- backup testing
- restore testing

Do not declare functionality complete merely because it runs in a Windows/local development environment.

The development server is the authoritative environment.

---

# 5. Production Domain Safety

The production domain is:

```text
afldb.com
```

Treat this as reserved production infrastructure.

During development:

DO NOT:

- change its authoritative DNS
- point it at the dev server
- enable production traffic
- issue redirects from the live domain
- index incomplete development pages
- expose test pages through the production hostname

Use the development server IP/private hostname for testing.

If a dedicated staging hostname such as:

```text
dev.afldb.com
```

would materially improve testing, document the proposal but do not create or alter DNS without explicit approval.

---

# 6. Technology Stack

Use the following primary stack:

```text
Next.js
TypeScript
PostgreSQL
Drizzle ORM/query layer
React
CSS
```

Use the **Next.js App Router**.

Prefer Server Components for public/read-heavy pages.

Use Client Components only where browser-side interaction actually requires them.

Do not make the entire site client-rendered.

---

# 7. Database Stack

Use:

```text
PostgreSQL
```

as the single authoritative AFLDB datastore.

Use Drizzle for:

- schema definitions where appropriate
- migrations where appropriate
- type-safe common queries
- normal CRUD/query operations

Do not force complex analytical queries through an ORM abstraction where native PostgreSQL SQL is clearer or more performant.

It is acceptable and encouraged to use carefully parameterised PostgreSQL SQL for:

- complicated aggregations
- record searches
- Advanced Search
- materialised views
- ranking
- full-text search
- window functions
- CTE-heavy analytics

The principle is:

```text
Type safety where useful
+
SQL power where necessary
```

---

# 8. Do Not Add a Separate API Initially

Do not introduce:

```text
FastAPI
Django
Express
NestJS
separate REST backend
GraphQL
```

during the initial build.

Use:

```text
Browser
   ↓
Next.js
   ↓
server-side data/query layer
   ↓
PostgreSQL
```

Where an HTTP API is actually required, use Next.js Route Handlers.

A separate backend service may be introduced later if AFLDB develops external API/mobile consumers.

Do not add architectural complexity in anticipation of hypothetical requirements.

---

# 9. Data Engineering May Still Use Python

The public website does not need to be Python.

However, existing Python expertise and AFL tooling should be reused where beneficial for ETL.

It is acceptable to use:

```text
Python
psycopg
pandas
Polars
```

for:

- migration
- source ingestion
- validation
- scraping
- normalisation
- derived data generation

when those tools are more appropriate.

Therefore:

```text
PUBLIC WEBSITE
Next.js + TypeScript

DATA ENGINEERING
Python where useful

DATABASE
PostgreSQL
```

These concerns must remain separate.

---

# 10. Greenfield Architecture

Target:

```text
                    USER
                      │
                      ▼
                  afldb.com
                      │
                    HTTPS
                      │
                      ▼
             ┌─────────────────┐
             │ Reverse Proxy   │
             │ Caddy / nginx   │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │    Next.js      │
             │   TypeScript    │
             │                 │
             │ Public pages    │
             │ Search          │
             │ Advanced Search │
             │ Records         │
             │ Interactive UI  │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │ Query / Service │
             │ Layer           │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │   PostgreSQL    │
             │                 │
             │ AFL historical  │
             │ database        │
             └────────▲────────┘
                      │
                      │
             ┌────────┴────────┐
             │ ETL / Import    │
             │ Update Pipeline │
             └────────▲────────┘
                      │
                AFL data sources
```

---

# 11. Project Structure

Use a clean structure similar to:

```text
afldb/
│
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
│
├── src/
│   │
│   ├── app/
│   │   ├── page.tsx
│   │   ├── players/
│   │   ├── clubs/
│   │   ├── seasons/
│   │   ├── matches/
│   │   ├── venues/
│   │   ├── awards/
│   │   ├── brownlow/
│   │   ├── records/
│   │   ├── search/
│   │   ├── advanced-search/
│   │   ├── api/
│   │   ├── sitemap.ts
│   │   └── robots.ts
│   │
│   ├── components/
│   │
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── queries/
│   │
│   ├── services/
│   │
│   ├── search/
│   │
│   ├── lib/
│   │
│   ├── types/
│   │
│   └── styles/
│
├── tools/
│   ├── migration/
│   ├── validation/
│   ├── import/
│   └── maintenance/
│
├── tests/
│
└── docs/
```

Do not treat this exact structure as mandatory where a better organisation is justified.

---

# 12. Start With Discovery, Not UI

Do not begin by designing player cards or homepages.

First perform a comprehensive audit of the existing AFL data.

Discover every relevant:

```text
SQLite database
CSV
JSON
HTML cache
derived file
scraper output
Python builder
migration script
data source
```

Do not assume filenames.

Inspect the existing project and locate the actual AFL sources.

---

# 13. Existing AFL Database Audit

For every source table identify:

```text
database
table
purpose
source
row count
columns
types
primary key
foreign keys
indexes
NULL counts
date range
season coverage
derived/source status
```

Classify each table:

```text
SOURCE
NORMALISED
DERIVED
CACHE
STAGING
LEGACY
UNKNOWN
```

Do not blindly migrate everything.

---

# 14. Data Dictionary

Create:

```text
docs/data-dictionary.md
```

For each important dataset document:

```text
Name
Purpose
Source
Coverage
Primary key
Relationships
Columns
NULL semantics
Known gaps
Known issues
Derived/source classification
```

The data dictionary becomes part of the permanent project documentation.

---

# 15. Migration Inventory

Create:

```text
docs/migration-inventory.md
```

Include:

```text
Legacy source
Legacy table
Legacy rows
Target table
Target rows
Transformations
Status
Validation
Notes
```

Example:

```text
Source                Rows       Target
------------------------------------------------
legacy players        13,353     players
legacy matches        ...
legacy player_games   693,194    player_match_stats
```

Use actual discovered values rather than hardcoded historical counts.

---

# 16. PostgreSQL Development Databases

Create separate databases for:

```text
afldb_dev
afldb_test
```

Do not use one database for both automated tests and development.

Future production:

```text
afldb_prod
```

must not be created/used as part of normal development unless explicitly instructed.

---

# 17. PostgreSQL Roles

Use least privilege.

Create roles conceptually similar to:

```text
afldb_owner
afldb_app
afldb_import
afldb_backup
```

### afldb_owner

Schema/migration owner.

### afldb_app

Read-oriented website account.

### afldb_import

Controlled import/update account.

### afldb_backup

Backup operations where appropriate.

Do not run the application as PostgreSQL superuser.

---

# 18. PostgreSQL Network Security

During development, PostgreSQL should only be available:

- locally on the dev server
- or to explicitly authorised private LAN development systems

Never expose:

```text
5432
```

to the public Internet.

Do not create a WAN port-forward for PostgreSQL.

Production architecture must also keep PostgreSQL private.

---

# 19. Database Model

Do not mechanically replicate SQLite.

Design PostgreSQL around the AFL domain.

Likely primary tables include:

```text
players
clubs
club_aliases
seasons
venues
matches

player_match_stats
player_season_stats
player_career_stats

player_clubs

ladder_entries
club_seasons

awards
award_winners

brownlow_votes

drafts
draft_picks

captaincies

player_relationships

sources
import_batches
```

These names are conceptual.

Use the data audit to determine the actual design.

---

# 20. Identity Design

Never use player names as primary identifiers.

Use stable IDs.

URLs should combine:

```text
human-readable slug
+
stable numeric or UUID identity
```

Example:

```text
/players/gary-ablett-jr-12345
```

The ID is authoritative.

The slug improves readability.

---

# 21. Historical Club Identity

Do not destroy historical identity through modern renaming.

Support:

- historic club names
- relocations
- naming changes
- VFL/AFL history
- aliases

Canonical public display can use modern naming where appropriate while preserving historical context.

---

# 22. Correct Datatypes

Use appropriate PostgreSQL types.

Examples:

```text
smallint
integer
bigint
numeric
boolean
date
timestamp
text
jsonb
```

Do not carry SQLite's loose type model into PostgreSQL.

Explicitly distinguish:

```text
NULL
0
false
unknown
not recorded
```

where those meanings differ.

---

# 23. Source Provenance

Important imported records should be traceable internally.

Track fields/relationships such as:

```text
source_id
source_record_id
import_batch_id
imported_at
```

where useful.

This is essential for debugging future data discrepancies.

---

# 24. Import Batches

Create import tracking.

Each import should record:

```text
batch id
source
started
completed
status
records read
records inserted
records updated
records rejected
validation result
error
```

Never silently ignore failed rows.

---

# 25. Migration Must Be Repeatable

Build an idempotent/restartable migration process.

Avoid:

```text
run this mystery script once
```

Prefer explicit tools such as:

```bash
npm run db:migrate
```

and:

```bash
python tools/migration/import_legacy_afl.py
```

or equivalent.

Provide options for:

```text
dry run
table selection
resume
validation
rebuild derived data
```

where appropriate.

---

# 26. Bulk Import

Do not insert ~700,000+ player-game records one ORM call at a time.

Use PostgreSQL bulk-loading techniques.

Prefer:

```text
COPY
psycopg COPY
staging tables
batch insert
```

depending on the migration phase.

After bulk loading:

```text
verify sequences
build indexes
analyse tables
validate relationships
```

---

# 27. Migration Validation

Never trust row counts alone.

For each migrated table compare:

```text
row count
distinct IDs
NULL counts
minimum values
maximum values
aggregate totals
relationship integrity
```

For immutable historical data consider deterministic hashes where practical.

---

# 28. Statistical Parity

Use the legacy AFL database as a validation oracle.

Compare:

```text
career games
career goals
season games
season goals
Brownlow votes
finals
club count
premierships
awards
match counts
```

for representative players.

Do not change expected results merely to make tests pass.

Investigate differences.

---

# 29. Known Advanced Search Regression Cases

Import proven search cases from Sports Data Lab.

Include queries conceptually equivalent to:

```text
debuted in 1960s
AND
played for exactly two clubs
```

```text
career games 200–249
AND
16+ finals
```

```text
50–199 career goals
AND
zero Brownlow votes
```

Compare actual player ID sets, not only counts.

---

# 30. PostgreSQL Search Strategy

Search is one of AFLDB's core technologies.

Enable:

```text
pg_trgm
```

and evaluate trigram indexes for:

```text
players
clubs
venues
```

where useful.

Support:

```text
exact
prefix
partial
fuzzy
```

search.

---

# 31. Search Normalisation

Create normalised search representations without changing canonical display names.

Consider:

```text
display_name
search_name
aliases
```

Normalisation may handle:

```text
case
punctuation
apostrophes
hyphens
initials
spacing
```

Do not lose the original name.

---

# 32. Global Search

The central public search should support:

```text
players
clubs
seasons
matches
venues
awards
```

where applicable.

Conceptual request:

```text
/search?q=ablett
```

Results:

```text
PLAYERS
Gary Ablett Sr
Gary Ablett Jr

RELATED
...
```

Return useful ranked results rapidly.

---

# 33. Search Autocomplete

Autocomplete should not hammer PostgreSQL on every keystroke without control.

Use:

```text
minimum query length
debounce
result limit
indexed search
```

Do not return hundreds of autocomplete results.

---

# 34. Advanced Search

Advanced Search should become AFLDB's key differentiator.

Allow non-technical users to ask complex statistical questions.

Example:

```text
Career games      >= 200
Career goals      >= 100
Finals            >= 15
Brownlow votes    >= 25
Clubs played      = 2
Debut             1990–2010
```

---

# 35. Advanced Search URL State

Search configuration must be shareable.

Example:

```text
/players?games_min=200&goals_min=100&finals_min=15
```

or:

```text
/advanced-search?games_min=200&clubs=2
```

Do not hide useful public query state only in React state.

---

# 36. Advanced Search Security

Never accept arbitrary SQL.

Build a typed query specification.

Allowlist:

```text
fields
operators
sorts
aggregations
```

Validate all values.

Parameterise SQL.

Protect dynamic SQL identifiers through fixed mappings.

---

# 37. Advanced Boolean Search

Design the search engine so it can eventually support:

```text
AND
OR
NOT
nested groups
```

But do not reproduce every experimental Sports Data Lab query-builder feature in the initial MVP.

Correctness is more important than feature count.

---

# 38. Search Summary Data

Common career filters should not aggregate the entire player-match table for every request.

Maintain reproducible summary structures such as:

```text
player_career_stats
player_season_stats
```

Potential career fields:

```text
games
goals
finals
premierships
brownlow_votes
clubs_played
debut_year
final_year
```

These must remain derivable from authoritative source tables.

---

# 39. Materialised Views

Evaluate PostgreSQL materialised views for expensive read-heavy data such as:

```text
career summaries
season summaries
record leaderboards
club records
head-to-head summaries
```

Do not introduce a materialised view without defining:

```text
source
refresh process
refresh trigger/schedule
validation
```

---

# 40. Public Routes

Use clean permanent routes.

Target:

```text
/
```

```text
/players
/players/[slug]
```

```text
/clubs
/clubs/[slug]
```

```text
/seasons
/seasons/[year]
```

```text
/matches/[id]
```

```text
/venues
/venues/[slug]
```

```text
/records
/records/[category]
```

```text
/awards
```

```text
/brownlow
/brownlow/[year]
```

```text
/draft
/draft/[year]
```

```text
/search
```

```text
/advanced-search
```

---

# 41. Canonical URLs

Every entity must have one canonical URL.

Avoid creating multiple indexable representations of the same player/match/season.

Redirect obsolete slugs to the canonical entity URL if required.

---

# 42. Player Pages

Player pages should become a primary landing surface.

Potential layout:

```text
Gary Ablett Jr

Geelong • Gold Coast
2002–2020

357 Games
445 Goals
262 Brownlow Votes
```

Sections:

```text
Overview
Season-by-season
Match log
Finals
Awards
Brownlow
Clubs
Teammates
Opponents
Venues
Family
Records
```

Only expose sections backed by validated data.

---

# 43. Club Pages

Provide:

```text
overview
season history
premierships
finals
player leaders
goalkicking
awards
head-to-head
venues
records
```

according to available validated data.

---

# 44. Season Pages

Provide:

```text
ladder
matches
finals
premier
Brownlow
goalkicking
awards
stat leaders
```

where available.

Use obvious previous/next season navigation.

---

# 45. Match Pages

Expose verified data including:

```text
date
round
clubs
score
venue
attendance
quarter scores
player stats
goalkickers
Brownlow votes
```

where coverage permits.

---

# 46. Records

Records should become a major public section.

Examples:

```text
Most Games
Most Goals
Most Finals
Most Brownlow Votes
Most Premierships
Single-game records
Season records
Club records
Venue records
```

Every record must have an exact definition.

---

# 47. Homepage

Homepage priority:

```text
AFL DB

Australian Football Statistics Database
1897 → Present

[ Search AFL history... ]

Players
Clubs
Seasons
Matches
Records
Advanced Search
```

Do not turn the homepage into a marketing landing page.

The primary action is search/exploration.

---

# 48. Frontend Philosophy

Design AFLDB as:

```text
information-dense
fast
clean
professional
responsive
accessible
```

Avoid:

```text
betting aesthetics
fantasy-sports styling
excessive animation
oversized hero sections
dashboard-card overload
glassmorphism everywhere
```

Data should dominate the interface.

---

# 49. Server Components by Default

Use Server Components for:

```text
player pages
club pages
season pages
record pages
match pages
static tables
metadata
```

Use Client Components only for:

```text
interactive filters
autocomplete
charts
advanced-search controls
comparison tools
```

Do not mark entire page trees `"use client"` without reason.

---

# 50. Data Access Boundary

Never expose database credentials to browser code.

Only server-side modules may import the PostgreSQL client.

Enforce a clean separation such as:

```text
src/db
src/services
src/search
```

Browser/client bundles must not contain database access code.

---

# 51. Query Organisation

Organise complicated database work explicitly.

Example:

```text
src/db/queries/

players.ts
clubs.ts
matches.ts
seasons.ts
records.ts
search.ts
advanced-search.ts
```

Do not scatter giant SQL strings throughout React components.

---

# 52. N+1 Protection

Review page queries carefully.

Avoid patterns such as:

```text
load 100 players
then execute 100 separate career queries
```

Use:

```text
joins
aggregations
batch queries
precomputed summaries
```

where appropriate.

---

# 53. Pagination

Use server-side pagination for:

```text
players
matches
player match logs
search results
advanced search
large record tables
```

Do not render tens of thousands of rows.

---

# 54. Sorting

Allow only known sort keys.

For example:

```text
name
games
goals
debut
final_game
brownlow_votes
```

Never interpolate arbitrary user strings into:

```text
ORDER BY
```

---

# 55. PostgreSQL Query Analysis

Use:

```sql
EXPLAIN
EXPLAIN ANALYZE
```

for important queries.

Inspect:

```text
sequential scans
sorts
join strategies
index usage
row estimates
execution time
```

Do not assume an index improves performance.

Measure.

---

# 56. Index Strategy

Index actual workloads.

Likely dimensions:

```text
player_id
club_id
season
match_id
match_date
venue_id
player + season
player + match
club + season
```

Use GIN/trigram indexes for text search where justified.

Avoid indiscriminate indexing.

---

# 57. Performance Targets

Define measurable targets for development-server testing.

Aim initially for cached/common pages approximately:

```text
< 500 ms server response
```

and ordinary indexed database queries:

```text
< 200 ms
```

where realistic.

Do not manipulate data or reduce correctness merely to meet an arbitrary benchmark.

Record actual performance.

---

# 58. Caching

Exploit the historical nature of AFLDB.

Data such as:

```text
1989 Grand Final
1995 Brownlow
retired player careers
historic season pages
```

rarely changes.

Use Next.js caching/revalidation appropriately.

Current-season/update-sensitive pages should have a more appropriate refresh strategy.

Do not query PostgreSQL unnecessarily for every historical page request.

---

# 59. Cache Invalidation

Import/update processes must have a clear way to invalidate or revalidate affected pages.

Do not create caches that require a full site restart after every data update.

---

# 60. SEO

AFLDB is an indexable public reference site.

Implement:

```text
metadata
canonical URLs
robots.txt
XML sitemap
Open Graph
structured headings
descriptive titles
```

Example:

```text
Gary Ablett Jr AFL Statistics | AFLDB
```

```text
2007 AFL Season | AFLDB
```

```text
Most AFL Games | AFLDB Records
```

---

# 61. Sitemap Scaling

Do not generate an enormous sitemap synchronously on every HTTP request.

Design sitemap generation for potentially:

```text
13,000+ players
thousands of matches
seasons
clubs
venues
record pages
```

Support segmented sitemaps if necessary.

---

# 62. Accessibility

Use semantic HTML.

Ensure:

```text
keyboard navigation
visible focus
form labels
table headers
sufficient contrast
logical headings
accessible autocomplete
```

Do not make essential data interaction hover-only.

---

# 63. Responsive Design

Test explicitly at:

```text
mobile
tablet
desktop
wide desktop
```

Statistical tables must remain usable on mobile.

Options can include:

```text
responsive column priority
horizontal table scrolling
condensed presentation
```

Do not simply shrink desktop tables until unreadable.

---

# 64. Testing Stack

Implement automated testing from the beginning.

Use appropriate tools such as:

```text
Vitest
React Testing Library
Playwright
```

or current justified equivalents.

Test:

```text
database layer
search
routes
components
data formatting
Advanced Search
pagination
canonical routing
error states
```

---

# 65. PostgreSQL Integration Tests

Integration tests must execute against:

```text
afldb_test
```

on the development server.

Do not mock PostgreSQL for tests whose purpose is validating PostgreSQL behaviour.

Test:

```text
migrations
queries
indexes
search
aggregations
constraints
```

---

# 66. End-to-End Testing

Use browser-level E2E tests for core user journeys.

Required examples:

```text
home → search → player
```

```text
players → filters → player
```

```text
season → match
```

```text
advanced search → results → player
```

```text
records → category
```

---

# 67. Production Build Testing

Every significant milestone must successfully run:

```bash
npm run build
```

on the dev server.

Do not rely solely on:

```bash
npm run dev
```

A feature is not deployment-ready if it only works in the development server.

---

# 68. Production-Mode Dev Deployment

Before production cutover, run AFLDB on the development server using the same deployment pattern intended for production.

Example:

```text
reverse proxy
      ↓
Next.js production build
      ↓
PostgreSQL
```

Test:

```text
restart
boot
logging
permissions
environment loading
static assets
caching
```

---

# 69. Process Management

Run the production-like Next.js process on the development server using a reliable service manager.

Prefer:

```text
systemd
```

for self-hosting.

Do not rely on:

```text
terminal window
tmux-only startup
manual npm command
```

for the long-term deployment.

---

# 70. Reverse Proxy

Use:

```text
Caddy
```

or:

```text
nginx
```

for production-style testing.

Only expose the web application interface.

PostgreSQL remains private.

---

# 71. Health Endpoint

Implement a simple internal health route such as:

```text
/api/health
```

It should verify at least:

```text
application running
database reachable
```

Do not reveal secrets, version details or stack traces.

---

# 72. Logging

Log useful structured information including:

```text
HTTP errors
database failures
slow requests
import jobs
migration jobs
data validation failures
```

Do not log:

```text
passwords
full connection strings
secrets
```

---

# 73. Query Abuse Protection

Advanced Search is publicly accessible and could become expensive.

Implement limits for:

```text
result count
page size
number of filters
nested Boolean depth
IN-list size
export size
query execution time
```

Do not cripple legitimate research use.

---

# 74. Security Headers

Configure appropriate production security headers through Next.js/reverse proxy.

Review:

```text
HSTS
X-Content-Type-Options
Referrer-Policy
Content-Security-Policy
```

Do not blindly deploy an overly restrictive CSP that breaks required assets.

---

# 75. Environment Configuration

Use environment variables.

Example:

```text
NODE_ENV

DATABASE_URL

AFDLB_BASE_URL

AFDLB_ENV

AFDLB_IMPORT_DATABASE_URL
```

Do not commit:

```text
.env
production credentials
database passwords
```

Provide:

```text
.env.example
```

---

# 76. Backup Strategy

PostgreSQL will eventually become authoritative.

Automate development backup testing using:

```text
pg_dump
```

Prefer custom format where appropriate.

Store backup artefacts in an appropriate protected server location.

---

# 77. Restore Testing

A database backup is not considered proven until restored.

Test:

```text
afldb_dev
    ↓
pg_dump
    ↓
backup
    ↓
afldb_restore_test
    ↓
validation
```

Run core parity checks against the restored database.

---

# 78. Future Data Updates

Do not make migration a one-time dead end.

Build the architecture so future data can follow:

```text
source
   ↓
acquire
   ↓
staging
   ↓
normalise
   ↓
validate
   ↓
upsert
   ↓
rebuild affected summaries
   ↓
invalidate/revalidate pages
```

---

# 79. Import Transactions

Where practical, data updates must be transactional.

A failed update should not leave AFLDB displaying a partially updated season.

Use staging/import batches where necessary.

---

# 80. Data Quality Dashboard

Provide at least an internal report/tool capable of surfacing:

```text
unmatched players
missing relationships
duplicate IDs
missing dates
unknown venues
broken foreign keys
source gaps
stat coverage
```

This does not initially need to be a public interface.

---

# 81. Admin Tools

Do not build a huge admin CMS initially.

Provide only what is required for:

```text
data quality
imports
validation
maintenance
```

A custom internal admin area can be added later.

Do not allow public write access to historical data.

---

# 82. No Accounts Initially

Do not build:

```text
registration
login
social auth
subscriptions
favourites
```

during the initial build unless explicitly instructed.

Focus on the public database.

---

# 83. No Monetisation Initially

Do not complicate the first architecture with:

```text
advertising
payments
subscriptions
premium tiers
```

Design clean boundaries so these can be considered later.

---

# 84. MVP

The initial production-quality MVP should include:

```text
[ ] PostgreSQL AFL database

[ ] Homepage
[ ] Global search

[ ] Player index
[ ] Player profile
[ ] Player season stats
[ ] Player match log

[ ] Club index
[ ] Club profile

[ ] Season index
[ ] Season profile

[ ] Match pages

[ ] Records

[ ] Brownlow

[ ] Advanced Player Search

[ ] Responsive interface

[ ] Canonical URLs
[ ] Sitemap
[ ] robots.txt
[ ] metadata

[ ] automated tests
[ ] E2E tests

[ ] PostgreSQL backup
[ ] restore test

[ ] production build
[ ] systemd deployment
[ ] reverse proxy test
```

---

# 85. Development Phases

## Phase 1 — Audit

Do:

```text
create project
inspect source
inventory AFL data
build data dictionary
identify trusted/derived/cache datasets
document migration
```

Do not build major UI yet.

---

## Phase 2 — PostgreSQL

Do:

```text
install/configure PostgreSQL
create dev/test DBs
create roles
enable required extensions
build target schema
create migrations
```

---

## Phase 3 — Migration

Do:

```text
import players
clubs
seasons
venues
matches
player match stats
awards
Brownlow
supporting data
```

Validate after every logical group.

---

## Phase 4 — Derived Data

Build:

```text
player seasons
player careers
club seasons
record summaries
search projections
```

Ensure all derived data is reproducible.

---

## Phase 5 — Core Public Site

Build:

```text
home
search
players
clubs
seasons
matches
```

---

## Phase 6 — Records / History

Build:

```text
records
Brownlow
awards
venues
draft
relationships
```

according to validated available data.

---

## Phase 7 — Advanced Search

Port the proven statistical search concepts from Sports Data Lab into the new architecture.

Do not copy UI implementation.

---

## Phase 8 — Optimisation

Perform:

```text
query profiling
index tuning
cache design
bundle review
page performance
mobile review
```

---

## Phase 9 — Deployment Simulation

On the development server:

```text
production Next.js build
systemd
reverse proxy
PostgreSQL
restart testing
backup
restore
load testing
```

---

## Phase 10 — Production Readiness

Prepare but DO NOT execute:

```text
afldb.com DNS
HTTPS certificate
production database
production environment
production service
```

Provide the exact production cutover plan separately.

---

# 86. Load Testing

Before public launch perform load testing on the dev server.

Test representative workloads:

```text
homepage
player profile
global search
Advanced Search
records
match page
season page
```

Measure:

```text
requests/sec
P50
P95
P99
errors
CPU
RAM
PostgreSQL load
connection count
```

Identify database bottlenecks before production.

---

# 87. Dataset Scale Testing

Do not test only against tiny fixtures.

Performance validation must use the fully migrated AFL historical dataset.

A query that is fast against 100 records proves nothing.

---

# 88. Documentation

Create:

```text
README.md
docs/architecture.md
docs/data-dictionary.md
docs/migration-inventory.md
docs/migration-report.md
docs/search.md
docs/deployment.md
docs/backup-restore.md
docs/production-cutover.md
```

---

# 89. Production Cutover Document

Prepare:

```text
docs/production-cutover.md
```

but do not execute it.

Include exact future steps for:

```text
production PostgreSQL
production secrets
production Next.js service
reverse proxy
afldb.com DNS
HTTPS
robots/sitemap
backup
monitoring
smoke tests
rollback
```

---

# 90. Git

Create AFLDB as its own repository.

Do not make it a subdirectory of the Sports Data Lab Git repository.

Initial repository should contain only:

```text
source
schema/migrations
tests
safe configuration templates
documentation
```

Never commit:

```text
database dumps
production passwords
.env
large source caches
private backups
```

unless specifically appropriate and intentionally managed.

---

# 91. Error Handling

Public error pages must not expose:

```text
SQL
database hostname
source paths
stack traces
environment variables
```

Log diagnostic information server-side.

Return useful user-facing:

```text
404
500
search error
```

states.

---

# 92. 404 Behaviour

Unknown entities should return proper:

```text
HTTP 404
```

not a successful page saying "not found".

---

# 93. Redirect Behaviour

If entity slugs change:

```text
/players/old-name-123
```

should permanently redirect to:

```text
/players/current-name-123
```

when identity is known.

---

# 94. Data Formatting

Centralise formatting for:

```text
dates
scores
season names
club names
round names
finals stages
statistics
```

Do not duplicate formatting logic across components.

---

# 95. Shared Statistical Definitions

Define statistical metrics centrally.

Examples:

```text
career games
finals
premierships
club count
Brownlow votes
```

Do not allow pages/search/records to implement different definitions of the same statistic.

---

# 96. Historical Coverage Awareness

Some statistics do not exist for every historical era.

The UI must distinguish:

```text
0
```

from:

```text
stat not collected
```

where applicable.

Never imply historical zero where the dataset simply lacks the statistic.

---

# 97. Source Conflicts

Where source records disagree:

- do not silently choose whichever value was imported last
- preserve evidence
- document resolution logic
- flag unresolved discrepancies

Data trust is a core AFLDB requirement.

---

# 98. Definition of Done — Development

A phase is not complete because code was written.

The development implementation is complete only when:

```text
[ ] project exists independently

[ ] PostgreSQL development DB operational
[ ] PostgreSQL test DB operational

[ ] AFL migration completed
[ ] parity validation completed

[ ] full historical dataset loaded

[ ] global search works
[ ] fuzzy player search works

[ ] player pages work
[ ] club pages work
[ ] season pages work
[ ] match pages work
[ ] record pages work

[ ] Advanced Search works

[ ] URLs are shareable
[ ] pages are responsive

[ ] automated tests pass
[ ] E2E tests pass

[ ] npm run build passes

[ ] production-mode deployment runs on dev server

[ ] reverse proxy tested

[ ] backup succeeds
[ ] restore succeeds

[ ] query performance reviewed
[ ] load testing reviewed

[ ] documentation complete

[ ] afldb.com remains unmodified
```

---

# 99. Production Readiness Gate

Do not recommend pointing:

```text
afldb.com
```

to the application until every item below passes:

```text
DATA
[ ] migration verified
[ ] historical parity verified
[ ] data-quality blockers reviewed

APPLICATION
[ ] production build stable
[ ] pages stable
[ ] search stable
[ ] Advanced Search stable

DATABASE
[ ] indexes tuned
[ ] backups automated
[ ] restore tested
[ ] least privilege verified

SECURITY
[ ] secrets externalised
[ ] PostgreSQL private
[ ] production headers configured
[ ] public errors sanitised

PERFORMANCE
[ ] load test passed
[ ] major slow queries fixed
[ ] caching validated

SEO
[ ] canonical URLs
[ ] metadata
[ ] sitemap
[ ] robots

OPERATIONS
[ ] systemd
[ ] reverse proxy
[ ] logs
[ ] health endpoint
[ ] deployment documentation
[ ] rollback documentation
```

---

# 100. Final Target

The final production architecture should be:

```text
                       afldb.com
                           │
                         HTTPS
                           │
                           ▼
                  ┌─────────────────┐
                  │ Reverse Proxy   │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │     Next.js     │
                  │    TypeScript   │
                  │                 │
                  │ Server pages    │
                  │ Search          │
                  │ Advanced Search │
                  │ Records         │
                  │ Interactive UI  │
                  └────────┬────────┘
                           │
                     Query layer
                           │
                           ▼
        ┌─────────────────────────────────┐
        │           PostgreSQL            │
        │                                 │
        │ Players                         │
        │ Clubs                           │
        │ Seasons                         │
        │ Matches                         │
        │ Venues                          │
        │ Player Match Stats              │
        │ Player Season Stats             │
        │ Player Career Stats             │
        │ Brownlow                        │
        │ Awards                          │
        │ Drafts                          │
        │ Relationships                   │
        │ Records / Derived Data          │
        └────────────────▲────────────────┘
                         │
                         │
                 ┌───────┴────────┐
                 │ AFL ETL /      │
                 │ Update System  │
                 │                │
                 │ Python where   │
                 │ useful         │
                 └───────▲────────┘
                         │
                    AFL sources
```

---

# 101. Core Rule

Do not build AFLDB as a thin replacement UI over the existing database.

Use the existing AFL data as the foundation for a **new, purpose-built public historical AFL database**.

The optimisation priority is:

```text
DATA CORRECTNESS
       ↓
POSTGRESQL DESIGN
       ↓
SEARCH
       ↓
PUBLIC URLS
       ↓
PLAYER / CLUB / MATCH / SEASON PAGES
       ↓
ADVANCED SEARCH
       ↓
PERFORMANCE
       ↓
SEO
       ↓
RELIABILITY
```

AFLDB should be architected so that years from now the site can grow substantially without requiring another fundamental database or frontend rewrite.

---

# 102. Execution Behaviour

Work autonomously through the phases.

Do not repeatedly stop for approval on routine implementation decisions.

When a decision is uncertain:

1. inspect the existing data/code
2. choose the safest maintainable option
3. document the reasoning
4. continue

Only stop where:

- credentials are genuinely required
- destructive infrastructure action is required
- production DNS/domain modification would be required
- source ambiguity could materially corrupt historical data

Do not touch `afldb.com` production configuration without explicit instruction.

At the end of each major phase provide:

```text
Completed
Tests performed
Results
Problems discovered
Changes made
Remaining work
Next phase
```

The final deliverable must be a tested development-server implementation ready for a deliberate future production cutover to **afldb.com**.