DO $canonical$
BEGIN
 IF EXISTS (SELECT 1 FROM public.player_match_stats WHERE id=705437 OR (player_id=2121 AND match_id=17214))
 OR (SELECT count(*) FROM public.player_match_stats p JOIN public.matches m ON m.id=p.match_id WHERE m.season=2026) <> 10028
 OR (SELECT count(*) FROM public.player_match_stats WHERE match_id=17214 AND club_id=6) <> 23
 OR (SELECT count(*) FROM staging.afltables_player_match WHERE season=2026) <> 10028
 OR EXISTS (SELECT 1 FROM public.player_match_stats p JOIN public.matches m ON m.id=p.match_id
   WHERE m.season=2026 AND NOT EXISTS (SELECT 1 FROM staging.afltables_player_match a
    WHERE a.season=2026 AND a.match_key=m.match_key AND a.player_id=p.player_id AND a.club_id=p.club_id))
 OR EXISTS (SELECT 1 FROM staging.afltables_player_match a WHERE a.season=2026 AND NOT EXISTS
   (SELECT 1 FROM public.player_match_stats p JOIN public.matches m ON m.id=p.match_id
    WHERE m.season=2026 AND m.match_key=a.match_key AND p.player_id=a.player_id AND p.club_id=a.club_id))
 THEN RAISE EXCEPTION 'I316 canonical/count/baseline gate refused'; END IF;
END $canonical$;
