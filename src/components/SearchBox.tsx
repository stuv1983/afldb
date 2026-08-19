'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import type { SearchAnimationType } from '@/lib/site-settings';
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
 * Global search with keyboard-accessible autocomplete and dynamic animated placeholders (see changeLog.md).
 *
 * Requests are debounced and require a minimum query length, so typing
 * does not issue a query per keystroke. In-flight requests are aborted
 * when superseded.
 */
export function SearchBox({
  autoFocus = false,
  placeholder,
  placeholders,
  intervalSeconds = 5,
  animation = 'typewriter',
  initialQuery = '',
  scope,
}: {
  autoFocus?: boolean;
  placeholder?: string;
  placeholders?: string[];
  intervalSeconds?: number;
  animation?: SearchAnimationType;
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
  const [isFocused, setIsFocused] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Dynamic placeholder animation
  const candidateList = (placeholders && placeholders.length > 0)
    ? placeholders
    : [placeholder || (scope === 'aflw' ? 'Search AFLW players and clubs…' : 'Search players, clubs, venues, seasons…')];

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [displayedPlaceholder, setDisplayedPlaceholder] = useState(candidateList[0] || '');

  useEffect(() => {
    if (candidateList.length <= 1) {
      setDisplayedPlaceholder(candidateList[0] || '');
      return;
    }

    if (isFocused || query.length > 0) {
      return;
    }

    const currentTarget = candidateList[placeholderIndex % candidateList.length] || '';

    if (animation === 'typewriter') {
      let charIdx = 0;
      let isDeleting = false;
      let timeoutId: NodeJS.Timeout;

      function step() {
        if (!isDeleting) {
          charIdx++;
          setDisplayedPlaceholder(currentTarget.slice(0, charIdx));
          if (charIdx >= currentTarget.length) {
            isDeleting = true;
            timeoutId = setTimeout(step, Math.max(1200, intervalSeconds * 1000));
          } else {
            timeoutId = setTimeout(step, 40);
          }
        } else {
          charIdx--;
          setDisplayedPlaceholder(currentTarget.slice(0, charIdx));
          if (charIdx <= 0) {
            isDeleting = false;
            setPlaceholderIndex((prev) => (prev + 1) % candidateList.length);
          } else {
            timeoutId = setTimeout(step, 25);
          }
        }
      }

      timeoutId = setTimeout(step, 100);
      return () => clearTimeout(timeoutId);
    } else {
      setDisplayedPlaceholder(currentTarget);
      const timer = setTimeout(() => {
        setPlaceholderIndex((prev) => (prev + 1) % candidateList.length);
      }, Math.max(1200, intervalSeconds * 1000));
      return () => clearTimeout(timer);
    }
  }, [candidateList, placeholderIndex, intervalSeconds, animation, isFocused, query]);

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
          placeholder={displayedPlaceholder || placeholder || 'Search…'}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
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
              aria-selected={active === i}
              style={{
                padding: '0.6rem 0.9rem',
                cursor: 'pointer',
                background: active === i ? 'var(--bg-hover)' : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                borderBottom: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s);
              }}
            >
              <span>
                <strong>{s.title}</strong>
                {s.subtitle && <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>{s.subtitle}</span>}
              </span>
              <span className="badge" style={{ fontSize: '0.75rem' }}>{SEARCH_TYPE_LABELS[s.type]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
