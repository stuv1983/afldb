'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { MIN_QUERY_LENGTH } from '@/search/constants';

type PlayerSuggestion = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
};

/**
 * A "fill a slot" player picker, for /players/compare and the grid
 * solver's Teammates category -- unlike SearchBox, which navigates on
 * selection, this holds the chosen player as local state and submits it
 * as a hidden field, so a parent <form method="get"> carries it through
 * as a plain query param.
 *
 * searchPlayers()'s subtitle ("<clubs> · <span> · <games> games") already
 * disambiguates same-named players, so this needs no separate
 * disambiguation UI of its own.
 *
 * There is no meaningful no-JS fallback here: choosing a specific player
 * id from a name genuinely requires the autocomplete round trip when two
 * people share a name, unlike SearchBox's free-text search, which is
 * still a valid query without JS.
 */
export function PlayerPicker({
  name,
  label,
  initialSelected = null,
  onSelect,
}: {
  /** The hidden field's name, e.g. "a" or "b". Omit when only `onSelect` is used (no wrapping native form). */
  name?: string;
  label: string;
  initialSelected?: { id: number; label: string } | null;
  /** Called with the new selection (or null on "Change"), for a parent that holds its own state instead of relying on the hidden field -- e.g. GridSolverForm, which has no native form submission at all. */
  onSelect?: (selected: { id: number; label: string } | null) => void;
}) {
  const listId = useId();
  const [selected, setSelected] = useState(initialSelected);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlayerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search/autocomplete?q=${encodeURIComponent(term)}&scope=players`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { results: PlayerSuggestion[] };
        setSuggestions(data.results);
        setOpen(data.results.length > 0);
        setActive(-1);
      } catch {
        // Aborted or offline: leave the previous suggestions in place.
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function choose(suggestion: PlayerSuggestion) {
    const next = { id: suggestion.id, label: suggestion.title };
    setSelected(next);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    onSelect?.(next);
  }

  function change() {
    setSelected(null);
    setQuery('');
    onSelect?.(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  if (selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {name && <input type="hidden" name={name} value={selected.id} />}
        <strong>{selected.label}</strong>
        <button type="button" className="btn btn-secondary" onClick={change}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <label htmlFor={`${listId}-input`} className="visually-hidden">{label}</label>
      <input
        id={`${listId}-input`}
        type="search"
        value={query}
        placeholder={label}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          style={{
            position: 'absolute',
            zIndex: 30,
            left: 0,
            right: 0,
            margin: '4px 0 0',
            padding: 0,
            listStyle: 'none',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            textAlign: 'left',
            maxHeight: '20rem',
            overflowY: 'auto',
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '0.4rem 0.6rem',
                cursor: 'pointer',
                background: i === active ? 'var(--bg-hover)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 550 }}>{s.title}</div>
              {s.subtitle && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.subtitle}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
