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
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const fullKey = `afldb:table-order:${storageKey}`;

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
    if (next.join() !== defaultOrder.join()) setOrder(next);
    // Only ever re-read on a genuine navigation to a different page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey]);

  function persist(next: string[]) {
    setOrder(next);
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
    const next = order.filter((id) => id !== draggedId);
    next.splice(next.indexOf(targetId), 0, draggedId);
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
            onDragEnter={() => setDragOverId(id)}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragOverId((current) => (current === id ? null : current))}
            onDrop={(e) => { e.preventDefault(); dropOn(id); }}
          >
            <div className="reorder-controls">
              <div
                className="reorder-handle"
                aria-hidden="true"
                title="Drag to reorder"
                draggable
                onDragStart={() => { dragId.current = id; }}
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
