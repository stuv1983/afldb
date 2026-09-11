'use client';

import { useState } from 'react';

import { submitFixtureBatchAction } from '@/app/admin/fixtures/actions';
import { type RoundBatchActionState, useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';
import { MAX_BATCH_ROWS, MAX_HOME_AND_AWAY_ROUND, type FixtureRoundType } from '@/db/queries/admin-fixtures';

const OTHER_VENUE = 'other';

type ClubOption = { id: number; name: string };
type VenueOption = { id: number; canonicalName: string };

type Row = {
  homeClubId: string;
  awayClubId: string;
  matchDate: string;
  matchTime: string;
  venueSelect: string;
  venueRaw: string;
  notes: string;
};

const EMPTY_ROW: Row = { homeClubId: '', awayClubId: '', matchDate: '', matchTime: '', venueSelect: '', venueRaw: '', notes: '' };

type WireRow = {
  homeClubId: number | null;
  awayClubId: number | null;
  matchDate: string | null;
  matchTime: string | null;
  venueId: number | null;
  venueRaw: string | null;
  notes: string | null;
};

/**
 * The row exactly as the server will see it, and as the preview fingerprint
 * covers it. A time is dropped when the row has no date: a time with no date
 * is refused server-side (§10) and the time cell is disabled while the date is
 * blank, so a row whose date was cleared after a time was typed would
 * otherwise carry an invisible value that refuses the WHOLE round. Because
 * preview and confirm both serialise through here, the two always agree.
 */
function toWireRow(row: Row): WireRow {
  const venueId = row.venueSelect && row.venueSelect !== OTHER_VENUE ? Number(row.venueSelect) : null;
  const matchDate = row.matchDate || null;
  return {
    homeClubId: row.homeClubId ? Number(row.homeClubId) : null,
    awayClubId: row.awayClubId ? Number(row.awayClubId) : null,
    matchDate,
    matchTime: matchDate === null ? null : (row.matchTime || null),
    venueId,
    venueRaw: venueId === null && row.venueSelect === OTHER_VENUE ? (row.venueRaw || null) : null,
    notes: row.notes || null,
  };
}

/**
 * Parse a pasted `Home, Away, YYYY-MM-DD, HH:MM, Venue` line into a row,
 * resolving club and venue NAMES to ids by exact case-insensitive match.
 *
 * Client-side only, and deliberately so (§14): the server never receives
 * free text as a fixture, only the ids this resolves — an unresolved cell is
 * left blank rather than guessed, and the operator fills it in from the
 * `<select>`s like any other row.
 */
function parsePasteLine(
  line: string, clubs: ClubOption[], venues: VenueOption[],
): Row | null {
  const cells = line.split(',').map((c) => c.trim());
  if (cells.length < 2 || !cells[0] || !cells[1]) return null;
  const findClub = (name: string) => clubs.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const home = findClub(cells[0]);
  const away = findClub(cells[1]);
  const date = cells[2] ?? '';
  const time = cells[3] ?? '';
  const venueName = cells[4] ?? '';
  const venue = venueName ? venues.find((v) => v.canonicalName.toLowerCase() === venueName.toLowerCase()) : undefined;
  return {
    homeClubId: home ? String(home.id) : '',
    awayClubId: away ? String(away.id) : '',
    matchDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    matchTime: /^\d{2}:\d{2}$/.test(time) ? time : '',
    venueSelect: venue ? String(venue.id) : venueName ? OTHER_VENUE : '',
    venueRaw: venue ? '' : venueName,
    notes: '',
  };
}

/**
 * Round-at-a-time batch entry (AFLDB-ISSUE-162 §14, D-4): header + up to
 * {@link MAX_BATCH_ROWS} rows, previewed server-side and written
 * all-or-nothing. No "every club exactly once" rule — a bye is a club with
 * no fixture in the round and is never a row (§2.3).
 *
 * Preview/Confirm follow the `CopyForwardPanel` lesson exactly
 * (AFLDB-ISSUE-161 §33.5): Confirm is bound to the exact row snapshot the
 * last successful preview described, and ANY change to the rows or the round
 * header after a preview retires it — the operator must preview again before
 * confirming a different submission.
 */
export function RoundBatchForm({
  season, clubs, venues,
}: {
  season: number;
  clubs: ClubOption[];
  venues: VenueOption[];
}) {
  const batch = useFixtureActionSubmit<RoundBatchActionState>(submitFixtureBatchAction, {});
  const [roundType, setRoundType] = useState<FixtureRoundType>('home_and_away');
  const [roundNumber, setRoundNumber] = useState('1');
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [pasteText, setPasteText] = useState('');
  const [previewedSnapshot, setPreviewedSnapshot] = useState<string | null>(null);

  const snapshot = JSON.stringify({
    roundType, roundNumber: roundType === 'home_and_away' ? roundNumber : null,
    rows: rows.map(toWireRow),
  });

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };
      // Returning a date to TBC returns its time to TBC too -- the same rule
      // `toWireRow` enforces on the wire, applied to what the operator can see.
      if (patch.matchDate === '') next.matchTime = '';
      return next;
    }));
  };
  const addRow = () => setRows((current) => (current.length >= MAX_BATCH_ROWS ? current : [...current, { ...EMPTY_ROW }]));
  const removeRow = (index: number) => setRows((current) => current.filter((_, i) => i !== index));

  // Every row needs both clubs chosen before it is even worth sending to the
  // server: an empty `<select>` submits '', and coercing that to a club id
  // server-side would be a guess, not a validation. Caught here instead.
  const rowsComplete = rows.length > 0 && rows.every((row) => row.homeClubId !== '' && row.awayClubId !== '');

  const applyPaste = () => {
    const parsed = pasteText.split('\n').map((line) => line.trim()).filter(Boolean)
      .map((line) => parsePasteLine(line, clubs, venues)).filter((row): row is Row => row !== null);
    if (parsed.length === 0) return;
    setRows(parsed.slice(0, MAX_BATCH_ROWS));
    setPasteText('');
  };

  const buildForm = (dryRun: boolean): FormData => {
    const formData = new FormData();
    formData.set('season', String(season));
    formData.set('roundType', roundType);
    if (roundType === 'home_and_away') formData.set('roundNumber', roundNumber);
    formData.set('dryRun', dryRun ? '1' : '0');
    formData.set('rowsJson', JSON.stringify(rows.map(toWireRow)));
    if (!dryRun && batch.state.fingerprint) formData.set('previewFingerprint', batch.state.fingerprint);
    return formData;
  };

  const handlePreview = (event: React.MouseEvent<HTMLButtonElement>) => {
    setPreviewedSnapshot(snapshot);
    batch.submit(buildForm(true), event.currentTarget);
  };
  const handleConfirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    batch.submit(buildForm(false), event.currentTarget);
  };

  const hasPreview = batch.state.ok === true && batch.state.dryRun === true;
  const previewed = hasPreview && previewedSnapshot === snapshot;
  const previewStale = hasPreview && previewedSnapshot !== snapshot;
  const done = batch.state.ok === true && batch.state.dryRun === false;
  const outcomes = batch.state.rows ?? [];

  if (done) {
    return (
      <section className="section">
        <p className="notice" role="status">{batch.state.message}</p>
      </section>
    );
  }

  return (
    <section className="section">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', maxWidth: '32rem' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
          Round type
          <select value={roundType} onChange={(event) => setRoundType(event.target.value as FixtureRoundType)} disabled={batch.isPending}>
            <option value="home_and_away">Home and away</option>
            <option value="wildcard_final">Wildcard Final</option>
            <option value="elimination_final">Elimination Final</option>
            <option value="qualifying_final">Qualifying Final</option>
            <option value="semi_final">Semi Final</option>
            <option value="preliminary_final">Preliminary Final</option>
            <option value="grand_final">Grand Final</option>
          </select>
        </label>
        {roundType === 'home_and_away' && (
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Round number
            <input type="number" min={1} max={MAX_HOME_AND_AWAY_ROUND} value={roundNumber} onChange={(event) => setRoundNumber(event.target.value)} disabled={batch.isPending} />
          </label>
        )}
      </div>

      <details style={{ margin: '0.8rem 0' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>Paste rows (Home, Away, YYYY-MM-DD, HH:MM, Venue — one per line)</summary>
        <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.4rem', maxWidth: '32rem' }}>
          <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={4} disabled={batch.isPending}
            placeholder={'Richmond, Carlton, 2027-03-19, 19:50, MCG\nCollingwood, Essendon, 2027-03-20,,'} />
          <div>
            <button type="button" className="btn btn-secondary" onClick={applyPaste} disabled={batch.isPending || !pasteText.trim()}>
              Replace rows from paste
            </button>
          </div>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Club and venue names must match exactly; anything unresolved is left blank for you to
            choose from the row below. The server only ever receives ids, never this text.
          </p>
        </div>
      </details>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Home</th>
              <th scope="col">Away</th>
              <th scope="col">Date</th>
              <th scope="col">Time</th>
              <th scope="col">Venue</th>
              <th scope="col">Notes</th>
              {outcomes.length > 0 && <th scope="col">Result</th>}
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const outcome = outcomes.find((o) => o.index === index);
              return (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>
                    <select aria-label={`Home club, fixture ${index + 1}`} value={row.homeClubId} onChange={(event) => updateRow(index, { homeClubId: event.target.value })} disabled={batch.isPending}>
                      <option value="">— select —</option>
                      {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select aria-label={`Away club, fixture ${index + 1}`} value={row.awayClubId} onChange={(event) => updateRow(index, { awayClubId: event.target.value })} disabled={batch.isPending}>
                      <option value="">— select —</option>
                      {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><input type="date" aria-label={`Date, fixture ${index + 1} (blank = TBC)`} value={row.matchDate} onChange={(event) => updateRow(index, { matchDate: event.target.value })} disabled={batch.isPending} /></td>
                  <td><input type="text" placeholder="TBC" aria-label={row.matchDate ? `Local start time, fixture ${index + 1} (blank = TBC)` : `Local start time, fixture ${index + 1} — choose a date first`} value={row.matchTime} onChange={(event) => updateRow(index, { matchTime: event.target.value })} disabled={batch.isPending || !row.matchDate} style={{ width: '4.5rem' }} /></td>
                  <td>
                    <select aria-label={`Venue, fixture ${index + 1}`} value={row.venueSelect} onChange={(event) => updateRow(index, { venueSelect: event.target.value })} disabled={batch.isPending}>
                      <option value="">TBC</option>
                      {venues.map((v) => <option key={v.id} value={v.id}>{v.canonicalName}</option>)}
                      <option value={OTHER_VENUE}>Named, unmapped…</option>
                    </select>
                    {row.venueSelect === OTHER_VENUE && (
                      <input type="text" placeholder="Venue name" aria-label={`Unmapped venue name, fixture ${index + 1}`} value={row.venueRaw} onChange={(event) => updateRow(index, { venueRaw: event.target.value })} disabled={batch.isPending} style={{ marginTop: '0.2rem', width: '100%' }} />
                    )}
                  </td>
                  <td><input type="text" aria-label={`Notes, fixture ${index + 1}`} value={row.notes} onChange={(event) => updateRow(index, { notes: event.target.value })} disabled={batch.isPending} style={{ width: '8rem' }} /></td>
                  {outcomes.length > 0 && (
                    <td style={{ fontSize: '0.8rem' }}>
                      {outcome === undefined ? '—' : outcome.ok
                        ? <span className="badge">Valid</span>
                        : <span className="badge badge-danger">{outcome.error ?? outcome.reason ?? 'Invalid'}</span>}
                    </td>
                  )}
                  <td>
                    <button type="button" className="btn btn-secondary" onClick={() => removeRow(index)} disabled={batch.isPending || rows.length <= 1} aria-label={`Remove fixture ${index + 1}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ margin: '0.6rem 0' }}>
        <button type="button" className="btn btn-secondary" onClick={addRow} disabled={batch.isPending || rows.length >= MAX_BATCH_ROWS}>
          + Add row
        </button>
        <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>{rows.length} / {MAX_BATCH_ROWS} rows</span>
      </div>

      {batch.state.error && <p className="notice" role="alert">{batch.state.error}</p>}

      {previewed ? (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <p role="status">{batch.state.message}</p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={batch.isPending}>
              {batch.isPending ? 'Creating…' : 'Confirm — create these fixtures'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          {previewStale && (
            <p className="notice" role="status">
              The rows changed since that preview, so it no longer describes what would be
              written. Preview again before confirming.
            </p>
          )}
          <div>
            <button type="button" className="btn btn-secondary" onClick={handlePreview} disabled={batch.isPending || !rowsComplete}>
              {batch.isPending ? 'Previewing…' : 'Preview round'}
            </button>
          </div>
          {!rowsComplete && <p className="muted" style={{ fontSize: '0.8rem' }}>Choose both clubs for every row before previewing.</p>}
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            One invalid row means the whole round remains uncommitted. Preview validates every row
            and writes nothing.
          </p>
        </div>
      )}
    </section>
  );
}
