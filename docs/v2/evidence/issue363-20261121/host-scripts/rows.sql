-- ISSUE-363 (2026-11-21): one line per (row, column) of the award/honour tables the awards-reload-links file reloads:
--   <table> <id> <column>=<jsonb value>
-- Compared host-side only (template vs after); the summary that leaves the host is aggregate counts per table/column.
\pset pager off
\pset tuples_only on
\pset format unaligned
SELECT x.t || ' ' || x.id || ' ' || e.k || '=' || coalesce(e.v::text, 'null')
  FROM (
    SELECT 'award_winners' AS t, w.id, to_jsonb(w) AS j FROM award_winners w
    UNION ALL SELECT 'award_nominations', n.id, to_jsonb(n) FROM award_nominations n
    UNION ALL SELECT 'hall_of_fame', h.id, to_jsonb(h) FROM hall_of_fame h
    UNION ALL SELECT 'honour_team_members', m.id, to_jsonb(m) FROM honour_team_members m
    UNION ALL SELECT 'captaincies', c.id, to_jsonb(c) FROM captaincies c
    UNION ALL SELECT 'awards', a.id, to_jsonb(a) FROM awards a
  ) x, jsonb_each(x.j) AS e(k, v)
 ORDER BY x.t, x.id, e.k;
