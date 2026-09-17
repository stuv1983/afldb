-- =====================================================================
-- 099 - Name normalisation: Unicode whitespace is whitespace
-- =====================================================================
-- AFLDB-ISSUE-164 P1a. Forward-only. No raw source text is rewritten.
--
-- 008 introduced afldb_normalise_name() and 009 corrected its punctuation
-- classes. Both collapse whitespace with the regex '\s+', which under this
-- cluster matches ASCII whitespace ONLY. A name whose word separator is a
-- Unicode space therefore survives normalisation intact, and the
-- normalised string is never byte-equal to the ASCII-separated
-- players.search_name it is meant to match.
--
-- That is not hypothetical. ISSUE-164 P0 measured (operator, hex
-- evidence, 2026-09-12) that 5,057 of 5,057 draft_persons rows - 100% of
-- the draft source - use U+00A0 NO-BREAK SPACE as their separator:
--
--   'Aaron<U+00A0>Cadman'  ->  4161726f6e c2a0 4361646d616e
--
-- The consequence runs through the whole player-link matcher. The exact
-- arm of candidate blocking (player-match-candidates.ts) compares
-- players.search_name with afldb_normalise_name(raw) and cannot fire, so
-- a visually identical name reaches the scorer only through the trigram
-- arm at similarity 1.00 and is paid name_trigram_high (26) instead of
-- name_exact (44). It also fails strongName, which structurally excludes
-- the row from unattended approval at any score. The 79-point draft
-- plateau recorded on ISSUE-164 is this defect, not a weighting problem.
--
-- The fix belongs here and nowhere else. afldb_normalise_name() is the
-- single canonical implementation: TypeScript never forks it (see
-- src/lib/player-matching/types.ts:168), the Python ETL calls this same
-- function to compute players.search_name
-- (tools/migration/common.py:1099,1195), and every application lookup
-- goes through it. One function, one behaviour.
--
-- SCOPE, deliberately narrow. This canonicalises a NAMED, EXPLICIT list
-- of Unicode whitespace code points to an ordinary space before the
-- existing lower/unaccent/strip/collapse pipeline, using translate()
-- rather than a character class so each code point is visible in the
-- diff and no regex locale behaviour is relied on:
--
--   U+00A0 NO-BREAK SPACE              (the proven defect)
--   U+1680 OGHAM SPACE MARK
--   U+2000..U+200A EN QUAD .. HAIR SPACE (includes U+2007 FIGURE SPACE)
--   U+2028 LINE SEPARATOR
--   U+2029 PARAGRAPH SEPARATOR
--   U+202F NARROW NO-BREAK SPACE
--   U+205F MEDIUM MATHEMATICAL SPACE
--   U+3000 IDEOGRAPHIC SPACE
--
-- Every one of those is a separator in Unicode's own terms, so mapping it
-- to ' ' and letting the existing '\s+' collapse take over is the same
-- decision 008 already made for ASCII whitespace. Zero-width characters
-- (U+200B, U+FEFF) are NOT touched: they are not separators, and either
-- deleting them or turning them into a space would change how many words
-- a name has. No transliteration, no accent policy change, no
-- punctuation change - unaccent and the punctuation classes are exactly
-- as 009 left them, and ASCII names normalise byte-for-byte as before.
--
-- DERIVED VALUES. The function is IMMUTABLE and is used in index
-- expressions, so those indexes are rebuilt here exactly as 009 did;
-- without the REINDEX they would silently answer from the old function.
-- players.search_name and player_name_aliases.search_alias are stored
-- columns, not expressions, so they are recomputed here - guarded by IS
-- DISTINCT FROM, making this a no-op on a corpus whose names are already
-- ASCII-separated. display_name, alias, slug, sort_name and every *_raw
-- source column are untouched: source preservation and comparison
-- normalisation are separate concerns, and only the comparison output
-- changes.
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
             regexp_replace(
               lower(public.unaccent('public.unaccent',
                 translate(
                   input,
                   U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
                   '                  '))),
               '[''`.,]', '', 'g'),
             '[\-_/]', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;
COMMENT ON FUNCTION afldb_normalise_name IS
  'Search normalisation. Unicode whitespace (U+00A0 and the other space separators) is canonicalised to an ordinary space first; apostrophes and full stops are removed; hyphens, underscores and slashes become spaces so each name part stays independently searchable.';

-- Rebuild every index whose definition calls the function.
REINDEX INDEX ix_clubs_name_trgm;
REINDEX INDEX ix_club_aliases_trgm;
REINDEX INDEX ix_venues_name_trgm;
REINDEX INDEX ix_venue_aliases_trgm;

-- Recompute the two stored normalised columns. A no-op unless a player
-- or alias name itself carries Unicode whitespace; the raw display forms
-- are not read back or rewritten.
UPDATE players
   SET search_name = afldb_normalise_name(display_name)
 WHERE search_name IS DISTINCT FROM afldb_normalise_name(display_name);

UPDATE player_name_aliases
   SET search_alias = afldb_normalise_name(alias)
 WHERE search_alias IS DISTINCT FROM afldb_normalise_name(alias);
