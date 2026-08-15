'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import {
  MIN_QUERY_LENGTH,
  SEARCH_TYPE_LABELS,
  searchResultHref,
  type SearchResultType,
} from '@/search/constants';

type Suggestion = {
  type: SearchResultType;
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
};

/**
 * Global search with keyboard-accessible autocomplete.
 *
 * Requests are debounced and require a minimum query length, so typing
 * does not issue a query per keystroke. In-flight requests are aborted
 * when superseded.
 */
export function SearchBox({
  autoFocus = false,
  placeholder = 'Search players, clubs, venues…',
  initialQuery = '',
  scope,
}: {
  autoFocus?: boolean;
  placeholder?: string;
  initialQuery?: string;
  /** Restrict search to AFLW players and clubs, on `/aflw` and `/search?scope=aflw`. */
  scope?: 'aflw';
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
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
        const scopeParam = scope ? `&scope=${scope}` : '';
        const res = await fetch(`/api/search/autocomplete?q=${encodeURIComponent(term)}${scopeParam}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { results: Suggestion[] };
        setSuggestions(data.results);
        setOpen(data.results.length > 0);
        setActive(-1);
      } catch {
        // Aborted or offline: leave the previous suggestions in place.
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query, scope]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function go(suggestion: Suggestion) {
    setOpen(false);
    // Route by type: a season suggestion goes to /seasons, an award to
    // /awards. Everything previously went to /players regardless.
    router.push(searchResultHref(suggestion));
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
      go(suggestions[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <form className="search-form" action="/search" role="search">
        <label htmlFor={`${listId}-input`} className="visually-hidden">
          {scope === 'aflw' ? 'Search AFLW' : 'Search AFL history'}
        </label>
        {scope && <input type="hidden" name="scope" value={scope} />}
        <input
          id={`${listId}-input`}
          name="q"
          type="search"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn" type="submit">Search</button>
      </form>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
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
              key={`${s.type}-${s.id}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); go(s); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '0.4rem 0.6rem',
                cursor: 'pointer',
                background: i === active ? 'var(--bg-hover)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'baseline', gap: '0.5rem',
              }}>
                <span style={{ fontWeight: 550 }}>{s.title}</span>
                {s.type !== 'player' && (
                  <span style={{
                    fontSize: '0.68rem',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    flexShrink: 0,
                  }}>
                    {SEARCH_TYPE_LABELS[s.type] ?? s.type}
                  </span>
                )}
              </div>
              {s.subtitle && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {s.subtitle}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
