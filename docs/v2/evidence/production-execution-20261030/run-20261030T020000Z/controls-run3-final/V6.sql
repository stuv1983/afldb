UPDATE afldb_meta.schema_migrations SET applied_at = now(), duration_ms = coalesce(duration_ms, 0) + 1 WHERE name >= '111';
UPDATE auth_users SET password_hash = password_hash || 'x', password_changed_at = now() WHERE id = (SELECT min(id) FROM auth_users);
