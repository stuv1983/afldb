-- =====================================================================
-- AFLDB 009 — Correct name normalisation for hyphenated surnames
-- =====================================================================
-- 008 stripped hyphens entirely, so "Anthony McDonald-Tipungwuti"
-- normalised to "mcdonaldtipungwuti" and a search for "tipungwuti" could
-- not match on a prefix and matched only weakly on trigrams.
--
-- Correct treatment differs by punctuation class:
--   apostrophes / full stops  -> REMOVED   (O'Brien   -> obrien)
--   hyphens / underscores /
--   slashes                   -> SPACE     (A-B       -> a b)
--
-- The function is used in index expressions, so every dependent index is
-- rebuilt in the same transaction. Without the REINDEX those indexes
-- would silently return wrong results.
-- =====================================================================

CREATE OR REPLACE FUNCTION afldb_normalise_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(public.unaccent('public.unaccent', input)), '[''`.,]', '', 'g'),
             '[\-_/]', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;
COMMENT ON FUNCTION afldb_normalise_name IS
  'Search normalisation. Apostrophes and full stops are removed; hyphens, underscores and slashes become spaces so each name part stays independently searchable.';

-- Rebuild every index whose definition calls the function.
REINDEX INDEX ix_clubs_name_trgm;
REINDEX INDEX ix_club_aliases_trgm;
REINDEX INDEX ix_venues_name_trgm;
REINDEX INDEX ix_venue_aliases_trgm;

-- players.search_name and player_name_aliases.search_alias are stored
-- columns rather than expressions, so they are recomputed by the ETL
-- (tools/migration/) using this same function. They are empty at this
-- point in the migration sequence.
