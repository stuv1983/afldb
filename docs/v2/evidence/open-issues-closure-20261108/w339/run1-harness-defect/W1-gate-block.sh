  ledger="$(mktemp)"
  if ! afldb_pf_env_has "$AFLDB_PF_DSN_NAME"; then
    afldb_pf_record FAIL 'database identity' "$AFLDB_PF_DSN_NAME is not set in .env"
  elif ! db_identity="$(afldb_pf_psql 'SELECT current_database(), current_user')"; then
    afldb_pf_record FAIL 'database identity' "read-only connection via $AFLDB_PF_DSN_NAME failed (details withheld)"
  elif [[ "${db_identity%% *}" != "$AFLDB_PF_EXPECTED_DATABASE" ]]; then
    afldb_pf_record FAIL 'database identity' "connected to '${db_identity%% *}', expected '$AFLDB_PF_EXPECTED_DATABASE'"
  elif ! afldb_pf_read_ledger "$ledger"; then
    afldb_pf_record FAIL 'migration ledger readable' "afldb_meta.schema_migrations via $AFLDB_PF_DSN_NAME"
  else
    afldb_pf_record PASS 'database identity' "$db_identity via $AFLDB_PF_DSN_NAME (read-only session)"
    AFLDB_PF_LEDGER_SHA="$(afldb_pf_hash < "$ledger")"
    if [[ -z "$AFLDB_PF_TARGET_REV" ]]; then
      afldb_pf_record FAIL 'migration transition' 'no target revision to compare against'
    else
      afldb_pf_compare_ledger "$AFLDB_PF_TARGET_REV" "$ledger"
      if (( ${#AFLDB_PF_LEDGER_PROBLEMS[@]} )); then
        afldb_pf_record FAIL 'applied migrations match the target revision' "$(IFS=';'; echo "${AFLDB_PF_LEDGER_PROBLEMS[*]}")"
      else
        afldb_pf_record PASS 'applied migrations match the target revision' "$AFLDB_PF_APPLIED_N applied, names and checksums equal (ledger sha $AFLDB_PF_LEDGER_SHA)"
      fi
      if [[ -n "${AFLDB_PF_LEDGER_BEFORE:-}" && "$AFLDB_PF_APPLIED_N" != "$AFLDB_PF_LEDGER_BEFORE" ]]; then
        afldb_pf_record FAIL 'approved migration transition' "ledger has $AFLDB_PF_APPLIED_N, approval expects $AFLDB_PF_LEDGER_BEFORE before"
      elif [[ -n "${AFLDB_PF_LEDGER_AFTER:-}" && "$AFLDB_PF_TARGET_M" != "$AFLDB_PF_LEDGER_AFTER" ]]; then
        afldb_pf_record FAIL 'approved migration transition' "target has $AFLDB_PF_TARGET_M, approval expects $AFLDB_PF_LEDGER_AFTER after"
      elif [[ -n "$AFLDB_PF_PENDING" && -z "${AFLDB_PF_LEDGER_AFTER:-}" ]]; then
        afldb_pf_record FAIL 'approved migration transition' "unapproved pending: ${AFLDB_PF_PENDING% } (approve with -ExpectedLedgerBefore $AFLDB_PF_APPLIED_N -ExpectedLedgerAfter $AFLDB_PF_TARGET_M)"
      elif [[ -n "$AFLDB_PF_PENDING" && "${AFLDB_PF_SKIP_MIGRATE:-0}" == 1 ]]; then
        afldb_pf_record FAIL 'approved migration transition' "-SkipMigrate with pending ${AFLDB_PF_PENDING% }"
      else
        afldb_pf_record PASS 'approved migration transition' "$AFLDB_PF_APPLIED_N -> $AFLDB_PF_TARGET_M${AFLDB_PF_PENDING:+ (pending ${AFLDB_PF_PENDING% })}"
      fi
    fi
fi
