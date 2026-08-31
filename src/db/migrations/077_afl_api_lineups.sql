-- ---------------------------------------------------------------------
-- 077 — AFLDB-ISSUE-100: the AFL API source row and the staging-only
--       lineup / team-announcement projection
-- ---------------------------------------------------------------------
-- Lineups are STAGING-ONLY and never become canonical participation.
-- Canonical participation is the played match sheet (player_match_stats),
-- which exists only after a match. Nothing here writes, references or
-- implies a canonical participation fact: there is no player_match_stats
-- reference, no trigger, no rule, no default and no DML against any
-- canonical table. An announced player is not a player who played, and
-- this schema is deliberately incapable of saying otherwise.
--
-- OPTION B, approved after the AFLDB-ISSUE-100 L3A identity adjudication.
-- A lineup row exists because the PROVIDER ANNOUNCED IT. Whether AFLDB can
-- resolve that announcement to a canonical match, club or player is
-- SEPARATE ENRICHMENT, and its failure is an expected state rather than a
-- reason to discard evidence. So provider identity is NOT NULL and is the
-- row's identity; match_id, club_id and player_id are NULLABLE and
-- participate in no key.
--
-- That is not a new pattern. staging.external_current_matches (migration
-- 063) is already exactly this shape: keyed on (source_id,
-- external_game_id), with home_club_id, away_club_id and local_match_id
-- all nullable and the raw source strings kept beside them.
--
-- WHY match_id CAN NEVER BE REQUIRED. matches.home_score, away_score,
-- result and margin are all NOT NULL (migration 003), so an unplayed
-- fixture is structurally unstorable in matches. A team announcement
-- arrives BEFORE the match is played, so at announcement time the
-- canonical row cannot exist yet. Requiring match_id would discard the
-- exact rows this table exists to hold, and inventing a placeholder match
-- would manufacture a canonical fact from an announcement. Neither is
-- permitted.
--
-- Migrations 073, 074, 075 and 076 are applied and checksum-frozen.
-- Nothing here edits them.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 1 — source registration, fail-closed
-- =====================================================================
-- Migrations 060 and 063 register a source with ON CONFLICT DO UPDATE.
-- That is safe for a key those migrations introduced, but it would let
-- this migration silently take ownership of a pre-existing `afl_api` row
-- that some other workstream created for a different endpoint or purpose,
-- rewriting its provenance without a word. So this registration is
-- idempotent on a row that already means what we mean, and REFUSES a row
-- that does not.
--
-- The refusal keys on the two identity-bearing fields, `kind` and `url`.
-- `name` and `description` are prose and are deliberately NOT compared:
-- re-wording them is not a change of ownership, and an existing row's
-- wording is left untouched rather than overwritten.
DO $$
DECLARE
  existing sources%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM sources WHERE key = 'afl_api';

  IF NOT FOUND THEN
    INSERT INTO sources (key, name, url, kind, description) VALUES (
      'afl_api',
      'AFL.com.au API (via fitzRoy)',
      'https://www.afl.com.au/',
      'upstream_dataset',
      -- Describes the PROVIDER generally and the LINEUP family specifically.
      -- It deliberately does NOT state a policy for every future afl_api
      -- family: AFLDB-ISSUE-100 established one binding family policy, for
      -- afl_api.lineup. afl_api.roster is not_yet_declared and any later
      -- family is separately adjudicated, so freezing a rule for all of them
      -- in a source row would assert more than this issue proved.
      --
      -- "no operator-supplied API key" is deliberate and narrower than
      -- "unauthenticated": AFLDB configures no AFL API credential, but
      -- fitzRoy handles the AFL.com.au web/API access mechanism itself and
      -- nothing here claims there is no token, cookie or header beneath it.
      'Unofficial AFL.com.au API reached through the third-party fitzRoy '
      || 'package. Access requires no operator-supplied API key and depends '
      || 'on AFL.com.au''s web/API behaviour, which may change without '
      || 'notice. AFLDB-ISSUE-100 uses fetch_lineup_afl for team '
      || 'announcements; afl_api.lineup is staging-only and never canonical '
      || 'match participation.'
    );

  ELSIF existing.kind IS DISTINCT FROM 'upstream_dataset'
     OR existing.url  IS DISTINCT FROM 'https://www.afl.com.au/' THEN
    RAISE EXCEPTION
      'sources.key ''afl_api'' already exists with different provenance '
      '(kind=%, url=%). Migration 077 refuses to overwrite a source row it '
      'did not create. Reconcile the existing row deliberately before '
      'applying this migration.',
      existing.kind, existing.url;
  END IF;
