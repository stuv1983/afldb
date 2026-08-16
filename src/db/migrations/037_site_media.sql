-- =====================================================================
-- AFLDB 037 — Uploaded images for the pages a super admin edits
-- =====================================================================
-- The coming-soon page at the apex is a STATIC file served by Caddy from
-- /var/www/afldb-soon (see docs/apex-coming-soon.md §1 for why). Its text
-- and images are now editable at /admin/content, which means the images
-- have to live somewhere the application can read at publish time and
-- somewhere a rebuilt server can be restored from.
--
-- That somewhere is here rather than a directory on disk, for three
-- reasons:
--
--   1. The nightly dump already covers it. An uploads directory would be
--      a second thing to back up, and the one nobody notices is missing
--      until the droplet is rebuilt.
--   2. The published directory stays DERIVED. /var/www/afldb-soon can be
--      deleted and regenerated from the database at any time, which is
--      what makes "Republish" a safe recovery step rather than a hope.
--   3. It needs no second writable path in the systemd unit. The service
--      is ProtectSystem=strict; every writable directory is an explicit
--      ReadWritePaths= line, and the publish target is already one too
--      many to add without cause.
--
-- These are a handful of page screenshots, capped by the application at
-- 2 MB each and 40 rows in total, so the ceiling is ~80 MB against a
-- database whose statistical tables are far larger. bytea is the right
-- shape at that size; it would not be at a hundred times it.
--
-- NOT readable by afldb_app. The public site never renders these — the
-- apex serves them from disk after a publish, and the admin preview reads
-- them on the auth pool like every other admin screen. site_settings
-- (034) is public-readable because the home page must render it; this
-- table has no such requirement and so gets no such grant.
-- =====================================================================

CREATE TABLE site_media (
  name        text PRIMARY KEY,
  mime        text        NOT NULL,
  bytes       bytea       NOT NULL,
  byte_size   integer     NOT NULL,
  width       integer     NOT NULL,
  height      integer     NOT NULL,
  alt         text        NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by integer     REFERENCES auth_users(id),

  -- The name becomes a FILE NAME under /var/www/afldb-soon/img/u/ and a
  -- URL path segment on a public page. Constraining it here as well as in
  -- the application is defence in depth for the one column in this schema
  -- that is interpolated into a filesystem path: no dot-segments, no
  -- separators, no leading dot, nothing that needs escaping in a URL.
  CONSTRAINT site_media_name_is_a_safe_filename
    CHECK (name ~ '^[a-z0-9][a-z0-9._-]{0,59}\.(webp|png|jpg)$' AND name !~ '\.\.'),

  -- Sniffed from the file's magic bytes by src/lib/image-probe.ts, never
  -- taken from the upload's Content-Type. Listed again here so a row that
  -- bypassed the application cannot claim to be something the page would
  -- then serve with that type.
  CONSTRAINT site_media_mime_is_an_image
    CHECK (mime IN ('image/webp', 'image/png', 'image/jpeg')),

  CONSTRAINT site_media_dimensions_are_positive
    CHECK (width > 0 AND height > 0 AND byte_size > 0)
);

COMMENT ON TABLE site_media IS
  'Images a super admin uploads at /admin/content, published to disk for the '
  'static apex page. Source of truth: /var/www/afldb-soon is derived from this '
  'table and can be regenerated from it. Not readable by afldb_app.';
COMMENT ON COLUMN site_media.name IS
  'File name, also the URL segment: served as /img/u/<name> on the apex. '
  'Constrained to a safe filename because it is interpolated into a path.';
COMMENT ON COLUMN site_media.mime IS
  'Sniffed from the leading bytes on upload, never from the client Content-Type.';
COMMENT ON COLUMN site_media.width IS
  'Intrinsic pixel width, read from the file header so the published <img> can '
  'carry width/height and reserve its space before the image loads.';
COMMENT ON COLUMN site_media.alt IS
  'Default alternative text, used when a page slot does not override it. Empty '
  'is legal and means the image is decorative.';

-- afldb_auth only: /admin/content writes these and the publisher reads
-- them, both on the auth pool. No grant to afldb_app — see the header.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON site_media TO afldb_auth;
  END IF;
END $$;
