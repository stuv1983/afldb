'use client';

/**
 * The field set a first-kick-goal record is CREATED from — used by
 * `/admin/records/first-kick-goal/new` and, under a prefix, by the replace
 * panel (AFLDB-ISSUE-167 §10.2).
 *
 * WHAT IS NOT HERE, AND WHY. There is no club picker and no
 * `link_status_value`, `candidate_count` or `match`-by-name field. A manual row
 * is durable only as far as the Stage 4 replay can rebuild it, and the replay's
 * `record` INSERT sets the player, the match and the lifecycle and no club
 * column at all — so the club travels as the source spelling every public read
 * already falls back to, and the player and the match travel as natural
 * identities resolved from the ids typed here. Typing an id is deliberate:
 * Phase E §12 requires a player and a match to be selected by stable database
 * id, never by display name.
 */
export function FirstKickFields({ prefix = '' }: { prefix?: string }) {
  const name = (field: string) => `${prefix}${field}`;
  const label = { display: 'grid', gap: '0.25rem', fontSize: '0.85rem' } as const;
  const row = { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' } as const;

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={row}>
        <label style={label}>
          Player record id (optional — links the record)
          <input type="number" name={name('playerId')} min={1} step={1} inputMode="numeric" />
        </label>
        <label style={label}>
          Player as the source records it
          <input type="text" name={name('playerNameRaw')} maxLength={200} />
        </label>
        <label style={label}>
          Cleaned player name (defaults to the above)
          <input type="text" name={name('playerNameClean')} maxLength={200} />
        </label>
      </div>

      <div style={row}>
        <label style={label}>
          Club as the source records it *
          <input type="text" name={name('clubNameRaw')} maxLength={200} required />
        </label>
        <label style={label}>
          Season *
          <input type="number" name={name('season')} min={1897} max={2100} step={1} required />
        </label>
        <label style={label}>
          Round *
          <input type="text" name={name('roundRaw')} maxLength={50} required />
        </label>
      </div>

      <div style={row}>
        <label style={label}>
          Match record id (optional — links the record)
          <input type="number" name={name('matchId')} min={1} step={1} inputMode="numeric" />
        </label>
        <label style={label}>
          Consecutive goal kicks
          <input type="number" name={name('consecutiveGoalKicks')} min={1} step={1} defaultValue={1} />
        </label>
        <label style={label}>
          Kickless matches before the first kick
          <input
            type="number" name={name('kicklessMatchesBeforeFirstKick')} min={0} step={1}
            defaultValue={0}
          />
        </label>
      </div>

      <div style={row}>
        <label style={{ ...label, alignContent: 'end' }}>
          <span>
            <input type="checkbox" name={name('noFurtherCareerGoals')} />{' '}
            No further career goals
          </span>
        </label>
        <label style={{ ...label, alignContent: 'end' }}>
          <span>
            <input type="checkbox" name={name('noFurtherCareerKicks')} />{' '}
            No further career kicks
          </span>
        </label>
        <label style={label}>
          Season footnote as the source records it
          <input type="text" name={name('seasonFootnoteRaw')} maxLength={200} />
        </label>
      </div>

      <label style={label}>
        Source annotation (the marker the source itself carried)
        <input type="text" name={name('sourceAnnotation')} maxLength={500} />
      </label>
      <label style={label}>
        Notes
        <input type="text" name={name('notes')} maxLength={2000} />
      </label>
    </div>
  );
}
