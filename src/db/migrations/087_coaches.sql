-- =====================================================================
-- AFLDB 087 — Coaches and match coaching assignments (AFLDB-ISSUE-118 Stage E2)
-- =====================================================================
-- AFLDB has never modelled coaching. The accepted fitzRoy / AFL Tables
-- baseline carries a per-match `Coach` column — exactly one coach per
-- (match, club), 32,034 of 33,676 team-matches, gaps only before 1923
-- and eleven records in 1940 — but the column names the coach; it does
-- not key the person. Sixteen of its 383 strings name two or three
-- canonical players (Ron Barassi, Mark Williams …) and eighteen name
-- people who never played a VFL/AFL match (Chris Fagan, John Todd,
-- Neil Craig …). So:
--
--   * coaches       one row per PERSON who coached, keyed by the AFL
--                   Tables coach page (coaches/<Name>.html). Where that
--                   page links a "Player Stats" profile — the very
--                   players/<L>/<Name>.html path external_identities
--                   holds — the row links to the existing players row.
--                   A coach with no such link is a coach-only person:
--                   player_id NULL, link_status 'unmatched', and NO
--                   players row is ever fabricated for them. A name is
--                   never identity (runbook §23.27 E2.2).
--   * match_coaches the coaching assignment at its true grain: this
--                   coach coached this club in this match. Caretakers
--                   and mid-season changes are simply the coach of that
--                   match; there are no season ranges to keep right.
--
-- Games coached, W/D/L, win percentage, finals, Grand Finals and
-- premierships are DERIVED from match_coaches ⋈ matches, never stored.
-- The one number kept from the source, coaches.source_games_coached,
-- is the coach page's own count retained as cross-check evidence
-- against the snapshot column, and is not a total to be read.
-- =====================================================================

CREATE TABLE coaches (
  id                    integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- Identity: the AFL Tables coach page path, coaches/<Given>_<Surname><n>.html.
  afltables_coach_path  text        NOT NULL UNIQUE,
  -- The snapshot's exact "Surname, Given" string, unique across the index;
  -- the ONLY thing the per-match column is joined on, by exact string.
  name_key              text        NOT NULL UNIQUE,
  display_name          text        NOT NULL,
  given_name            text,
  surname               text,
  dob                   date,

  -- The person seam. NULL for a coach who never played; otherwise the
  -- players row reached through the coach page's Player Stats profile
  -- path and external_identities (source afltables). One coach row per
  -- player at most.
  player_id             integer     REFERENCES players(id),
  link_status_value     link_status NOT NULL DEFAULT 'unmatched',
  afltables_profile_path text,

  -- Evidence only (see header): the coach page's Games Coached count.
  source_games_coached  integer,

  source_id             smallint    NOT NULL REFERENCES sources(id),
  source_record_id      text        NOT NULL,
  import_batch_id       bigint      REFERENCES import_batches(id),
  notes                 text,

  -- A linked coach is exactly a 'unique' link; nothing else carries a player.
  CONSTRAINT coaches_link_ck CHECK (
    (player_id IS NOT NULL AND link_status_value = 'unique')
    OR (player_id IS NULL AND link_status_value <> 'unique')
  ),
  CONSTRAINT coaches_profile_link_ck CHECK (player_id IS NULL OR afltables_profile_path IS NOT NULL)
);
CREATE UNIQUE INDEX coaches_player_uq ON coaches (player_id) WHERE player_id IS NOT NULL;

COMMENT ON TABLE coaches IS
  'One row per person who coached a VFL/AFL match, keyed by the AFL Tables coach page. player_id links a coach who also played to the existing players row through the page''s profile path — never by name. Coach-only people have player_id NULL and no players row.';
COMMENT ON COLUMN coaches.name_key IS
  'The exact "Surname, Given" string the fitzRoy per-match Coach column prints; unique across the AFL Tables index, so the column joins here by exact string and nowhere else.';
COMMENT ON COLUMN coaches.source_games_coached IS
  'The coach page''s own Games Coached count, kept as cross-check evidence against match_coaches. Not a total: derive games from match_coaches.';

CREATE TABLE match_coaches (
  match_id          integer  NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  club_id           integer  NOT NULL REFERENCES clubs(id),
  coach_id          integer  NOT NULL REFERENCES coaches(id),
  source_id         smallint NOT NULL REFERENCES sources(id),
  source_record_id  text     NOT NULL,
  import_batch_id   bigint   REFERENCES import_batches(id),
  PRIMARY KEY (match_id, club_id)
);
CREATE INDEX ix_match_coaches_coach ON match_coaches (coach_id, match_id);

COMMENT ON TABLE match_coaches IS
  'The coach of a club in a match — the authoritative coaching grain. Caretakers and mid-season changes are just the coach of that match. Games, W/D/L, finals and premierships are derived from this table joined to matches.';

-- The club must be one of the match's two clubs. A trigger rather than a
-- CHECK because the rule reads another table.
CREATE OR REPLACE FUNCTION match_coaches_club_in_match() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM matches m
     WHERE m.id = NEW.match_id AND NEW.club_id IN (m.home_club_id, m.away_club_id)
  ) THEN
    RAISE EXCEPTION 'match_coaches: club % is not a club of match %', NEW.club_id, NEW.match_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER match_coaches_club_in_match_trg
  BEFORE INSERT OR UPDATE ON match_coaches
  FOR EACH ROW EXECUTE FUNCTION match_coaches_club_in_match();

-- Fail-closed role registries (039 / 045): the app reads both, the ETL
-- role writes both. privileges.sql reconciles from these rows.
SELECT afldb_meta.grant_app_read('coaches');
SELECT afldb_meta.grant_app_read('match_coaches');
SELECT afldb_meta.grant_import_write('coaches');
SELECT afldb_meta.grant_import_write('match_coaches');
