-- =====================================================================
-- AFLDB 008 — Search
-- =====================================================================
-- Supports exact, prefix, partial and fuzzy matching without a separate
-- search engine. Canonical display names are never modified; matching
-- happens against normalised companion columns.
-- =====================================================================

-- Normalisation -------------------------------------------------------
-- Lowercase, strip accents, remove punctuation (apostrophes, hyphens,
-- full stops), collapse whitespace. Applied to search columns only.
-- IMMUTABLE so it can be used in index expressions.
CREATE OR REPLACE FUNCTION afldb_normalise_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(lower(public.unaccent('public.unaccent', input)), '[''`.\-_,]', '', 'g'),
           '\s+', ' ', 'g'));
$$;
COMMENT ON FUNCTION afldb_normalise_name IS
  'Search normalisation: lowercase, unaccent, strip punctuation, collapse whitespace. Display names are unaffected.';

-- Trigram indexes -----------------------------------------------------
-- gin_trgm_ops supports both fuzzy (similarity) and partial (LIKE
-- %term%) matching. Whether they are actually used is verified with
-- EXPLAIN ANALYZE in Phase 8 rather than assumed.
CREATE INDEX ix_players_search_trgm
  ON players USING gin (search_name gin_trgm_ops);

CREATE INDEX ix_player_aliases_trgm
  ON player_name_aliases USING gin (search_alias gin_trgm_ops);

CREATE INDEX ix_clubs_name_trgm
  ON clubs USING gin (afldb_normalise_name(name) gin_trgm_ops);

CREATE INDEX ix_club_aliases_trgm
  ON club_aliases USING gin (afldb_normalise_name(alias) gin_trgm_ops);

CREATE INDEX ix_venues_name_trgm
  ON venues USING gin (afldb_normalise_name(canonical_name) gin_trgm_ops);

CREATE INDEX ix_venue_aliases_trgm
  ON venue_aliases USING gin (afldb_normalise_name(alias) gin_trgm_ops);

-- Prefix matching for autocomplete. text_pattern_ops makes
-- `search_name LIKE 'abl%'` an index range scan.
CREATE INDEX ix_players_search_prefix
  ON players (search_name text_pattern_ops);

-- Autocomplete ranking ------------------------------------------------
-- Autocomplete must rank prominent players above obscure ones. Career
-- games is the ranking signal, so it is denormalised onto players by the
-- derived rebuild. NULL until the first rebuild.
ALTER TABLE players ADD COLUMN search_rank integer;
COMMENT ON COLUMN players.search_rank IS
  'DERIVED ranking signal (career games) for search ordering. Rebuilt with the derived-data pass.';

CREATE INDEX ix_players_search_rank ON players (search_rank DESC NULLS LAST);
