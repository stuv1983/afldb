// docs/v2/evidence/remediation-20261114/rollover/prod-facts-entry.mts
import postgres from "postgres";

// data/reference/seasons.json
var seasons_default = {
  $comment: "AFLDB season range (AFLDB-ISSUE-093 Phase 1). Replaces the legacy-derived season enumeration in import_legacy_afl.py with the trivial range generation the ISSUE-093 runbook prescribes (VFL/AFL has run every season since 1897, war years included). Measured columns (first/last match date, match/club counts, data_through_date) are owned by the later match-import and season_metadata phases and are loaded as NULL here. last_season and in_progress_seasons are an explicit snapshot so the load stays deterministic; update them when a new season is acquired.",
  first_season: 1897,
  last_season: 2027,
  league_eras: [
    {
      league: "VFL",
      first_season: 1897,
      last_season: 1989
    },
    {
      league: "AFL",
      first_season: 1990,
      last_season: null
    }
  ],
  in_progress_seasons: [
    2027
  ],
  season_notes: {
    "2027": "Season in progress at time of import."
  }
};

// data/reference/clubs.json
var clubs_default = {
  $comment: "AFLDB club identities, organization relations and notes (AFLDB-ISSUE-093 Phase 1). Ported from the CLUBS / CLUB_ORGANIZATION_RELATIONS / CLUB_NOTES constants previously embedded in tools/migration/import_legacy_afl.py, then verified field-by-field against the preserved legacy-built baseline afldb_test_pre_rebuild_20260825 on 2026-08-25 (all 24 spans, slugs, succession wiring and aliases matched; wikipedia_url/afltables_slug baked in from the baseline \u2014 present only for the 18 current identities, NULL for the six historical ones, exactly as the baseline holds). 'hist' is the stable identity key (clubs.legacy_club_hist, NOT NULL UNIQUE). Aliases are derived by the loader exactly as before: hist as source_string, name/short_name as alternate, abbreviation as abbreviation. last_season null means 'current' and resolves to the season range's last_season at load time. legacy_club_key (the legacy SQLite club id) is deliberately not carried into the new path.",
  identities: [
    { hist: "Adelaide", name: "Adelaide", short_name: "Adelaide", abbreviation: "ADE", slug: "adelaide", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "SA", first_season: 1991, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Adelaide_Football_Club", afltables_slug: "adelaide", notes: null },
    { hist: "Brisbane Bears", name: "Brisbane Bears", short_name: "Brisbane Bears", abbreviation: "BB", slug: "brisbane-bears", successor_hist: null, succession: "merged", is_current_afl_club: false, home_state: "QLD", first_season: 1987, last_season: 1996, wikipedia_url: null, afltables_slug: null, notes: "Merged with Fitzroy in 1997 to form the Brisbane Lions. Retained as a distinct identity because the source data keeps its record separate." },
    { hist: "Brisbane Lions", name: "Brisbane Lions", short_name: "Brisbane Lions", abbreviation: "BL", slug: "brisbane-lions", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "QLD", first_season: 1997, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Brisbane_Lions", afltables_slug: "brisbanel", notes: null },
    { hist: "Carlton", name: "Carlton", short_name: "Carlton", abbreviation: "CARL", slug: "carlton", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1897, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Carlton_Football_Club", afltables_slug: "carlton", notes: null },
    { hist: "Collingwood", name: "Collingwood", short_name: "Collingwood", abbreviation: "COLL", slug: "collingwood", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1897, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Collingwood_Football_Club", afltables_slug: "collingwood", notes: null },
    { hist: "Essendon", name: "Essendon", short_name: "Essendon", abbreviation: "ESS", slug: "essendon", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1897, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Essendon_Football_Club", afltables_slug: "essendon", notes: null },
    { hist: "Fitzroy", name: "Fitzroy", short_name: "Fitzroy", abbreviation: "FITZ", slug: "fitzroy", successor_hist: null, succession: "merged", is_current_afl_club: false, home_state: "VIC", first_season: 1897, last_season: 1996, wikipedia_url: null, afltables_slug: null, notes: "Merged with Brisbane Bears in 1997 to form the Brisbane Lions. Retained as a distinct identity because the source data keeps its record separate." },
    { hist: "Footscray", name: "Footscray", short_name: "Footscray", abbreviation: "FOOT", slug: "footscray", successor_hist: "Western Bulldogs", succession: "renamed", is_current_afl_club: false, home_state: "VIC", first_season: 1925, last_season: 1996, wikipedia_url: null, afltables_slug: null, notes: "Renamed the Western Bulldogs in 1997." },
    { hist: "Fremantle", name: "Fremantle", short_name: "Fremantle", abbreviation: "FRE", slug: "fremantle", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "WA", first_season: 1995, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Fremantle_Football_Club", afltables_slug: "fremantle", notes: null },
    { hist: "Geelong", name: "Geelong", short_name: "Geelong", abbreviation: "GEEL", slug: "geelong", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1897, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Geelong_Football_Club", afltables_slug: "geelong", notes: null },
    { hist: "Gold Coast", name: "Gold Coast", short_name: "Gold Coast", abbreviation: "GC", slug: "gold-coast", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "QLD", first_season: 2011, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Gold_Coast_Suns", afltables_slug: "goldcoast", notes: null },
    { hist: "Greater Western Sydney", name: "Greater Western Sydney", short_name: "GWS", abbreviation: "GWS", slug: "greater-western-sydney", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "NSW", first_season: 2012, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Greater_Western_Sydney_Giants", afltables_slug: "gws", notes: null },
    { hist: "Hawthorn", name: "Hawthorn", short_name: "Hawthorn", abbreviation: "HAW", slug: "hawthorn", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1925, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Hawthorn_Football_Club", afltables_slug: "hawthorn", notes: null },
    { hist: "Kangaroos", name: "Kangaroos", short_name: "Kangaroos", abbreviation: "KANG", slug: "kangaroos", successor_hist: "North Melbourne", succession: "renamed", is_current_afl_club: false, home_state: "VIC", first_season: 1999, last_season: 2007, wikipedia_url: null, afltables_slug: null, notes: "North Melbourne competed as the Kangaroos from 1999 to 2007." },
    { hist: "Melbourne", name: "Melbourne", short_name: "Melbourne", abbreviation: "MELB", slug: "melbourne", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1897, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Melbourne_Football_Club", afltables_slug: "melbourne", notes: null },
    { hist: "North Melbourne", name: "North Melbourne", short_name: "North Melbourne", abbreviation: "NM", slug: "north-melbourne", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1925, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/North_Melbourne_Football_Club", afltables_slug: "kangaroos", notes: null },
    { hist: "Port Adelaide", name: "Port Adelaide", short_name: "Port Adelaide", abbreviation: "PA", slug: "port-adelaide", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "SA", first_season: 1997, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Port_Adelaide_Football_Club", afltables_slug: "padelaide", notes: null },
    { hist: "Richmond", name: "Richmond", short_name: "Richmond", abbreviation: "RICH", slug: "richmond", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1908, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Richmond_Football_Club", afltables_slug: "richmond", notes: null },
    { hist: "South Melbourne", name: "South Melbourne", short_name: "South Melbourne", abbreviation: "SM", slug: "south-melbourne", successor_hist: "Sydney", succession: "relocated", is_current_afl_club: false, home_state: "VIC", first_season: 1897, last_season: 1981, wikipedia_url: null, afltables_slug: null, notes: "Relocated to Sydney in 1982." },
    { hist: "St Kilda", name: "St Kilda", short_name: "St Kilda", abbreviation: "STK", slug: "st-kilda", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1897, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/St_Kilda_Football_Club", afltables_slug: "stkilda", notes: null },
    { hist: "Sydney", name: "Sydney", short_name: "Sydney", abbreviation: "SYD", slug: "sydney", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "NSW", first_season: 1982, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Sydney_Swans", afltables_slug: "swans", notes: null },
    { hist: "University", name: "University", short_name: "University", abbreviation: "UNI", slug: "university", successor_hist: null, succession: "defunct", is_current_afl_club: false, home_state: "VIC", first_season: 1908, last_season: 1914, wikipedia_url: null, afltables_slug: null, notes: "Competed 1908-1914 and withdrew from the competition." },
    { hist: "West Coast", name: "West Coast", short_name: "West Coast", abbreviation: "WCE", slug: "west-coast", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "WA", first_season: 1987, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/West_Coast_Eagles", afltables_slug: "westcoast", notes: null },
    { hist: "Western Bulldogs", name: "Western Bulldogs", short_name: "Western Bulldogs", abbreviation: "WB", slug: "western-bulldogs", successor_hist: null, succession: "current", is_current_afl_club: true, home_state: "VIC", first_season: 1997, last_season: null, wikipedia_url: "https://en.wikipedia.org/wiki/Western_Bulldogs", afltables_slug: "bullldogs", notes: null }
  ],
  organization_relations: [
    {
      from_slug: "fitzroy",
      to_slug: "brisbane-lions",
      relation: "merged_into",
      effective_season: 1997,
      notes: "Fitzroy and Brisbane Bears combined to form Brisbane Lions in 1997. Statistics are not combined: each organization keeps its own record."
    },
    {
      from_slug: "brisbane-bears",
      to_slug: "brisbane-lions",
      relation: "merged_into",
      effective_season: 1997,
      notes: "Brisbane Bears and Fitzroy combined to form Brisbane Lions in 1997. Statistics are not combined."
    },
    {
      from_slug: "university",
      to_slug: null,
      relation: "folded",
      effective_season: 1915,
      notes: "University withdrew from the competition after the 1914 season and never returned."
    }
  ]
};

// src/lib/rollover/season-opening.ts
import { createHash } from "node:crypto";
var OpeningRefused = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OpeningRefused";
  }
};
var isInt = (v) => typeof v === "number" && Number.isInteger(v);
function expectedOpening(seasonsDoc, clubsDoc, requestedYear) {
  const root = seasonsDoc ?? {};
  const first = root.first_season;
  const last = root.last_season;
  if (!isInt(first) || !isInt(last)) throw new OpeningRefused("seasons.json declares no integer first_season/last_season.");
  const year = requestedYear ?? last;
  if (year !== last) {
    throw new OpeningRefused(`the tracked register ends at ${last}; it does not cover season ${year}, so nothing defines that row.`);
  }
  const inProgress = Array.isArray(root.in_progress_seasons) ? root.in_progress_seasons : [];
  if (!inProgress.every(isInt) || !inProgress.includes(year)) {
    throw new OpeningRefused(`seasons.json does not declare ${year} in progress (in_progress_seasons ${JSON.stringify(inProgress)}); there is no in-progress season row to open.`);
  }
  let league = null;
  const eras = Array.isArray(root.league_eras) ? root.league_eras : [];
  for (const era of eras) {
    const eraFirst = era.first_season;
    const eraLast = era.last_season === null ? last : era.last_season;
    if (isInt(eraFirst) && isInt(eraLast) && year >= eraFirst && year <= eraLast) league = String(era.league);
  }
  if (league !== "VFL" && league !== "AFL") throw new OpeningRefused(`seasons.json league_eras give no VFL/AFL league for ${year}.`);
  const notesDoc = root.season_notes ?? {};
  const rawNote = notesDoc[String(year)];
  const notes = rawNote === void 0 || rawNote === null ? null : String(rawNote);
  const identities = Array.isArray(clubsDoc?.identities) ? clubsDoc.identities : [];
  if (identities.length === 0) throw new OpeningRefused("clubs.json carries no identities.");
  const open = [];
  for (const identity of identities) {
    const openEra = identity.last_season === null || identity.last_season === void 0;
    if (!openEra) continue;
    if (identity.succession !== "current" || identity.is_current_afl_club !== true) {
      throw new OpeningRefused(`clubs.json identity ${String(identity.hist)} has no last_season but is not a current AFL club.`);
    }
    if (!isInt(identity.first_season)) throw new OpeningRefused(`clubs.json identity ${String(identity.hist)} has no first_season.`);
    open.push({ hist: String(identity.hist), slug: String(identity.slug), firstSeason: identity.first_season });
  }
  for (const identity of identities) {
    if (identity.is_current_afl_club === true && identity.last_season !== null && identity.last_season !== void 0) {
      throw new OpeningRefused(`clubs.json identity ${String(identity.hist)} is a current AFL club with a closed era.`);
    }
  }
  if (open.length === 0) throw new OpeningRefused("clubs.json has no open identity; there is no current club to carry into the season.");
  return { year, previousYear: year - 1, league, status: "in_progress", notes, open };
}
async function jsonRows(rows) {
  return (await rows).map((r) => JSON.parse(r.j));
}
var idList = (text) => text ? text.split(",").map(Number) : [];
async function readOpeningFacts(db, year) {
  const previous = year - 1;
  const [max] = await db`SELECT max(year)::int AS m FROM seasons`;
  const seasons = await jsonRows(db`SELECT to_jsonb(s)::text AS j FROM seasons s ORDER BY s.year`);
  const clubs = await jsonRows(db`SELECT to_jsonb(c)::text AS j FROM clubs c ORDER BY c.id`);
  const orgs = await jsonRows(db`SELECT to_jsonb(o)::text AS j FROM club_organizations o ORDER BY o.id`);
  const [history] = await db`
    SELECT md5(string_agg(o.id::text || ':' || s.year::text || ':' || coalesce(afldb_identity_for_season(o.id, s.year)::text, '-'),
                          ',' ORDER BY o.id, s.year)) AS d
      FROM club_organizations o CROSS JOIN seasons s
     WHERE s.year <= ${previous}::smallint`;
  const identityForYear = (await db`
    SELECT o.id AS org, afldb_identity_for_season(o.id, ${year}::smallint) AS club
      FROM club_organizations o ORDER BY o.id`).map((r) => ({ org: Number(r.org), club: r.club === null ? null : Number(r.club) }));
  const [prevList] = await db`
    SELECT array_to_string(array_agg(id ORDER BY id), ',') AS ids FROM afldb_season_list_clubs(${previous}::smallint)`;
  const [yearList] = await db`
    SELECT array_to_string(array_agg(id ORDER BY id), ',') AS ids FROM afldb_season_list_clubs(${year}::smallint)`;
  const [batch] = await db`SELECT count(*)::int AS n, coalesce(max(id), 0)::int AS mx FROM import_batches`;
  return {
    maxYear: max?.m ?? null,
    seasons,
    clubs,
    orgs,
    identityHistoryDigest: history?.d ?? "",
    identityForYear,
    listPrevious: idList(prevList?.ids ?? null),
    listYear: idList(yearList?.ids ?? null),
    batches: { n: Number(batch.n), maxId: Number(batch.mx) }
  };
}
var num = (v) => v === null || v === void 0 ? null : Number(v);
function seasonCore(row) {
  return { year: num(row.year), league: row.league, status: row.status, notes: row.notes ?? null };
}
function classifyOpening(exp, facts) {
  const problems = [];
  const row = facts.seasons.find((s) => num(s.year) === exp.year) ?? null;
  let season = "present";
  if (row === null) {
    season = "change";
    if (facts.maxYear !== exp.previousYear) {
      problems.push(`the seasons table ends at ${String(facts.maxYear)}, not ${exp.previousYear}; the season ${exp.year} row would not be the next season`);
    }
  } else {
    const core = seasonCore(row);
    const want = { year: exp.year, league: exp.league, status: exp.status, notes: exp.notes };
    if (JSON.stringify(core) !== JSON.stringify(want)) {
      problems.push(`season ${exp.year} exists but differs from the tracked contract (live ${JSON.stringify(core)}, expected ${JSON.stringify(want)}); nothing is adopted or overwritten`);
    }
    if (facts.maxYear !== exp.year) problems.push(`season ${exp.year} exists but the seasons table ends at ${String(facts.maxYear)}`);
  }
  const histCounts = /* @__PURE__ */ new Map();
  for (const club of facts.clubs) {
    const key = String(club.legacy_club_hist);
    histCounts.set(key, [...histCounts.get(key) ?? [], club]);
  }
  const clubs = [];
  const openHists = new Set(exp.open.map((o) => o.hist));
  for (const open of exp.open) {
    const live = histCounts.get(open.hist) ?? [];
    if (live.length !== 1) {
      problems.push(`identity ${open.hist} resolves to ${live.length} clubs rows, not exactly one`);
      continue;
    }
    const c = live[0];
    const id = Number(c.id);
    if (c.slug !== open.slug) problems.push(`identity ${open.hist}: live slug ${String(c.slug)} differs from the register (${open.slug})`);
    if (c.is_current_afl_club !== true || c.succession !== "current") problems.push(`identity ${open.hist} is not a current AFL club in the database`);
    if (num(c.first_season) !== open.firstSeason) problems.push(`identity ${open.hist}: first_season ${String(c.first_season)} differs from the register (${open.firstSeason}); it is never changed here`);
    if (num(c.current_identity_id) !== id) problems.push(`identity ${open.hist}: current_identity_id is not itself`);
    const last = num(c.last_season);
    let action;
    if (last === exp.previousYear) action = "change";
    else if (last === exp.year) action = "present";
    else {
      problems.push(`identity ${open.hist}: last_season is ${String(last)}, expected ${exp.previousYear} (to open) or ${exp.year} (already open)`);
      continue;
    }
    clubs.push({ id, hist: open.hist, slug: open.slug, organizationId: Number(c.organization_id), action });
  }
  const liveCurrent = facts.clubs.filter((c) => c.is_current_afl_club === true).map((c) => String(c.legacy_club_hist));
  const extra = liveCurrent.filter((h) => !openHists.has(h));
  if (extra.length > 0) problems.push(`the database's current clubs differ from the register: not open in clubs.json: ${extra.join(", ")}`);
  const orgs = [];
  for (const orgId of [...new Set(clubs.map((c) => c.organizationId))].sort((a, b) => a - b)) {
    const org = facts.orgs.find((o) => num(o.id) === orgId);
    if (!org) {
      problems.push(`organisation ${orgId} does not exist`);
      continue;
    }
    const last = num(org.last_season);
    if (last === exp.previousYear) orgs.push({ id: orgId, action: "change" });
    else if (last === exp.year) orgs.push({ id: orgId, action: "present" });
    else problems.push(`organisation ${orgId}: last_season is ${String(last)}, expected ${exp.previousYear} or ${exp.year}`);
  }
  const pending = season === "change" || clubs.some((c) => c.action === "change") || orgs.some((o) => o.action === "change");
  return { state: problems.length > 0 ? "REFUSED" : pending ? "NOT_OPEN" : "OPEN", season, clubs, orgs, problems };
}
var changesOf = (c) => ({
  insertSeason: c.season === "change",
  clubIds: c.clubs.filter((x) => x.action === "change").map((x) => x.id).sort((a, b) => a - b),
  orgIds: c.orgs.filter((x) => x.action === "change").map((x) => x.id).sort((a, b) => a - b)
});
function stable(value) {
  return JSON.stringify(value, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
}
function surfaceDigest(facts) {
  return createHash("sha256").update(stable({
    seasons: facts.seasons,
    clubs: facts.clubs,
    orgs: facts.orgs,
    history: facts.identityHistoryDigest,
    forYear: facts.identityForYear,
    listPrevious: facts.listPrevious,
    listYear: facts.listYear
  })).digest("hex");
}

// docs/v2/evidence/remediation-20261114/rollover/prod-facts-entry.mts
var dsn = process.env.RV_DSN;
if (!dsn) {
  console.log("ERROR no RV_DSN");
  process.exit(2);
}
var sql = postgres(dsn, { max: 1, connect_timeout: 10, onnotice: () => {
}, connection: { default_transaction_read_only: true, TimeZone: process.env.RV_TZ ?? "Etc/UTC", statement_timeout: 6e4 } });
try {
  const out = await sql.begin("isolation level repeatable read read only", async (tx) => {
    const [id] = await tx`
      SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro,
             current_setting('TimeZone') AS tz, current_user AS usr, inet_server_port()::text AS port, current_setting('server_version') AS pg,
             (SELECT max(name) FROM afldb_meta.schema_migrations) AS ledger, (SELECT count(*)::text FROM afldb_meta.schema_migrations) AS ledger_n,
             now()::text AS at
        FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
    if (id.ro !== "on") throw new Error("transaction is not read only");
    const asserted = { db: process.env.RV_EXPECT_DB ?? "", oid: process.env.RV_EXPECT_OID ?? "", sysid: process.env.RV_EXPECT_SYSID ?? "" };
    if (asserted.db && (id.db !== asserted.db || asserted.oid && id.oid !== asserted.oid || asserted.sysid && id.sysid !== asserted.sysid)) {
      throw new Error("identity differs from the asserted identity; no further read");
    }
    const exp = expectedOpening(seasons_default, clubs_default);
    const facts = await readOpeningFacts(tx, exp.year);
    const verdict = classifyOpening(exp, facts);
    const changes = changesOf(verdict);
    const seasonsTail = facts.seasons.filter((s) => Number(s.year) >= exp.year - 2).map((s) => ({ year: s.year, league: s.league, status: s.status, notes: s.notes, matchCount: s.match_count ?? null, dataThrough: s.data_through_date ?? null }));
    const currentClubs = facts.clubs.filter((c) => c.is_current_afl_club).map((c) => ({ id: c.id, slug: c.slug, first: c.first_season, last: c.last_season, org: c.organization_id }));
    const [counts] = await tx`
      SELECT (SELECT count(*)::int FROM fixtures WHERE season = ${exp.year}) AS fixtures_year,
             (SELECT count(*)::int FROM matches WHERE season = ${exp.year}) AS matches_year,
             (SELECT count(*)::int FROM matches WHERE season = ${exp.previousYear}) AS matches_prev,
             (SELECT count(*)::int FROM fixtures f WHERE f.season = ${exp.year} AND NOT EXISTS (SELECT 1 FROM seasons s WHERE s.year = f.season)) AS fk_fixtures_year`;
    const [dependents] = await tx`
      SELECT (SELECT count(*)::int FROM matches WHERE season = ${exp.year}) + (SELECT count(*)::int FROM club_seasons WHERE season = ${exp.year})
           + (SELECT count(*)::int FROM staging.afl_api_match WHERE season = ${exp.year}) AS n`;
    const privileges = await tx`
      SELECT r.role, t.relation, p.privilege, has_table_privilege(r.role, t.relation, p.privilege) AS granted
        FROM (VALUES ('afldb_import'), ('afldb_app'), ('afldb_backup')) AS r(role)
        CROSS JOIN (VALUES ('seasons'), ('clubs'), ('club_organizations'), ('import_batches'), ('sources')) AS t(relation)
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege)
       WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role)
       ORDER BY 1, 2, 3`;
    return {
      id,
      privileges,
      asserted: asserted.db ? "asserted" : "recorded-only",
      verdict: verdict.state,
      problems: verdict.problems,
      seasonRow: verdict.season,
      openIdentities: exp.open.length,
      clubsToChange: changes.clubIds.length,
      orgsToChange: changes.orgIds.length,
      maxYear: facts.maxYear,
      seasonsTail,
      currentClubs,
      orgsLast: facts.orgs.map((o) => ({ id: o.id, last: o.last_season })),
      identityResolvedForYear: facts.identityForYear.filter((r) => r.club !== null).length,
      listPrevious: facts.listPrevious.length,
      listYear: facts.listYear.length,
      surfaceDigest: surfaceDigest(facts),
      importBatches: facts.batches,
      counts,
      dependentsOfYear: dependents.n
    };
  });
  console.log(JSON.stringify(out));
} catch (e) {
  console.log("ERROR", String(e.message).replace(/postgres(ql)?:\/\/\S+/g, "<dsn>").slice(0, 300));
} finally {
  await sql.end();
}
