/**
 * Route-level pending UI for the whole admin area.
 *
 * Until 2026-08-19 the app had no loading boundary anywhere, so clicking
 * an admin nav link gave zero feedback until the destination's full RSC
 * payload had arrived AND rendered — measured at 55 ms–27 s depending on
 * the destination, and reported by the admin as "I clicked it and
 * nothing happened". This boundary makes every admin navigation respond
 * instantly; it is feedback for legitimate latency, not a mask for the
 * player-links render problem, which was fixed separately (see
 * player-links/ResolvePanel.tsx).
 */
export default function AdminLoading() {
  return (
    <div className="page-header" aria-busy="true">
      <h1 className="muted">Loading…</h1>
    </div>
  );
}
