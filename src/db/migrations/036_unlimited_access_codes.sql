-- =====================================================================
-- AFLDB 036 — Unlimited-use beta access codes
-- =====================================================================
-- Migration 023 gave every access code a finite max_uses. That is the
-- right default — a code that leaks should burn out — but it makes the
-- standing case awkward: a code handed to a small group of trusted beta
-- users, or kept for the operator's own tooling, has no natural number
-- and gets an arbitrary one instead, which then runs out at the worst
-- moment.
--
-- NULL now means unlimited. That is ALREADY the convention in this exact
-- table: expires_at NULL means "never expires", and the redeem query
-- reads it as `(expires_at IS NULL OR expires_at > now())`. max_uses
-- gains the matching `(max_uses IS NULL OR use_count < max_uses)`.
--
-- The CHECK (max_uses > 0) is deliberately left in place: a CHECK passes
-- on NULL, so it still rejects zero and negatives while permitting
-- unlimited. No constraint change is needed, only the null-ability.
--
-- use_count keeps counting either way, so an unlimited code still shows
-- how much it has been used, and revoked_at is still the way to stop one.
-- Unlimited means uncapped, not unrevocable.
-- =====================================================================

ALTER TABLE beta_access_codes ALTER COLUMN max_uses DROP NOT NULL;

COMMENT ON COLUMN beta_access_codes.max_uses IS
  'How many times the code may be redeemed. NULL means unlimited, the same '
  'way a NULL expires_at means it never expires. Revoke to stop one.';
