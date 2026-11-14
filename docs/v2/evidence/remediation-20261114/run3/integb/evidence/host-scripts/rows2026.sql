SELECT stat_key, season, is_recorded, coverage::text, populated_rows, total_rows FROM stat_availability WHERE season = 2026 ORDER BY stat_key;
