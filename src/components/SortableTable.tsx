'use client';

import { useMemo, useState } from 'react';

import { compareValues, SortDirection, SortType } from '@/lib/sorting';
import { SortableHeader } from './SortableHeader';

export interface SortableColumn<TKey extends string> {
  key: TKey;
  label: React.ReactNode;
  sortable?: boolean;
  sortType?: SortType;
  className?: string;
  initialDirection?: SortDirection;
}

export interface SortableItem<TKey extends string> {
  id: string | number;
  values: Record<TKey, any>;
  element: React.ReactNode;
}

export interface SortableTableProps<TKey extends string> {
  columns: SortableColumn<TKey>[];
  items: SortableItem<TKey>[];
  defaultSort?: TKey;
  defaultDir?: SortDirection;
  caption?: React.ReactNode;
  className?: string;
}

export function SortableTable<TKey extends string>({
  columns,
  items,
  defaultSort,
  defaultDir = 'desc',
  caption,
  className,
}: SortableTableProps<TKey>) {
  const [sortKey, setSortKey] = useState<TKey | undefined>(defaultSort);
  const [sortDir, setSortDir] = useState<SortDirection>(defaultDir);

  const sortedItems = useMemo(() => {
    if (!sortKey) return items;

    const col = columns.find((c) => c.key === sortKey);
    if (!col) return items;

    const type = col.sortType ?? 'text';

    return [...items].sort((a, b) => {
      const valA = a.values[sortKey];
      const valB = b.values[sortKey];
      return compareValues(valA, valB, type, sortDir);
    });
  }, [items, sortKey, sortDir, columns]);

  const handleSort = (key: TKey) => {
    const col = columns.find((c) => c.key === key);
    if (col && col.sortable === false) return;

    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      const defaultForCol =
        col?.initialDirection ??
        (col?.sortType === 'number' || col?.sortType === 'date' ? 'desc' : 'asc');
      setSortDir(defaultForCol);
    }
  };

  return (
    <table className={className}>
      {caption && <caption>{caption}</caption>}
      <thead>
        <tr>
          {columns.map((col) => {
            const isSortable =
              col.sortable !== false && (col.sortType !== undefined || col.sortable === true);

            if (!isSortable) {
              return (
                <th key={col.key} scope="col" className={col.className}>
                  {col.label}
                </th>
              );
            }

            return (
              <SortableHeader
                key={col.key}
                label={col.label}
                active={sortKey === col.key}
                direction={sortDir}
                onClick={() => handleSort(col.key)}
                className={col.className}
              />
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedItems.map((item) => item.element)}
      </tbody>
    </table>
  );
}
