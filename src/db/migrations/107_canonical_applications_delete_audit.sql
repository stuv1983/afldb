-- ---------------------------------------------------------------------
-- 107 — AFLDB-ISSUE-238 Slice 3 M2: `delete` verb for canonical_applications
-- (successor to 083)
-- ---------------------------------------------------------------------
-- ISSUE-238 D1/D5 (runbook §7, §10 M2, approved for planning): a proven
-- foreign-collision row (disposition C2/C4, §5.4) is physically deleted, not
-- merged or moved. The row cannot stay at the old key (it is wrongly
-- attributed) and UNIQUE (player_id, match_id) forbids a second row at the
-- new key, so this is the one case in ISSUE-238's design where a canonical
-- row disappears rather than moves. D5 explicitly rejects a new "reattribute"
-- verb: MOVE keeps using the existing `update` (previous_values/new_values
-- record it completely); only physical deletion needs a new verb.
--
-- The DELETE contract (§10 M2):
--   verb = 'delete'
--   previous_values  = the full deleted row (already required NOT NULL by
--                       the existing canonical_applications_previous_ck,
--                       which ties (previous_values IS NULL) to
--                       (verb = 'insert') -- 'delete' is not 'insert', so
--                       that CHECK already forces previous_values NOT NULL
--                       here, unchanged)
--   new_values       = '{}'::jsonb
--   target_key       = the old (deleted) natural key
--
-- Both writers (ORIGINAL, operator-run, and REPLAY, lifecycle) bind their
-- delete application to the `corrected` adjudication through a bound batch
-- (§5.6, §8.7); that binding is entirely a code/import_batches concern and
-- needs no new column or FK here (§10: "No migration for ... import_batches").
--
-- 64-key fit (established by inspection, §10 M2): a full player_match_stats
-- row is 31 columns (004:15-61 + 083:50) and a full brownlow_round_votes row
-- is 11 (005:48-57 + 083:46 + 094:89-90). Both fit within the existing
-- canonical_applications_new_values_ck / _previous_values_ck <= 64 top-level
-- key limit, which is retained unchanged: an empty new_values object still
-- has zero top-level keys and already satisfies that CHECK, so no widening
-- is needed there, and this migration is deliberately narrow -- it does not
-- touch canonical_applications_target_table_ck ('player_match_stats' and
-- 'brownlow_round_votes' are already members, 083) or either existing
-- INSERT/UPDATE constraint.
--
-- Grants are UNCHANGED. A `delete` row is still written by an INSERT into
-- canonical_applications (this table is append-only; `delete` describes the
-- mutation of the TARGET table, never a DELETE FROM this table), so the
-- existing SELECT, INSERT + sequence USAGE to afldb_import and SELECT-only
-- to afldb_auth (083, mirrored in tools/maintenance/privileges.sql:301-311)
-- already cover it. This migration does not grant afldb_import DELETE on
-- player_match_stats or brownlow_round_votes: that is the correction CLI's
-- concern (a later, separately authorised slice), and a schema-only pass
-- must not widen runtime mutation rights merely because a new verb value
-- now exists.
-- ---------------------------------------------------------------------

-- 1. Verb vocabulary gains `delete`.
ALTER TABLE canonical_applications
  DROP CONSTRAINT canonical_applications_verb_ck;
ALTER TABLE canonical_applications
  ADD CONSTRAINT canonical_applications_verb_ck
  CHECK (verb IN ('insert', 'update', 'delete'));

-- 2. A delete row proposes nothing forward: new_values is exactly the empty
--    object, never merely a small one. previous_values holding the complete
--    deleted row is already enforced, unchanged, by
--    canonical_applications_previous_ck ((previous_values IS NULL) =
--    (verb = 'insert')).
ALTER TABLE canonical_applications
  ADD CONSTRAINT canonical_applications_delete_new_values_ck
  CHECK (verb <> 'delete' OR new_values = '{}'::jsonb);

COMMENT ON TABLE canonical_applications IS
  'Append-only ledger of every canonical row the automatic AFL Tables settle path inserted, '
  'updated (AFLDB-ISSUE-122, migration 083) or the AFLDB-ISSUE-238 identity correction moved or '
  'physically deleted (migration 107). One row per mutation, written inside the same savepoint '
  '(settle) or transaction (correction) as the mutation, bound to the exact staging '
  'source-record version or corrected adjudication that justified it. Machine and correction '
  'decisions only: human review decisions live in promotion_decisions.';
COMMENT ON COLUMN canonical_applications.new_values IS
  'The proposed field set as written, serialised through canonicalJson() so key order is '
  'deterministic. At most 64 keys; never the source payload (staging.source_payloads has it). '
  'Exactly {} when verb = ''delete'' (AFLDB-ISSUE-238 M2): a delete proposes nothing forward.';