END $$;

-- =====================================================================
-- 2 — staging.afl_api_lineup
-- =====================================================================
-- One row per provider lineup player row: one announced player, in one
-- team, for one match.
--
-- NULL SEMANTICS: NULL is "not supplied" or "not resolved", never zero,
-- never false and never "absent from the team". In particular a NULL
-- club_id means AFLDB could not resolve the provider's team to a club —
-- it does NOT mean the player has no team.
CREATE TABLE staging.afl_api_lineup (
  -- The observation this projection was derived from. version_seq is part
  -- of the key RELATIONSHIP, not of the grain: one current projection per
  -- record, always naming the exact version it came from. Mirrors
  -- staging.afltables_match / afltables_player_match (migration 076).
  -- source_id is NOT constrained to sources.key = 'afl_api' here, and
  -- deliberately not: SQL cannot express that without either a trigger or a
  -- redundant source_key column, and this migration installs no trigger and
  -- stores no redundant key. The invariant is therefore an EXECUTABLE one,
  -- owned by the lineup persistence path (AFLDB-ISSUE-100 L3B2) and proven by
  -- its behavioural tests, not by this schema:
  --   * persistence resolves source_id internally from the literal key
  --     'afl_api'; a caller cannot supply an arbitrary source_id;
  --   * persistence refuses when sources.key = 'afl_api' is absent;
  --   * persistence never projects another source's observation into this
  --     table.
  -- The family CHECK below pins the other half of the pair structurally.
  source_id            smallint    NOT NULL,
  family               text        NOT NULL,
  external_record_id   text        NOT NULL,
  version_seq          integer     NOT NULL,

  -- Provider identity: the authoritative staging identity. These are the
  -- three components external_record_id is composed from, stored
  -- separately so a query can filter a match or a team without parsing
  -- the composite key.
  provider_match_id    text        NOT NULL,
  provider_team_id     text        NOT NULL,
  provider_player_id   text        NOT NULL,

  -- Scope: the acquisition grain, matching scope_key season=<int>;round=<int>.
  season               smallint    NOT NULL REFERENCES seasons(year),
  round_number         smallint    NOT NULL,
  -- Display evidence. "Wildcard Finals" at round 25 is why the integer
  -- alone does not identify a round (probe P3).
  round_name           text,

  -- Source announcement state. These are what make a lineup change
  -- meaningful rather than noise, and they are deliberately NOT
  -- constrained to an enum: two rounds of one competition produced two
  -- observed values each, which is a measurement and not an exhaustive
  -- provider vocabulary.
  status               text        NOT NULL,
  team_status          text        NOT NULL,

  -- Team placement. Nullable: proven present with 0 NULLs across two
  -- rounds (probe P3b), which establishes them as typed and usable but is
  -- NOT a provider guarantee that they can never be absent.
  team_type            text,
  position             text,
  -- `text`, following AFLDB's schema-wide convention: player_match_stats
  -- (004), staging_aflw.player_match_stats (025) and
  -- staging.afltables_player_match (076) all store it as text, and 025
  -- states the reason outright — it identifies rather than counts. The AFL
  -- API happens to return an integer, but storing it as one here would
  -- make this the only numeric jumper number in the schema and would put a
  -- cast in the middle of exactly the reconciliation query this table
  -- exists to serve: announced jumper versus played jumper.
  jumper_number        text,

  -- Raw team-resolution evidence. Enrichment INPUT and provenance for a
  -- failed resolution, never identity — they are not in any key. Kept for
  -- the same reason matches.venue_raw is kept beside venue_id: when
  -- resolution fails, the string that failed is the finding. P3b measured
  -- six of eighteen team names outside the controlled alias set
  -- ('Adelaide Crows', 'Gold Coast SUNS', ...), so this is not
  -- hypothetical.
  team_name_raw        text,
  team_abbr_raw        text,
  team_nickname_raw    text,

  -- Canonical enrichment. ALL NULLABLE, ALL OUTSIDE ROW IDENTITY.
  -- A NULL here is an unresolved identity, which is an expected staging
  -- state and never a reason to drop the row.
  --
  -- match_id in particular is nullable BY STRUCTURAL NECESSITY, not by
  -- preference: see the header. It also carries NO implication that the
  -- announced player played in that match — this is a link to the fixture
  -- the announcement was for, and participation lives only in
  -- player_match_stats, which this table does not reference.
  match_id             integer     REFERENCES matches(id),
  club_id              integer     REFERENCES clubs(id),
  player_id            integer     REFERENCES players(id),

  projected_by_batch_id bigint     NOT NULL REFERENCES import_batches(id),
  projected_at          timestamptz NOT NULL DEFAULT now(),

  -- Identity is the source observation, never the canonical resolution.
  -- The provider row remains the same observation whether AFLDB resolves
  -- it today, later, or never.
  PRIMARY KEY (source_id, family, external_record_id),
  FOREIGN KEY (source_id, family, external_record_id, version_seq)
    REFERENCES staging.source_record_versions
      (source_id, family, external_record_id, version_seq),

  -- Structural constraints only. Every one of these encodes a type or
  -- domain invariant; none encodes the two-round observed vocabulary.
  CONSTRAINT afl_api_lineup_family_ck CHECK (family = 'lineup'),

  -- Provider identity must be present and usable. The delimiter check is
  -- the schema half of the family-local external_record_id encoding
  -- `providerId|teamId|player.playerId`: a component containing the
  -- delimiter would make the composite key ambiguous, and the emitter
  -- already refuses it. Enforced here too so the invariant survives any
  -- future writer.
  CONSTRAINT afl_api_lineup_provider_ids_ck CHECK (
    btrim(provider_match_id)  <> '' AND provider_match_id  NOT LIKE '%|%'
    AND btrim(provider_team_id)   <> '' AND provider_team_id   NOT LIKE '%|%'
    AND btrim(provider_player_id) <> '' AND provider_player_id NOT LIKE '%|%'
  ),
  CONSTRAINT afl_api_lineup_external_record_id_ck CHECK (
    btrim(external_record_id) <> ''
    -- The composite is exactly its three declared components, in declared
    -- order, joined by the family delimiter.
    AND external_record_id =
        provider_match_id || '|' || provider_team_id || '|' || provider_player_id
  ),

  CONSTRAINT afl_api_lineup_round_ck CHECK (round_number >= 0),

  -- Announcement state is required; it is what distinguishes a
  -- provisional team from a final one.
  CONSTRAINT afl_api_lineup_state_ck CHECK (
    btrim(status) <> '' AND btrim(team_status) <> ''
  ),

  -- A jumper number, when supplied, is a positive integer with no leading
  -- zeros. This is the text encoding of "> 0" and is a domain invariant,
  -- not the observed 1-51 range: widening it later is a forward migration.
  CONSTRAINT afl_api_lineup_jumper_ck CHECK (
    jumper_number IS NULL OR jumper_number ~ '^[1-9][0-9]*$'
  )
);

