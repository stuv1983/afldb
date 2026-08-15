'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Lets a reader drag a page's table sections into whatever order suits
 * them, remembered per page (by pathname) in localStorage.
 *
 * Renders the default order first -- the same markup the server sent --
 * and only reorders after mount, once localStorage has been read. That
 * keeps hydration matching the server render; a reader with a saved order
 * sees one reflow right after load rather than a hydration mismatch.
 *
 * Both a native HTML5 drag (mouse/trackpad) and Move up/down buttons
 * (keyboard, touch, screen reader) drive the same `move`/`reorder` state,
 * so nobody needs the drag gesture to actually use this.
 */
export function ReorderableSections({
  storageKey,
  sections,
}: {
  /** Unique per page -- callers pass the pathname. */
  storageKey: string;
  sections: { id: string; label: string; node: React.ReactNode }[];
}) {
  const defaultOrder = sections.map((s) => s.id);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const fullKey = `afldb:table-order:${storageKey}`;
  // What the held order is an order OF. The App Router keeps a client
  // component mounted across a navigation that only changes route params
  // (/clubs/a to /clubs/b, one season to the next), so without this the
  // state would still hold the previous page's ids -- and since the render
  // below is `order.map`, any section the new page has that the old one
  // lacked would silently never appear. Rebuilding on either half changing
  // is React's "adjust state during render" pattern, not an effect, so no
  // wrong-page render is ever committed.
  const signature = `${fullKey}|${defaultOrder.join()}`;

  const [state, setState] = useState({ signature, order: defaultOrder });
  if (state.signature !== signature) setState({ signature, order: defaultOrder });
  const order = state.signature === signature ? state.order : defaultOrder;

  // The restored order awaiting a re-anchor, held by identity rather than as
  // a flag: on mount both effects run back to back, before the restore's
  // setState has re-rendered anything, so the effect below has to be able to
  // tell "the DOM you are looking at is already the reordered one" from "the
  // reorder has not painted yet".
  const reanchorFor = useRef<string[] | null>(null);

  useEffect(() => {
    let saved: string[] | null = null;
    try {
      const raw = localStorage.getItem(fullKey);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
    if (!saved || !Array.isArray(saved)) return;

    // A page's sections can change between visits (a filter changing what
    // renders, a deploy adding one); keep only ids that still exist, and
    // append any new ones at the end rather than dropping them.
    const known = new Set(defaultOrder);
    const restored = saved.filter((id): id is string => known.has(id));
    const missing = defaultOrder.filter((id) => !restored.includes(id));
    const next = [...restored, ...missing];
    if (next.join() === defaultOrder.join()) return;
    reanchorFor.current = next;
    setState({ signature, order: next });
    // Re-read whenever the page or its section list changes; `signature`
    // covers both, and `defaultOrder` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (reanchorFor.current !== order) return;
    reanchorFor.current = null;
    // A filtered table returns to its own anchor (see TableFilters), and the
    // browser scrolled there against the server's default order. The reorder
    // has now painted and moved that element, so put the viewport back on it.
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash))?.scrollIntoView();
  }, [order]);

  function persist(next: string[]) {
    setState({ signature, order: next });
    try {
      localStorage.setItem(fullKey, JSON.stringify(next));
    } catch {
      // Private browsing / storage full: reordering still works for this
      // page view, it just won't be remembered next time.
    }
  }

  function move(id: string, direction: -1 | 1) {
    const i = order.indexOf(id);
    const j = i + direction;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  }

  function dropOn(targetId: string) {
    const draggedId = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const from = order.indexOf(draggedId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = order.filter((id) => id !== draggedId);
    // Dropping onto a section BELOW means "put it after that one", which is
    // also the only way to reach the last position -- there is no drop
    // target past the final section to aim at. Dragging upwards keeps the
    // other reading, before the target.
    next.splice(next.indexOf(targetId) + (from < to ? 1 : 0), 0, draggedId);
    persist(next);
  }

  const byId = new Map(sections.map((s) => [s.id, s]));

  return (
    <>
      {order.map((id, i) => {
        const section = byId.get(id);
        if (!section) return null;
        return (
          <div
            key={id}
            className={`reorderable-section${dragOverId === id ? ' is-drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              // Highlighting from dragover rather than dragenter: dragenter
              // fires per child boundary, so the pair raced each other and
              // the outline flickered off while the cursor sat over a table.
              // dragover repeats for as long as the cursor is here, and React
              // bails out of a set to the same id, so this does not re-render.
              if (dragId.current && dragId.current !== id) setDragOverId(id);
            }}
            onDragLeave={(e) => {
              // dragleave also fires on every child boundary and bubbles;
              // relatedTarget is where the cursor went, so a move deeper into
              // this section is not a leave.
              const to = e.relatedTarget as Node | null;
              if (to && e.currentTarget.contains(to)) return;
              setDragOverId((current) => (current === id ? null : current));
            }}
            onDrop={(e) => { e.preventDefault(); dropOn(id); }}
          >
            <div className="reorder-controls">
              <div
                className="reorder-handle"
                aria-hidden="true"
                title="Drag to reorder"
                draggable
                onDragStart={(e) => {
                  dragId.current = id;
                  // Firefox starts no drag at all unless dragstart puts
                  // something on the DataTransfer; the ref alone left the
                  // handle inert there, buttons the only way to reorder.
                  e.dataTransfer.setData('text/plain', id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => { dragId.current = null; setDragOverId(null); }}
              >
                ⠿⠿
              </div>
              <button
                type="button"
                className="reorder-btn"
                aria-label={`Move ${section.label} up`}
                disabled={i === 0}
                onClick={() => move(id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="reorder-btn"
                aria-label={`Move ${section.label} down`}
                disabled={i === order.length - 1}
                onClick={() => move(id, 1)}
              >
                ↓
              </button>
            </div>
            <div className="reorderable-section-content">{section.node}</div>
          </div>
        );
      })}
    </>
  );
}
