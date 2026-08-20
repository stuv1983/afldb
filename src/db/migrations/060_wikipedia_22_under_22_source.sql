-- AFLDB 060 — Provenance for the AFLPA 22 Under 22 annual teams
-- =====================================================================
-- The selection facts are loaded after the core player/club/season data
-- by tools/migration/import_awards.py --groups under_22. They cannot live
-- in a schema migration because award_winners.season references seasons,
-- which is intentionally empty until the historical import runs.

INSERT INTO sources (key, name, url, kind, description) VALUES (
  'wikipedia_22under22',
  '22 Under 22 team',
  'https://en.wikipedia.org/wiki/22_Under_22_team',
  'scrape',
  'Annual AFL Players'' Association 22 Under 22 team tables extracted from '
  || 'Wikipedia on 2026-08-20. The committed extract covers 2012–2026; the '
  || 'separate most-selections summary is excluded because it is derived and '
  || 'contains known omissions.'
)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      url = EXCLUDED.url,
      kind = EXCLUDED.kind,
      description = EXCLUDED.description;