COMMENT ON TABLE staging.afl_api_lineup IS
  'One announced player in one team for one match, as the AFL API supplied it. STAGING-ONLY: an announced player is NOT a player who played, this table is never canonical participation, and no row here is promotable (afl_api.lineup promotion_policy is never).';
COMMENT ON COLUMN staging.afl_api_lineup.external_record_id IS
  'providerId|teamId|player.playerId, the family-local encoding. Not a repository-wide convention: afltables.match uses | because it inherits matches.match_key, and afltables.player_match_stats uses @ around one.';
COMMENT ON COLUMN staging.afl_api_lineup.match_id IS
  'Nullable BY NECESSITY: matches requires NOT NULL scores/result/margin (migration 003), so an unplayed fixture cannot exist there and a team announcement precedes it. NULL means unresolved, never "no match". A non-NULL value links the announcement to a fixture and NEVER asserts the player played in it.';
COMMENT ON COLUMN staging.afl_api_lineup.club_id IS
  'Nullable. NULL means AFLDB could not resolve the provider team to a club, never that the player has no team. P3b measured six of eighteen AFL API team names outside the controlled alias set.';
COMMENT ON COLUMN staging.afl_api_lineup.player_id IS
  'Nullable. No afl_api identity exists in external_identities and no approved deterministic bridge populates one, so this is expected to be NULL until such a bridge is built. Never resolved from a player name.';
