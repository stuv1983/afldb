'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PlayerPicker } from '@/components/PlayerPicker';
import {
  buildersByGroup,
  GRID_AA_POSITIONS,
  GRID_BUILDERS,
  GRID_DRAFT_TYPES,
  GRID_GROUP_ORDER,
  GRID_MATCH_EVENTS,
  GRID_ORDER_LABELS,
  GRID_SIGNING_KINDS,
  GRID_STAT_KEYS,
  GRID_STATS,
  serializeBoardState,
  type GridAxisState,
  type GridBoardState,
  type GridOrder,
  type GridParamDef,
} from '@/search/grid-solver-spec';

type Option = { id: number; name: string };
type AwardOption = { id: number; name: string; category: string };

/**
 * Six axis editors (three rows, three columns) plus a rank-by control --
 * the grid solver's counterpart to QueryBuilderForm.tsx. Same shape: all
 * state lives here as plain React state until "Solve" pushes it into the
 * URL as one `g` token, so a shared link reproduces exactly the board
 * that was built. No <form> element, same as QueryBuilderForm: every
 * control is state + onClick, not native submission.
 */
export function GridSolverForm({
  initialState,
  clubs,
  venues,
  awards,
  playerNames,
}: {
  initialState: GridBoardState;
  clubs: Option[];
  venues: Option[];
  awards: AwardOption[];
  /** id -> display name, for axes already carrying a Teammates-category player id. */
  playerNames: Record<string, string>;
}) {
  const router = useRouter();
  const [state, setState] = useState<GridBoardState>(initialState);

  function setAxis(side: 'rows' | 'cols', index: number, next: GridAxisState) {
    setState((prev) => {
      const axes = [...prev[side]] as typeof prev.rows;
      axes[index] = next;
      return { ...prev, [side]: axes };
    });
  }

  function solve() {
    router.push(`/grid-solver?g=${serializeBoardState(state)}`);
  }

  function reset() {
    router.push('/grid-solver');
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <AxisGroup
        title="Columns" side="cols" axes={state.cols}
        clubs={clubs} venues={venues} awards={awards} playerNames={playerNames}
        onChange={(i, next) => setAxis('cols', i, next)}
      />
      <AxisGroup
        title="Rows" side="rows" axes={state.rows}
        clubs={clubs} venues={venues} awards={awards} playerNames={playerNames}
        onChange={(i, next) => setAxis('rows', i, next)}
      />

      <label style={{ maxWidth: '16rem' }}>
        Rank answers by
        <select
          value={state.order}
          onChange={(e) => setState((prev) => ({ ...prev, order: e.target.value as GridOrder }))}
        >
          {(Object.keys(GRID_ORDER_LABELS) as GridOrder[]).map((o) => (
            <option key={o} value={o}>{GRID_ORDER_LABELS[o]}</option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn" type="button" onClick={solve}>Solve</button>
        <button className="btn btn-secondary" type="button" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}

function AxisGroup({
  title, side, axes, clubs, venues, awards, playerNames, onChange,
}: {
  title: string;
  side: 'rows' | 'cols';
  axes: GridBoardState['rows'];
  clubs: Option[];
  venues: Option[];
  awards: AwardOption[];
  playerNames: Record<string, string>;
  onChange: (index: number, next: GridAxisState) => void;
}) {
  const singular = side === 'rows' ? 'Row' : 'Column';
  return (
    <div>
      <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.9rem' }}>{title}</h3>
      <div className="grid grid-panels">
        {axes.map((axis, i) => (
          <AxisEditor
            key={i}
            axisLabel={`${singular} ${i + 1}`}
            axis={axis}
            onChange={(next) => onChange(i, next)}
            clubs={clubs}
            venues={venues}
            awards={awards}
            playerNames={playerNames}
          />
        ))}
      </div>
    </div>
  );
}

function AxisEditor({
  axisLabel, axis, onChange, clubs, venues, awards, playerNames,
}: {
  axisLabel: string;
  axis: GridAxisState;
  onChange: (next: GridAxisState) => void;
  clubs: Option[];
  venues: Option[];
  awards: AwardOption[];
  playerNames: Record<string, string>;
}) {
  const def = GRID_BUILDERS[axis.builder];
  const category = def?.group ?? GRID_GROUP_ORDER[0];
  const groups = buildersByGroup();
  const buildersInCategory = groups.find((g) => g.group === category)?.builders ?? [];

  function changeCategory(nextCategory: string) {
    const first = groups.find((g) => g.group === nextCategory)?.builders[0];
    if (first) onChange({ builder: first.key, params: {} });
  }

  function changeBuilder(key: string) {
    onChange({ builder: key, params: {} });
  }

  function setParam(key: string, value: string) {
    onChange({ ...axis, params: { ...axis.params, [key]: value } });
  }

  return (
    <fieldset style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '0.6rem 0.85rem 0.75rem',
    }}>
      <legend style={{ fontWeight: 650, fontSize: '0.85rem', padding: '0 0.3rem' }}>{axisLabel}</legend>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          Category
          <select value={category} onChange={(e) => changeCategory(e.target.value)}>
            {GRID_GROUP_ORDER.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>
          Question
          <select value={axis.builder} onChange={(e) => changeBuilder(e.target.value)}>
            {buildersInCategory.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
        {def?.params.map((p) => (
          <ParamInput
            key={p.key}
            axisKey={`${axisLabel}-${axis.builder}-${p.key}`}
            param={p}
            value={axis.params[p.key] ?? ''}
            onChange={(v) => setParam(p.key, v)}
            clubs={clubs}
            venues={venues}
            awards={awards}
            playerNames={playerNames}
          />
        ))}
      </div>
    </fieldset>
  );
}

function ParamInput({
  axisKey, param, value, onChange, clubs, venues, awards, playerNames,
}: {
  axisKey: string;
  param: GridParamDef;
  value: string;
  onChange: (value: string) => void;
  clubs: Option[];
  venues: Option[];
  awards: AwardOption[];
  playerNames: Record<string, string>;
}) {
  if (param.kind === 'club' || param.kind === 'venue') {
    const options = param.kind === 'club' ? clubs : venues;
    return (
      <label>
        {param.label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
    );
  }

  if (param.kind === 'stat') {
    return (
      <label>
        {param.label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {GRID_STAT_KEYS.map((key) => <option key={key} value={key}>{GRID_STATS[key].label}</option>)}
        </select>
      </label>
    );
  }

  if (param.kind === 'award') {
    const categories = [...new Set(awards.map((a) => a.category))];
    return (
      <label>
        {param.label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat.replace(/_/g, ' ')}>
              {awards.filter((a) => a.category === cat).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    );
  }

  if (param.kind === 'draftType' || param.kind === 'signingKind' || param.kind === 'matchEvent') {
    const options = param.kind === 'draftType' ? GRID_DRAFT_TYPES
      : param.kind === 'signingKind' ? GRID_SIGNING_KINDS
        : GRID_MATCH_EVENTS;
    return (
      <label>
        {param.label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  if (param.kind === 'aaPosition') {
    return (
      <label>
        {param.label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {GRID_AA_POSITIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }

  if (param.kind === 'player') {
    const id = Number(value);
    const name = Number.isSafeInteger(id) ? playerNames[id] : undefined;
    return (
      <div>
        {/* key forces a remount (and so a fresh initialSelected) whenever the
            chosen builder changes -- PlayerPicker owns its own "selected"
            state internally, so it would otherwise show a stale name after
            switching from one player-parameter builder to another. */}
        <PlayerPicker
          key={axisKey}
          label={param.label}
          initialSelected={name ? { id, label: name } : null}
          onSelect={(selected) => onChange(selected ? String(selected.id) : '')}
        />
      </div>
    );
  }

  if (param.kind === 'text') {
    return (
      <label>
        {param.label}
        <input
          type="text"
          value={value}
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '14rem' }}
        />
      </label>
    );
  }

  // integer / decimal / season
  return (
    <label>
      {param.label}
      <input
        type="number"
        step={param.kind === 'decimal' ? '0.1' : '1'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '7rem' }}
      />
    </label>
  );
}
