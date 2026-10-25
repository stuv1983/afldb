# Pre-window helper review and bounded repair

The first independent read-only review returned **STOP** for **MED F-P001**:
`check-source.cjs` checked administrative HEAD but parsed the working-tree approval
and external-input inventory without proving their bytes equalled the accepted
documentation commit. A local working-tree change could therefore alter the
helper's allowed input paths/hashes. Current inventories, the isolated P tree,
all 2,687 raw source blobs and the accepted package were correct; this was a defect
in the newly prepared helper's future refusal logic, not a change to P or the
accepted structural design. No freshness sequence had begun.

The new helper now checks both JSON documents against their exact committed blobs
at `ffb062675ee25650cfc1b4fa6bfe98336a23cc4f` before parsing, refuses symlink/type
substitution of those documents and requires exactly 264 unique external paths.
Accepted proposal/authority/input files were not edited. Six added local checks
cover exact authority bytes, in-memory authority substitution, in-memory input-hash
substitution, the real unique inventory, duplicates and a short inventory. The
final local record contains **17 PASS / 0 FAIL**. Tests mutated in-memory copies
only, not accepted files, and produced no production observations.

The independent re-review returned GO and closed F-P001; the owner accepted the
17 checks and that GO. The native/host, census, canonical/nightly and enforced
dry-run phases remain **NOT RUN**, pending the approved window. Production **NO-GO**.

## Separate helper freeze H (owner authority)

The owner authorised one local commit restricted to this preparation directory and
the four named tracking files. P and the accepted documentation anchor remain
unchanged. To implement the explicit P/A/H model, the opening helper now requires
an explicit full H, checks its complete helper-file membership and raw bytes, and
allows administrative descendants of the accepted anchor while recording actual
A separately. Authority/inventory bytes remain tied to the accepted anchor.
Four added checks cover exact helper bytes, single-byte drift, abbreviated H and
substitution of the documentation anchor for a helper commit. The original 17
checks are retained. A fresh bounded read-only review precedes the H commit;
the actual committed H bytes are verified read-only again after committing.
