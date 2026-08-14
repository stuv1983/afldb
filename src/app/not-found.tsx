import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="empty">
      <h2>Page not found</h2>
      <p>
        That player, club, season or match isn’t in AFLDB — the address may be
        mistyped or out of date.
      </p>
      <p style={{ marginTop: '1rem' }}>
        <Link className="btn" href="/">Search AFL history</Link>
      </p>
    </div>
  );
}
