export type SortType = 'number' | 'text' | 'date' | 'none';
export type SortDirection = 'asc' | 'desc';

/**
 * Compares two values for sorting, handling nulls and types appropriately.
 * Null/undefined values are always placed at the bottom regardless of sort direction.
 */
export function compareValues(
  a: any,
  b: any,
  type: SortType = 'text',
  dir: SortDirection = 'asc'
): number {
  const isANull = a === null || a === undefined || a === '';
  const isBNull = b === null || b === undefined || b === '';

  // Handle nulls: always at the bottom
  if (isANull && isBNull) return 0;
  if (isANull) return 1;
  if (isBNull) return -1;

  let result = 0;

  if (type === 'number') {
    const numA = Number(a);
    const numB = Number(b);
    result = numA - numB;
  } else if (type === 'date') {
    const dateA = new Date(a).getTime();
    const dateB = new Date(b).getTime();
    result = dateA - dateB;
  } else {
    // text
    const strA = String(a).toLowerCase();
    const strB = String(b).toLowerCase();
    if (strA < strB) result = -1;
    else if (strA > strB) result = 1;
  }

  return dir === 'asc' ? result : -result;
}
