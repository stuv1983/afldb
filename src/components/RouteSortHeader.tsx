'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { SortableHeader } from '@/components/SortableHeader';
import { SortDirection } from '@/lib/sorting';

export interface RouteSortHeaderProps {
  sortKey: string;
  defaultSort: string;
  defaultDir: SortDirection;
  children: React.ReactNode;
  className?: string;
}

export function RouteSortHeader({
  sortKey,
  defaultSort,
  defaultDir,
  children,
  className,
}: RouteSortHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentSort = searchParams.get('sort') ?? defaultSort;
  const currentDir = (searchParams.get('dir') as SortDirection) ?? defaultDir;

  const active = currentSort === sortKey;
  let nextDir: SortDirection = defaultDir;
  if (active) {
    nextDir = currentDir === 'asc' ? 'desc' : 'asc';
  }

  const nextParams = new URLSearchParams(searchParams.toString());
  nextParams.set('sort', sortKey);
  nextParams.set('dir', nextDir);
  // Reset page to 1 on sort change
  if (nextParams.has('page')) {
    nextParams.delete('page');
  }

  return (
    <SortableHeader
      label={children}
      active={active}
      direction={active ? currentDir : nextDir}
      href={`${pathname}?${nextParams.toString()}`}
      className={className}
    />
  );
}