COMMENT ON COLUMN staging.afl_api_lineup.team_name_raw IS
  'Enrichment input and failed-resolution provenance, never identity. Kept for the same reason matches.venue_raw is kept beside venue_id.';
COMMENT ON COLUMN staging.afl_api_lineup.jumper_number IS
  'Text because it identifies rather than counts, matching player_match_stats and staging_aflw.player_match_stats. NULL is not supplied, never 0.';
COMMENT ON COLUMN staging.afl_api_lineup.status IS
  'Provider match-level announcement state, stored as supplied. Deliberately not an enum: the observed vocabulary is a two-round measurement, not an exhaustive provider contract.';

-- =====================================================================
-- 3 — indexes
-- =====================================================================
-- tests/integration/fk-indexes.test.ts interrogates pg_catalog for
-- nspname = 'public' ONLY, so it does NOT cover this staging table. These
-- are therefore added by reading, which is precisely the discipline that
-- test's own header describes ("twice the same miss found by reading
-- rather than by failing"). Migration 076 indexed its staging projections
-- on the same basis.
--
-- Of the foreign keys here, only players is outside that test's
-- DELETE_FREE_PARENTS exemption list (sources, seasons, clubs, matches
-- and import_batches are all exempt as append-only or TRUNCATE-reloaded),
-- so ix_afl_api_lineup_player is the one an FK sweep would demand. The
-- rest are indexed for the admin/reconciliation reads this table exists
-- to serve.
CREATE INDEX ix_afl_api_lineup_version
  ON staging.afl_api_lineup
     (source_id, family, external_record_id, version_seq);
CREATE INDEX ix_afl_api_lineup_player  ON staging.afl_api_lineup (player_id);
CREATE INDEX ix_afl_api_lineup_club    ON staging.afl_api_lineup (club_id);
CREATE INDEX ix_afl_api_lineup_match   ON staging.afl_api_lineup (match_id);
CREATE INDEX ix_afl_api_lineup_batch   ON staging.afl_api_lineup (projected_by_batch_id);
CREATE INDEX ix_afl_api_lineup_season  ON staging.afl_api_lineup (season, round_number);
-- The provider-grain read: every announced player for one match, and for
-- one team within it. Not a foreign key — the canonical match may not
-- exist yet, and this projection must never depend on it.
CREATE INDEX ix_afl_api_lineup_provider_match
  ON staging.afl_api_lineup (provider_match_id, provider_team_id);

-- =====================================================================
-- 4 — grants
-- =====================================================================
-- Mirrors migration 076 exactly: the minimum a persistence path needs to
-- upsert projections and read them back inside one transaction. No
-- TRUNCATE is granted here.
--
-- STATED PLAINLY, because it would be easy to overclaim: this grant is
-- NOT a stronger boundary than the repository already has.
-- tools/maintenance/privileges.sql grants afldb_import SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE on ALL TABLES IN SCHEMA staging, so a
-- privileges reconcile gives afldb_import DELETE and TRUNCATE on this
-- table whether or not they are named here. ISSUE-100 does not attempt to
-- change that repository-wide policy. The real guarantee that no lineup
-- row is ever deleted or truncated is a property of the EXECUTABLE
-- PERSISTENCE CODE, proven by its own source assertions, not of this
-- grant. Not registered in privileges.sql, for the same reason 076 is
-- not: that file already covers the whole schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afl_api_lineup TO afldb_import;
GRANT SELECT ON staging.afl_api_lineup TO afldb_app;
