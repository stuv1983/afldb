export type ExternalSource = 'squiggle' | 'kali';

export type ExternalCurrentMatch = {
  source: ExternalSource;
  externalGameId: string;
  season: number;
  roundLabel: string | null;
  roundNumber: number | null;
  completePercent: number | null;
  matchDate: string | null;
  venueRaw: string | null;
  homeTeamRaw: string | null;
  awayTeamRaw: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeGoals: number | null;
  homeBehinds: number | null;
  awayGoals: number | null;
  awayBehinds: number | null;
  rawPayload: unknown;
};

type JsonRecord = Record<string, unknown>;

const SQUIGGLE_BASE_URL = 'https://api.squiggle.com.au/';
const KALI_BASE_URL = 'https://kaliaflstats.com/api/afl/v1';

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function intValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

function scoreComponent(value: unknown): number | null {
  const n = intValue(value);
  return n !== null && n >= 0 ? n : null;
}

function dateOnly(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const human = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (!human) return null;
  const months: Record<string, string> = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
  };
  const month = months[human[2].toLowerCase()];
  if (!month) return null;
  return `${human[3]}-${month}-${human[1].padStart(2, '0')}`;
}

export function isPastDate(date: string | null): boolean {
  if (!date) return false;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return date < today;
}

function pick(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return null;
}

async function fetchJson(url: URL, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${url.toString()} failed with ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json() as Promise<unknown>;
}

function userAgent(): string {
  return process.env.AFLDB_EXTERNAL_API_USER_AGENT
    ?? 'AFLDB current-season refresh (configure AFLDB_EXTERNAL_API_USER_AGENT with contact email)';
}

export async function fetchSquiggleCurrentMatches(year: number): Promise<ExternalCurrentMatch[]> {
  const headers = { 'User-Agent': userAgent(), Accept: 'application/json' };
  const teamsUrl = new URL(SQUIGGLE_BASE_URL);
  teamsUrl.searchParams.set('q', 'teams');
  teamsUrl.searchParams.set('year', String(year));

  const teamsPayload = asRecord(await fetchJson(teamsUrl, headers));
  const teamNames = new Map<number, string>();
  for (const row of asArray(teamsPayload.teams)) {
    const team = asRecord(row);
    const id = intValue(team.id);
    const name = stringValue(pick(team, ['name', 'team', 'longname', 'abbrev']));
    if (id !== null && name) teamNames.set(id, name);
  }

  const gamesUrl = new URL(SQUIGGLE_BASE_URL);
  gamesUrl.searchParams.set('q', 'games');
  gamesUrl.searchParams.set('year', String(year));

  const gamesPayload = asRecord(await fetchJson(gamesUrl, headers));
  return asArray(gamesPayload.games).map((value) => {
    const game = asRecord(value);
    const homeId = intValue(pick(game, ['hteamid', 'hteam']));
    const awayId = intValue(pick(game, ['ateamid', 'ateam']));
    return {
      source: 'squiggle' as const,
      externalGameId: String(pick(game, ['id', 'gameid', 'game']) ?? ''),
      season: intValue(pick(game, ['year', 'season'])) ?? year,
      roundLabel: stringValue(pick(game, ['roundname', 'round'])),
      roundNumber: intValue(pick(game, ['round'])),
      completePercent: intValue(pick(game, ['complete'])),
      matchDate: dateOnly(pick(game, ['date', 'localtime'])),
      venueRaw: stringValue(pick(game, ['venue'])),
      homeTeamRaw: stringValue(pick(game, ['hteamname', 'homeTeam', 'homeTeamName']))
        ?? (homeId !== null ? teamNames.get(homeId) ?? null : null),
      awayTeamRaw: stringValue(pick(game, ['ateamname', 'awayTeam', 'awayTeamName']))
        ?? (awayId !== null ? teamNames.get(awayId) ?? null : null),
      homeScore: scoreComponent(pick(game, ['hscore', 'homeScore'])),
      awayScore: scoreComponent(pick(game, ['ascore', 'awayScore'])),
      homeGoals: scoreComponent(pick(game, ['hgoals', 'homeGoals'])),
      homeBehinds: scoreComponent(pick(game, ['hbehinds', 'homeBehinds'])),
      awayGoals: scoreComponent(pick(game, ['agoals', 'awayGoals'])),
      awayBehinds: scoreComponent(pick(game, ['abehinds', 'awayBehinds'])),
      rawPayload: game,
    };
  }).filter((game) => game.externalGameId.length > 0);
}

export async function fetchKaliCurrentMatches(year: number): Promise<ExternalCurrentMatch[]> {
  const apiKey = process.env.KALI_AFL_API_KEY;
  if (!apiKey) throw new Error('KALI_AFL_API_KEY is not set.');

  const url = new URL(`${process.env.KALI_AFL_API_BASE_URL ?? KALI_BASE_URL}/matches`);
  url.searchParams.set('year', String(year));
  url.searchParams.set('limit', '200');

  const payload = asRecord(await fetchJson(url, {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'User-Agent': userAgent(),
  }));

  return asArray(payload.data).map((value) => {
    const match = asRecord(value);
    const matchDate = dateOnly(pick(match, ['date', 'matchDate', 'startTime', 'scheduledAt']));
    const homeScore = scoreComponent(pick(match, ['homeScore', 'homePoints']));
    const awayScore = scoreComponent(pick(match, ['awayScore', 'awayPoints']));
    const rawComplete = intValue(pick(match, ['complete', 'completePercent']));
    return {
      source: 'kali' as const,
      externalGameId: String(pick(match, ['id', 'matchId', 'gameId']) ?? ''),
      season: intValue(pick(match, ['year', 'season'])) ?? year,
      roundLabel: stringValue(pick(match, ['roundName', 'roundLabel', 'round'])),
      roundNumber: intValue(pick(match, ['round', 'roundNumber'])),
      completePercent: rawComplete ?? (homeScore !== null && awayScore !== null && isPastDate(matchDate) ? 100 : null),
      matchDate,
      venueRaw: stringValue(pick(match, ['venue', 'venueName'])),
      homeTeamRaw: stringValue(pick(match, ['homeTeam', 'homeTeamName', 'homeTeamId', 'homeTeamSlug'])),
      awayTeamRaw: stringValue(pick(match, ['awayTeam', 'awayTeamName', 'awayTeamId', 'awayTeamSlug'])),
      homeScore,
      awayScore,
      homeGoals: scoreComponent(pick(match, ['homeGoals'])),
      homeBehinds: scoreComponent(pick(match, ['homeBehinds'])),
      awayGoals: scoreComponent(pick(match, ['awayGoals'])),
      awayBehinds: scoreComponent(pick(match, ['awayBehinds'])),
      rawPayload: match,
    };
  }).filter((match) => match.externalGameId.length > 0);
}
