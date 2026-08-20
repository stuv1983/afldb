-- ---------------------------------------------------------------------
-- 059 — honour-team uniqueness follows player identity, not display name
-- ---------------------------------------------------------------------
-- A name is not an identity. The original (team_name, player_name_raw)
-- constraint caused an admin upsert for a linked player to overwrite a
-- different linked player with the same display name. Linked rows are
-- therefore keyed by player_id. Name remains the honest fallback only
-- while a row is unlinked and no stable identity exists.
-- ---------------------------------------------------------------------

-- Fail closed if existing data cannot satisfy the new linked identity
-- key. The migration runner will roll the whole migration back and expose
-- the conflicting team/player groups for deliberate review.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM honour_team_members
     WHERE player_id IS NOT NULL
     GROUP BY team_name, player_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'honour_team_members contains duplicate linked players within a team; resolve them before migration 059';
  END IF;
END
$$;

ALTER TABLE honour_team_members
  DROP CONSTRAINT honour_team_uq;

CREATE UNIQUE INDEX honour_team_linked_player_uq
  ON honour_team_members (team_name, player_id)
  WHERE player_id IS NOT NULL;

CREATE UNIQUE INDEX honour_team_unlinked_name_uq
  ON honour_team_members (team_name, player_name_raw)
  WHERE player_id IS NULL;

COMMENT ON INDEX honour_team_linked_player_uq IS
  'One row per stable player identity in an honour team; same-display-name players remain distinct.';

COMMENT ON INDEX honour_team_unlinked_name_uq IS
  'Name-based duplicate protection only for rows that do not yet have a stable player identity.';
