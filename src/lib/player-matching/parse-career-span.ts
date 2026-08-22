/**
 * Hall of Fame playing_career -> a season range.
 *
 * The column is free text written by the source, and the real dev data
 * uses at least five shapes:
 *
 *   1992-2007                              one span
 *   1961-1972, 1973-1975                   several spans
 *   1997, 1998-2013                        a bare season beside a span
 *   1962-1965, 1967-1974, 1966             spans out of chronological order
 *   1974-78, 1984-88                       two-digit end years
 *
 * Only the outer bounds are used, so gaps (war years, a season at
 * another club) do not matter. Anything that does not parse yields
 * null, which the scorer reads as "no career-span evidence" -- never as
 * a contradiction. Punishing a candidate because a text field was
 * written unusually would be the worst possible use of this column.
 */

export type CareerSpan = { first: number; last: number };

/** Wide enough for the 1880s VFA-era inductees, tight enough to reject noise. */
const MIN_YEAR = 1850;
const MAX_YEAR = 2100;

/** "1974-78" -> 1978; "1899-07" -> 1907. */
function expandTwoDigitEnd(start: number, endRaw: string): number {
  const end = Number(endRaw);
  if (endRaw.length === 4) return end;
  const century = Math.floor(start / 100) * 100;
  const candidate = century + end;
  return candidate < start ? candidate + 100 : candidate;
}

function isPlausible(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

export function parseCareerSpan(raw: string | null | undefined): CareerSpan | null {
  if (!raw) return null;

  let first: number | null = null;
  let last: number | null = null;

  for (const token of raw.split(',')) {
    // Hyphen or en dash, either side optionally spaced.
    const match = /^\s*(\d{4})(?:\s*[-–]\s*(\d{2,4}))?\s*$/.exec(token);
    if (!match) continue;

    const start = Number(match[1]);
    if (!isPlausible(start)) continue;

    const end = match[2] === undefined ? start : expandTwoDigitEnd(start, match[2]);
    if (!isPlausible(end) || end < start) continue;

    first = first === null ? start : Math.min(first, start);
    last = last === null ? end : Math.max(last, end);
  }

  if (first === null || last === null) return null;
  return { first, last };
}
