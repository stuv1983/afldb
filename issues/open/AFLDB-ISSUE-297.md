# AFLDB-ISSUE-297 — AFL API provider id is used unvalidated as a file path and URL path segment

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition / AFL API client and acquisition tool.
- **Key files:** `src/lib/acquisition/afl-api-client.ts` (`parseAflApiSeasonMatchesEnvelope`, `plan*Request`), `tools/current-season/acquire-afl-api.ts`, `src/lib/acquisition/afl-api-snapshot.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-032; partition note R4b-F01). The main session re-read the parser and the acquisition loop.
- **Classification:** code-proven.

## 1. Summary

The season feed parser accepts any non-empty string as `providerId`. The acquisition tool then joins it into a relative path and creates directories, writing `fixture.json`, `player-stats.json` and `match-roster.json` under it. The client interpolates it into `/afl/playerStats/match/${id}`, a request that carries the `x-media-mis-token` header. An id such as `../../escape` writes outside the claimed snapshot directory and requests an unintended path. The snapshot reader later follows the manifest's traversal.

## 2. Evidence

- `src/lib/acquisition/afl-api-client.ts:369-380` (`typeof providerId !== 'string' || length === 0` is the only check) and `:154, :162` (URL paths).
- `tools/current-season/acquire-afl-api.ts:309-312, :330, :337` (`join(match.providerId, …)`, `mkdirSync(dirname(path), {recursive: true})`) and `:389-395` (the cleanup removes the claimed directory only).
- `src/lib/acquisition/afl-api-snapshot.ts:74` (`join(snapshotDir, entry.file)`).
- The measured shape is `CD_M<digits>` (`tools/current-season/emit-afl-api-bundle.ts:65`).

## 3. Trigger

An upstream feed (or an operator-overridden base URL) that returns an entry `{providerId: "../../escape", status: "CONCLUDED"}`.

## 4. Expected invariant

Every field of the feed is untrusted. An id that is not `^CD_M\d+$` is refused at parse time.

## 5. Actual behaviour

Files are written outside the evidence tree and token-bearing requests go to arbitrary paths on the CFS host. Under systemd the write is bounded by `ReadWritePaths=/home/arm/projects/afldb/data/sources/afl_api` (`deploy/afldb-settle-afl-api.service:75`).

## 6. First wrong layer

`src/lib/acquisition/afl-api-client.ts:371-374`.

## 7. Impact

Low: the attacker would have to be the upstream provider over TLS, or the base URL would have to be misconfigured. It is a gap in otherwise strict feed validation.

## 8. Reproduction / witness

Not executed. The DB-free check is in §14.

## 9. Disproof attempts

No `CD_M` shape check exists in the client, the acquisition tool or the snapshot reader.

## 10. Existing-issue search

"path traversal" and "providerId directory": none. Classification: **new**.

## 11. Scope

Provider-id shape validation.

## 12. Out of scope

Other feed fields, which are already gated.

## 13. Proposed fix boundary

A regex guard in `parseAflApiSeasonMatchesEnvelope`, and the same guard in the `plan*Request` helpers.

## 14. Proposed validation

DB-free:
- `parseAflApiSeasonMatchesEnvelope('{"matches":[{"providerId":"../escape","status":"CONCLUDED"}]}')` throws.
- `runAcquisition` with the existing `stubFetch` harness refuses before writing.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
