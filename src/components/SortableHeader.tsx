import Link from 'next/link';

import { SortDirection } from '@/lib/sorting';

export interface SortableHeaderProps {
  label: React.ReactNode;
  active: boolean;
  direction: SortDirection;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export function SortableHeader({
  label,
  active,
  direction,
  href,
  onClick,
  className,
}: SortableHeaderProps) {
  const content = (
    <span className="sort-content" style={{ display: 'flex', alignItems: 'center', gap: '0.25em' }}>
      {label}
      <span className="sort-indicator" aria-hidden="true" style={{ opacity: active ? 1 : 0.2 }}>
        {active ? (direction === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </span>
  );

  const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';

  if (href) {
    return (
      <th scope="col" className={className} aria-sort={ariaSort}>
        <Link
          href={href}
          className="sort-control"
          style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}
        >
          {content}
        </Link>
      </th>
    );
  }

  return (
    <th scope="col" className={className} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={onClick}
        className="sort-control"
        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}
      >
        {content}
      </button>
    </th>
  );
}
