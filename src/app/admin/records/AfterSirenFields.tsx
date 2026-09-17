'use client';

import {
  AFTER_SIREN_EFFECTS, AFTER_SIREN_RESULTS, AFTER_SIREN_SCORES, AFTER_SIREN_SIRENS,
} from '@/lib/special-records/after-siren-rules';

/**
 * The field set an after-the-siren record is CREATED from — used by
 * `/admin/records/after-the-siren/new` and, under a prefix, by the replace
 * panel (AFLDB-ISSUE-167 §10.2).
 *
 * THE FIVE COUPLED FIELDS ARE PRESENTED TOGETHER, in one group, because they
 * are checked together: migration 089's `_effect_ck` binds `kick_scored`,
 * `kick_effect`, `kicker_result` and the margin between the two point totals,
 * and `_regulation_ck` binds `siren` to `kick_effect`. Presenting them apart
 * would invite a combination the database refuses. The action validates the
 * whole group before it issues any SQL, so the refusal is a sentence about
 * football (`src/lib/special-records/after-siren-rules.ts`).
 *
 * `cited` is NOT a lifecycle control and never shares one (migration 089, gate
 * G-3): it says the source carried no reference for a kick that really
 * happened. It is a checkbox beside the score, like `supergoal_scoring`.
 */
const SCORE_LABELS: Record<string, string> = {
  goal: 'a goal', behind: 'a behind', none: 'nothing',
};
const EFFECT_LABELS: Record<string, string> = {
  won: 'won the match', drew: 'drew the match', none: 'changed nothing',
};
const RESULT_LABELS: Record<string, string> = {
  win: 'a win', loss: 'a loss', draw: 'a draw',
};
const SIREN_LABELS: Record<string, string> = {
  final: 'the final siren',
  end_of_extra_time: 'the end-of-extra-time siren',
  end_of_regulation: 'the end-of-regulation siren',
};

export function AfterSirenFields({ prefix = '' }: { prefix?: string }) {
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
          Kicker&apos;s club as the source records it *
          <input type="text" name={name('clubNameRaw')} maxLength={200} required />
        </label>
        <label style={label}>
          Opponent as the source records it *
          <input type="text" name={name('opponentNameRaw')} maxLength={200} required />
        </label>
        <label style={label}>
          Competition *
          <input type="text" name={name('competition')} maxLength={200} required defaultValue="VFL/AFL" />
        </label>
      </div>

      <div style={row}>
        <label style={label}>
          Season *
          <input type="number" name={name('season')} min={1897} max={2100} step={1} required />
        </label>
        <label style={label}>
          Round *
          <input type="text" name={name('roundRaw')} maxLength={50} required />
        </label>
        <label style={label}>
          Match record id (premiership-season rows only)
          <input type="number" name={name('matchId')} min={1} step={1} inputMode="numeric" />
        </label>
      </div>

      <label style={{ ...label, alignContent: 'end' }}>
        <span>
          <input type="checkbox" name={name('premiershipSeason')} defaultChecked />{' '}
          Premiership-season match (only these can carry a match link)
        </span>
      </label>

      <fieldset style={{ display: 'grid', gap: '0.75rem', border: '1px solid var(--border, #ccc)', padding: '0.75rem' }}>
        <legend style={{ fontSize: '0.85rem' }}>The event — these five agree or the record is refused</legend>
        <div style={row}>
          <label style={label}>
            The kick registered *
            <select name={name('kickScored')} defaultValue="goal" required>
              {AFTER_SIREN_SCORES.map((v) => <option key={v} value={v}>{SCORE_LABELS[v]}</option>)}
            </select>
          </label>
          <label style={label}>
            and it *
            <select name={name('kickEffect')} defaultValue="won" required>
              {AFTER_SIREN_EFFECTS.map((v) => <option key={v} value={v}>{EFFECT_LABELS[v]}</option>)}
            </select>
          </label>
          <label style={label}>
            Match result from the kicker&apos;s side *
            <select name={name('kickerResult')} defaultValue="win" required>
              {AFTER_SIREN_RESULTS.map((v) => <option key={v} value={v}>{RESULT_LABELS[v]}</option>)}
            </select>
          </label>
          <label style={label}>
            It followed *
            <select name={name('siren')} defaultValue="final" required>
              {AFTER_SIREN_SIRENS.map((v) => <option key={v} value={v}>{SIREN_LABELS[v]}</option>)}
            </select>
          </label>
        </div>
        <div style={row}>
          <label style={label}>
            Kicker&apos;s final score, as written *
            <input type="text" name={name('kickerScoreRaw')} maxLength={50} required placeholder="12.10 (82)" />
          </label>
          <label style={label}>
            Kicker&apos;s final points *
            <input type="number" name={name('kickerPoints')} min={0} max={1000} step={1} required />
          </label>
          <label style={label}>
            Opponent&apos;s final score, as written *
            <input type="text" name={name('opponentScoreRaw')} maxLength={50} required placeholder="12.4 (76)" />
          </label>
          <label style={label}>
            Opponent&apos;s final points *
            <input type="number" name={name('opponentPoints')} min={0} max={1000} step={1} required />
          </label>
        </div>
        <label style={label}>
          Shot detail, for a miss (&quot;fell short&quot;, &quot;out on the full&quot;)
          <input type="text" name={name('shotDetail')} maxLength={200} />
        </label>
      </fieldset>

      <div style={row}>
        <label style={{ ...label, alignContent: 'end' }}>
          <span>
            <input type="checkbox" name={name('supergoalScoring')} />{' '}
            Supergoal scoring applied
          </span>
        </label>
        <label style={{ ...label, alignContent: 'end' }}>
          <span>
            <input type="checkbox" name={name('cited')} defaultChecked />{' '}
            The source carried a reference (evidence, not lifecycle)
          </span>
        </label>
      </div>

      <label style={label}>
        Source annotation
        <input type="text" name={name('sourceAnnotation')} maxLength={500} />
      </label>
      <label style={label}>
        Notes
        <input type="text" name={name('notes')} maxLength={2000} />
      </label>
    </div>
  );
}
