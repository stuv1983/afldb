<!-- DOC | Curated API annotations for the typed search Grid Solver and NL module -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# Registry: search

What belongs here: deprecations; "use X instead" redirects; contracts beyond what a type
signature can state (null-versus-throw, ordering guarantees, idempotency, NULL-versus-zero
semantics); anti-patterns specific to this module; and "do not extend Y, extend Z"
architectural directives.

What does NOT belong here: the API surface itself. Query that live instead --
`node .phaneslight/scripts/cli.js list-apis search`, or `semble search` where it is installed.

Empty is the correct state on day one. This file grows only when afldb-orchestrator has a
real, confirmed annotation to add; pre-filling it with guesses would poison the single
strongest anti-hallucination signal in the system. Target ceiling 30 entries -- past that,
the architecture has drifted and warrants a snapshot review.
