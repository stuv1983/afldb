'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { createMatchAction, type SimpleAdminActionState } from '@/app/admin/data-editor/actions';
import type { ClubSummary } from '@/db/queries/clubs';
import type { VenueSummary } from '@/db/queries/venues';

const INITIAL: SimpleAdminActionState = {};

/**
 * Super Admin: Create a new Match (see changeLog.md).
 * Enables adding live / current season games with grounds, scores, quarter breakdowns,
 * and seamlessly proceeding to the Match Sheet Editor to enter lineups and player stats.
 */
export function CreateMatchForm({
  clubs = [],
  venues = [],
}: {
  clubs?: ClubSummary[];
  venues?: VenueSummary[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [showQuarters, setShowQuarters] = useState(false);

  const [roundType, setRoundType] = useState<string>('home_and_away');
  const [roundNumber, setRoundNumber] = useState<string>('1');

  const [homeGoals, setHomeGoals] = useState<string>('');
  const [homeBehinds, setHomeBehinds] = useState<string>('');
  const [awayGoals, setAwayGoals] = useState<string>('');
  const [awayBehinds, setAwayBehinds] = useState<string>('');

  const [state, formAction, isPending] = useActionState(createMatchAction, INITIAL);

  const calculatedHomeScore = (homeGoals !== '' && homeBehinds !== '')
    ? (Number(homeGoals) * 6 + Number(homeBehinds))
    : '';

  const calculatedAwayScore = (awayGoals !== '' && awayBehinds !== '')
    ? (Number(awayGoals) * 6 + Number(awayBehinds))
    : '';

  useEffect(() => {
    if (state.createdId && !state.warning) {
      router.push(`/admin/data-editor?mode=match-sheet&id=${state.createdId}`);
    }
  }, [state.createdId, state.warning, router]);

  if (!isOpen && !state.createdId) {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(true)}
        style={{ fontSize: '0.9rem' }}
      >
        + Add new match
      </button>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-subtle)',
      borderRadius: '8px',
      padding: '1.25rem',
      margin: '0.75rem 0 1.5rem',
      maxWidth: '52rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Add new match</h3>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setIsOpen(false)}
          style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
        >
          Cancel
        </button>
      </div>

      <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 1rem' }}>
        Record a new match into the database. Upon creating, you can immediately open the Match Sheet Editor to input lineups, player match statistics, and Brownlow votes.
      </p>

      {state.message && (
        <div style={{ padding: '0.6rem 0.8rem', background: 'var(--bg-raised)', borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>
            ✓ {state.message}{' '}
            {state.createdId && (
              <Link href={`/admin/data-editor?mode=match-sheet&id=${state.createdId}`}>
                Open match sheet & lineup editor →
              </Link>
            )}
          </p>
        </div>
      )}

      {state.warning && (
        <div className="badge badge-warn" style={{ marginBottom: '1rem' }}>
          {state.warning}
        </div>
      )}

      {state.error && (
        <div style={{ padding: '0.6rem 0.8rem', background: 'var(--bg-raised)', borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--color-warn)', fontSize: '0.9rem' }}>
            ⚠ {state.error}
          </p>
        </div>
      )}

      <form action={formAction} style={{ display: 'grid', gap: '1rem' }}>
        {/* Row 1: Season, Round Type, Round # */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Season (Year) *
            <input
              type="number"
              name="season"
              required
              min={1897}
              max={2100}
              defaultValue={new Date().getFullYear()}
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Round type *
            <select
              name="roundType"
              value={roundType}
              onChange={(e) => setRoundType(e.target.value)}
              style={{ fontSize: '0.9rem' }}
            >
              <option value="home_and_away">Regular Season (Home & Away)</option>
              <option value="wildcard_final">Wildcard Final</option>
              <option value="qualifying_final">Qualifying Final</option>
              <option value="elimination_final">Elimination Final</option>
              <option value="semi_final">Semi Final</option>
              <option value="preliminary_final">Preliminary Final</option>
              <option value="grand_final">Grand Final</option>
            </select>
          </label>

          {roundType === 'home_and_away' && (
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
              Round number *
              <input
                type="number"
                name="roundNumber"
                required
                min={1}
                max={30}
                value={roundNumber}
                onChange={(e) => setRoundNumber(e.target.value)}
                style={{ fontSize: '0.9rem' }}
              />
            </label>
          )}
        </div>

        {/* Row 2: Date, Time, Venue, Attendance */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Match date (YYYY-MM-DD) *
            <input
              type="date"
              name="matchDate"
              required
              defaultValue={new Date().toISOString().split('T')[0]}
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Start time (optional)
            <input
              type="text"
              name="matchTime"
              placeholder="e.g. 19:40 or 14:10"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Ground / Venue *
            <select name="venueId" defaultValue="" style={{ fontSize: '0.9rem' }}>
              <option value="">— Select venue —</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.canonicalName}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Crowd / Attendance (optional)
            <input
              type="number"
              name="attendance"
              min={0}
              placeholder="e.g. 85400"
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        {/* Teams and Final Scores Box */}
        <div style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '0.75rem 1rem',
          background: 'var(--bg-raised)',
          display: 'grid',
          gap: '0.75rem',
        }}>
          <strong style={{ fontSize: '0.9rem' }}>Clubs & final scores</strong>

          {/* Home Team */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.5rem', alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Home club *
              <select name="homeClubId" required defaultValue="" style={{ fontSize: '0.85rem' }}>
                <option value="">— Select home club —</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Goals
              <input
                type="number"
                name="homeGoals"
                min={0}
                value={homeGoals}
                onChange={(e) => setHomeGoals(e.target.value)}
                placeholder="0"
                style={{ fontSize: '0.85rem' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Behinds
              <input
                type="number"
                name="homeBehinds"
                min={0}
                value={homeBehinds}
                onChange={(e) => setHomeBehinds(e.target.value)}
                placeholder="0"
                style={{ fontSize: '0.85rem' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Total score
              <input
                type="number"
                name="homeScore"
                min={0}
                required
                defaultValue={calculatedHomeScore}
                key={`homeScore-${calculatedHomeScore}`}
                placeholder="0"
                style={{ fontSize: '0.85rem', fontWeight: 600 }}
              />
            </label>
          </div>

          {/* Away Team */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.5rem', alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Away club *
              <select name="awayClubId" required defaultValue="" style={{ fontSize: '0.85rem' }}>
                <option value="">— Select away club —</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Goals
              <input
                type="number"
                name="awayGoals"
                min={0}
                value={awayGoals}
                onChange={(e) => setAwayGoals(e.target.value)}
                placeholder="0"
                style={{ fontSize: '0.85rem' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Behinds
              <input
                type="number"
                name="awayBehinds"
                min={0}
                value={awayBehinds}
                onChange={(e) => setAwayBehinds(e.target.value)}
                placeholder="0"
                style={{ fontSize: '0.85rem' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Total score
              <input
                type="number"
                name="awayScore"
                min={0}
                required
                defaultValue={calculatedAwayScore}
                key={`awayScore-${calculatedAwayScore}`}
                placeholder="0"
                style={{ fontSize: '0.85rem', fontWeight: 600 }}
              />
            </label>
          </div>
        </div>

        {/* Quarter-by-Quarter Breakdown Section (Collapsible) */}
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowQuarters((prev) => !prev)}
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
          >
            {showQuarters ? 'Hide quarter scores breakdown' : '+ Add quarter-by-quarter scores'}
          </button>

          {showQuarters && (
            <div style={{
              marginTop: '0.5rem',
              border: '1px dashed var(--border-subtle)',
              borderRadius: '6px',
              padding: '0.75rem',
              display: 'grid',
              gap: '0.75rem',
            }}>
              <strong style={{ fontSize: '0.85rem' }}>Quarter-by-quarter cumulative scores</strong>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>Home Club Quarters (Q1–Q4):</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                  {[1, 2, 3, 4].map((p) => (
                    <div key={`hq-${p}`} style={{ display: 'grid', gap: '0.2rem', fontSize: '0.75rem' }}>
                      <strong>Q{p}</strong>
                      <input type="number" name={`homeQ${p}Goals`} placeholder="G" min={0} style={{ fontSize: '0.8rem' }} />
                      <input type="number" name={`homeQ${p}Behinds`} placeholder="B" min={0} style={{ fontSize: '0.8rem' }} />
                      <input type="number" name={`homeQ${p}Points`} placeholder="Total" min={0} style={{ fontSize: '0.8rem' }} />
                    </div>
                  ))}
                </div>

                <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>Away Club Quarters (Q1–Q4):</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                  {[1, 2, 3, 4].map((p) => (
                    <div key={`aq-${p}`} style={{ display: 'grid', gap: '0.2rem', fontSize: '0.75rem' }}>
                      <strong>Q{p}</strong>
                      <input type="number" name={`awayQ${p}Goals`} placeholder="G" min={0} style={{ fontSize: '0.8rem' }} />
                      <input type="number" name={`awayQ${p}Behinds`} placeholder="B" min={0} style={{ fontSize: '0.8rem' }} />
                      <input type="number" name={`awayQ${p}Points`} placeholder="Total" min={0} style={{ fontSize: '0.8rem' }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Row 4: Notes */}
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Match notes / event description (optional)
          <textarea
            name="notes"
            maxLength={1000}
            rows={2}
            placeholder="e.g. Opening round marquee clash at the MCG."
            style={{ fontSize: '0.9rem', resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="submit" disabled={isPending}>
            {isPending ? 'Creating match…' : 'Create match & open match sheet editor →'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsOpen(false)}
          >
            Close
          </button>
        </div>
      </form>
    </div>
  );
}
