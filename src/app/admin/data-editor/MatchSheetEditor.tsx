'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { DeleteMatchButton } from '@/app/admin/data-editor/DeleteMatchButton';
import { saveMatchSheetAction, type MatchSheetActionState } from '@/app/admin/data-editor/actions';
import { PlayerPicker } from '@/components/PlayerPicker';
import type { MatchDetail, MatchPlayerRow } from '@/db/queries/matches';
import { formatDate, formatRoundShort } from '@/lib/format';
import {
  addPlayerToLineup,
  removePlayerFromLineup,
  replaceClubLineup,
  type LineupEditorState,
} from '@/lib/match-lineup-editor';

const INITIAL: MatchSheetActionState = {};

type EditablePlayerStat = {
  playerId: number;
  slug: string;
  displayName: string;
  clubId: number;
  editorOrder: number;
  jumperNumber: string;
  goals: string;
  behinds: string;
  kicks: string;
  handballs: string;
  disposals: string;
  marks: string;
  tackles: string;
  hitouts: string;
  freesFor: string;
  freesAgainst: string;
  brownlowVotes: string;
};

/**
 * Super Admin Match Sheet & Lineup Editor (see changeLog.md).
 * Allows viewing and editing player statistics for any match in real time,
 * recalculating team scores and derived player career & season totals.
 */
export function MatchSheetEditor({
  match,
  initialPlayers,
  homeRecentLineup = [],
  awayRecentLineup = [],
}: {
  match: MatchDetail;
  initialPlayers: MatchPlayerRow[];
  homeRecentLineup?: { playerId: number; slug: string; displayName: string; clubId: number; jumperNumber?: string | null }[];
  awayRecentLineup?: { playerId: number; slug: string; displayName: string; clubId: number; jumperNumber?: string | null }[];
}) {
  const [state, formAction, isPending] = useActionState(saveMatchSheetAction, INITIAL);

  const [lineup, setLineup] = useState<LineupEditorState<EditablePlayerStat>>(() => ({
    players: initialPlayers.map((p, editorOrder) => ({
      playerId: p.playerId,
      slug: p.slug,
      displayName: p.displayName,
      clubId: p.clubId,
      editorOrder,
      jumperNumber: p.jumperNumber ?? '',
      goals: p.goals !== null && p.goals !== undefined ? String(p.goals) : '',
      behinds: p.behinds !== null && p.behinds !== undefined ? String(p.behinds) : '',
      kicks: p.kicks !== null && p.kicks !== undefined ? String(p.kicks) : '',
      handballs: p.handballs !== null && p.handballs !== undefined ? String(p.handballs) : '',
      disposals: p.disposals !== null && p.disposals !== undefined ? String(p.disposals) : '',
      marks: p.marks !== null && p.marks !== undefined ? String(p.marks) : '',
      tackles: p.tackles !== null && p.tackles !== undefined ? String(p.tackles) : '',
      hitouts: p.hitouts !== null && p.hitouts !== undefined ? String(p.hitouts) : '',
      freesFor: p.freesFor !== null && p.freesFor !== undefined ? String(p.freesFor) : '',
      freesAgainst: p.freesAgainst !== null && p.freesAgainst !== undefined ? String(p.freesAgainst) : '',
      brownlowVotes: p.brownlowVotes !== null && p.brownlowVotes !== undefined ? String(p.brownlowVotes) : '',
    })),
    removedPlayerIds: [],
    vacancies: [],
  }));
  const { players, removedPlayerIds, vacancies } = lineup;
  const [activeTab, setActiveTab] = useState<'home' | 'away' | 'all'>('all');

  function handleLoadRecentLineup(team: 'home' | 'away') {
    const targetClubId = team === 'home' ? match.homeClubId : match.awayClubId;
    const lineupSource = team === 'home' ? homeRecentLineup : awayRecentLineup;

    if (!lineupSource || lineupSource.length === 0) {
      alert(`No previous match lineup found for ${team === 'home' ? match.homeName : match.awayName}.`);
      return;
    }

    setLineup((previous) => {
      const newTeamPlayers: EditablePlayerStat[] = lineupSource.map((r, editorOrder) => {
        const existing = previous.players.find(
          (player) => player.playerId === r.playerId && player.clubId === targetClubId,
        );
        return {
          playerId: r.playerId,
          slug: r.slug,
          displayName: r.displayName,
          clubId: targetClubId,
          editorOrder,
          jumperNumber: existing?.jumperNumber || r.jumperNumber || '',
          goals: existing?.goals || '',
          behinds: existing?.behinds || '',
          kicks: existing?.kicks || '',
          handballs: existing?.handballs || '',
          disposals: existing?.disposals || '',
          marks: existing?.marks || '',
          tackles: existing?.tackles || '',
          hitouts: existing?.hitouts || '',
          freesFor: existing?.freesFor || '',
          freesAgainst: existing?.freesAgainst || '',
          brownlowVotes: existing?.brownlowVotes || '',
        };
      });
      return replaceClubLineup(previous, targetClubId, newTeamPlayers);
    });
  }

  // Group players by club
  const homePlayers = useMemo(
    () => players
      .filter((player) => player.clubId === match.homeClubId)
      .sort((a, b) => a.editorOrder - b.editorOrder),
    [players, match.homeClubId],
  );
  const awayPlayers = useMemo(
    () => players
      .filter((player) => player.clubId === match.awayClubId)
      .sort((a, b) => a.editorOrder - b.editorOrder),
    [players, match.awayClubId],
  );

  // Calculate team totals
  function calculateTeamSummary(teamList: EditablePlayerStat[]) {
    let goals = 0;
    let behinds = 0;
    let kicks = 0;
    let handballs = 0;
    let disposals = 0;
    let marks = 0;
    let tackles = 0;
    let hitouts = 0;

    for (const p of teamList) {
      if (p.goals) goals += Number(p.goals) || 0;
      if (p.behinds) behinds += Number(p.behinds) || 0;
      if (p.kicks) kicks += Number(p.kicks) || 0;
      if (p.handballs) handballs += Number(p.handballs) || 0;
      if (p.disposals) disposals += Number(p.disposals) || 0;
      if (p.marks) marks += Number(p.marks) || 0;
      if (p.tackles) tackles += Number(p.tackles) || 0;
      if (p.hitouts) hitouts += Number(p.hitouts) || 0;
    }

    const score = goals * 6 + behinds;
    return { goals, behinds, score, kicks, handballs, disposals, marks, tackles, hitouts, count: teamList.length };
  }

  const homeSummary = useMemo(() => calculateTeamSummary(homePlayers), [homePlayers]);
  const awaySummary = useMemo(() => calculateTeamSummary(awayPlayers), [awayPlayers]);

  function handleFieldChange(playerId: number, field: keyof EditablePlayerStat, value: string) {
    setLineup((previous) => ({
      ...previous,
      players: previous.players.map((p) => {
        if (p.playerId !== playerId) return p;
        const updated = { ...p, [field]: value };

        // If kicks or handballs change, auto-update disposals if not custom
        if (field === 'kicks' || field === 'handballs') {
          const k = field === 'kicks' ? Number(value) || 0 : Number(p.kicks) || 0;
          const h = field === 'handballs' ? Number(value) || 0 : Number(p.handballs) || 0;
          if (value !== '' || p.kicks !== '' || p.handballs !== '') {
            updated.disposals = String(k + h);
          }
        }
        return updated;
      }),
    }));
  }

  function handleRemovePlayer(playerId: number) {
    setLineup((previous) => removePlayerFromLineup(previous, playerId));
  }

  function handleAddPlayer(
    selected: { id: number; label: string } | null,
    clubId: number,
    vacancyRemovedPlayerId?: number,
  ) {
    if (!selected) return;
    if (players.some((p) => p.playerId === selected.id)) {
      alert(`${selected.label} is already in the lineup for this match.`);
      return;
    }

    const nextEditorOrder = players
      .filter((player) => player.clubId === clubId)
      .reduce((maximum, player) => Math.max(maximum, player.editorOrder), -1) + 1;

    setLineup((previous) => addPlayerToLineup(previous, {
      playerId: selected.id,
      slug: selected.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      displayName: selected.label,
      clubId,
      editorOrder: nextEditorOrder,
      jumperNumber: '',
      goals: '',
      behinds: '',
      kicks: '',
      handballs: '',
      disposals: '',
      marks: '',
      tackles: '',
      hitouts: '',
      freesFor: '',
      freesAgainst: '',
      brownlowVotes: '',
    }, vacancyRemovedPlayerId).state);
  }

  const payloadString = useMemo(() => {
    const parsedPlayers = players.map((p) => ({
      playerId: p.playerId,
      clubId: p.clubId,
      jumperNumber: p.jumperNumber || null,
      goals: p.goals !== '' ? Number(p.goals) : null,
      behinds: p.behinds !== '' ? Number(p.behinds) : null,
      kicks: p.kicks !== '' ? Number(p.kicks) : null,
      handballs: p.handballs !== '' ? Number(p.handballs) : null,
      disposals: p.disposals !== '' ? Number(p.disposals) : null,
      marks: p.marks !== '' ? Number(p.marks) : null,
      tackles: p.tackles !== '' ? Number(p.tackles) : null,
      hitouts: p.hitouts !== '' ? Number(p.hitouts) : null,
      freesFor: p.freesFor !== '' ? Number(p.freesFor) : null,
      freesAgainst: p.freesAgainst !== '' ? Number(p.freesAgainst) : null,
      brownlowVotes: p.brownlowVotes !== '' ? Number(p.brownlowVotes) : null,
    }));

    return JSON.stringify({
      players: parsedPlayers,
      removedPlayerIds,
    });
  }, [players, removedPlayerIds]);

  function renderPlayerTable(teamList: EditablePlayerStat[], clubName: string, clubId: number, summary: ReturnType<typeof calculateTeamSummary>) {
    const teamRows = [
      ...teamList.map((player) => ({
        kind: 'player' as const,
        editorOrder: player.editorOrder,
        player,
      })),
      ...vacancies
        .filter((vacancy) => vacancy.clubId === clubId)
        .map((vacancy) => ({
          kind: 'vacancy' as const,
          editorOrder: vacancy.editorOrder,
          vacancy,
        })),
    ].sort((a, b) => a.editorOrder - b.editorOrder);

    return (
      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>
            {clubName} ({summary.count} players)
          </h3>
          <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>
            Total: {summary.goals}.{summary.behinds} ({summary.score})
          </span>
        </div>

        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th scope="col" style={{ width: '3.5rem' }}>#</th>
                <th scope="col" style={{ minWidth: '11rem' }}>Player</th>
                <th scope="col" className="num" title="Goals">G</th>
                <th scope="col" className="num" title="Behinds">B</th>
                <th scope="col" className="num" title="Kicks">K</th>
                <th scope="col" className="num" title="Handballs">H</th>
                <th scope="col" className="num" title="Disposals">D</th>
                <th scope="col" className="num" title="Marks">M</th>
                <th scope="col" className="num" title="Tackles">T</th>
                <th scope="col" className="num" title="Hitouts">HO</th>
                <th scope="col" className="num" title="Frees For">FF</th>
                <th scope="col" className="num" title="Frees Against">FA</th>
                <th scope="col" className="num" title="Brownlow Votes">BV</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {teamRows.map((row) => {
                if (row.kind === 'vacancy') {
                  const { vacancy } = row;
                  return (
                    <tr key={`vacancy-${vacancy.removedPlayerId}`} style={{ background: 'var(--bg-subtle)' }}>
                      <td colSpan={14}>
                        <div style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.25rem 0',
                        }}>
                          <span style={{ minWidth: '13rem' }}>
                            <strong>Lineup spot open</strong>
                            <span className="muted"> — {vacancy.removedPlayerName} removed</span>
                          </span>
                          <div style={{ flex: '1 1 18rem', maxWidth: '32rem' }}>
                            <PlayerPicker
                              label={`+ Add replacement for ${clubName}`}
                              onSelect={(selected) => handleAddPlayer(
                                selected,
                                clubId,
                                vacancy.removedPlayerId,
                              )}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                const { player: p } = row;
                return (
                  <tr key={p.playerId}>
                  <td>
                    <input
                      type="text"
                      value={p.jumperNumber}
                      maxLength={4}
                      placeholder="—"
                      onChange={(e) => handleFieldChange(p.playerId, 'jumperNumber', e.target.value)}
                      style={{ width: '2.5rem', padding: '0.2rem 0.3rem', fontSize: '0.85rem' }}
                    />
                  </td>
                  <td className="wide">
                    <Link href={`/players/${p.slug}-${p.playerId}`} target="_blank">
                      {p.displayName}
                    </Link>
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={40}
                      value={p.goals}
                      onChange={(e) => handleFieldChange(p.playerId, 'goals', e.target.value)}
                      style={{ width: '3rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={40}
                      value={p.behinds}
                      onChange={(e) => handleFieldChange(p.playerId, 'behinds', e.target.value)}
                      style={{ width: '3rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={p.kicks}
                      onChange={(e) => handleFieldChange(p.playerId, 'kicks', e.target.value)}
                      style={{ width: '3.2rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={p.handballs}
                      onChange={(e) => handleFieldChange(p.playerId, 'handballs', e.target.value)}
                      style={{ width: '3.2rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={150}
                      value={p.disposals}
                      onChange={(e) => handleFieldChange(p.playerId, 'disposals', e.target.value)}
                      style={{ width: '3.4rem', textAlign: 'right', padding: '0.2rem', fontWeight: 600 }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={p.marks}
                      onChange={(e) => handleFieldChange(p.playerId, 'marks', e.target.value)}
                      style={{ width: '3rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={p.tackles}
                      onChange={(e) => handleFieldChange(p.playerId, 'tackles', e.target.value)}
                      style={{ width: '3rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={p.hitouts}
                      onChange={(e) => handleFieldChange(p.playerId, 'hitouts', e.target.value)}
                      style={{ width: '3rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={p.freesFor}
                      onChange={(e) => handleFieldChange(p.playerId, 'freesFor', e.target.value)}
                      style={{ width: '2.8rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={p.freesAgainst}
                      onChange={(e) => handleFieldChange(p.playerId, 'freesAgainst', e.target.value)}
                      style={{ width: '2.8rem', textAlign: 'right', padding: '0.2rem' }}
                    />
                  </td>
                  <td className="num">
                    <select
                      value={p.brownlowVotes}
                      onChange={(e) => handleFieldChange(p.playerId, 'brownlowVotes', e.target.value)}
                      style={{ width: '3rem', padding: '0.2rem' }}
                    >
                      <option value="">—</option>
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleRemovePlayer(p.playerId)}
                      style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                      title="Remove player from this match lineup"
                    >
                      ✕
                    </button>
                  </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, background: 'var(--bg-subtle)' }}>
                <td colSpan={2}>Team Totals</td>
                <td className="num">{summary.goals}</td>
                <td className="num">{summary.behinds}</td>
                <td className="num">{summary.kicks}</td>
                <td className="num">{summary.handballs}</td>
                <td className="num">{summary.disposals}</td>
                <td className="num">{summary.marks}</td>
                <td className="num">{summary.tackles}</td>
                <td className="num">{summary.hitouts}</td>
                <td colSpan={4} style={{ textAlign: 'right' }}>
                  Score: {summary.score}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.65rem 0.75rem',
          border: '1px dashed var(--border-subtle)',
          borderRadius: '6px',
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Need another {clubName} lineup change?
          </span>
          <div style={{ flex: '1 1 18rem', maxWidth: '32rem' }}>
            <PlayerPicker
              key={`add-${clubId}-${teamList.length}`}
              label={`+ Add another player to ${clubName}`}
              onSelect={(selected) => handleAddPlayer(selected, clubId)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="section" style={{ display: 'grid', gap: '1.25rem' }}>
      {/* Header Context */}
      <div style={{
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-subtle)',
        borderRadius: '8px',
        padding: '1rem 1.25rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <span className="badge" style={{ marginBottom: '0.4rem' }}>
              {match.season} {formatRoundShort(match.roundType, match.roundNumber)}
            </span>
            <h2 style={{ margin: '0.2rem 0' }}>
              {match.homeName} vs {match.awayName}
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {formatDate(match.matchDate)} · {match.venueName} · Match ID #{match.id}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Link href={`/matches/${match.id}`} target="_blank" className="btn btn-secondary">
              View public match page ↗
            </Link>
            <Link href={`/admin/data-editor?entity=matches&id=${match.id}`} className="btn btn-secondary">
              Match details editor
            </Link>
          </div>
        </div>
      </div>

      {state.message && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', borderRadius: '6px', borderLeft: '4px solid var(--accent)' }}>
          <p style={{ margin: 0, color: 'var(--accent)', fontWeight: 600, fontSize: '0.95rem' }}>
            ✓ {state.message}
          </p>
        </div>
      )}

      {state.warning && (
        <div className="badge badge-warn" style={{ justifySelf: 'start' }}>
          {state.warning}
        </div>
      )}

      {state.error && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', borderRadius: '6px', borderLeft: '4px solid var(--color-warn)' }}>
          <p style={{ margin: 0, color: 'var(--color-warn)', fontSize: '0.95rem' }}>
            ⚠ {state.error}
          </p>
        </div>
      )}

      {/* Quick Lineup Helpers */}
      {(homeRecentLineup.length > 0 || awayRecentLineup.length > 0) && (
        <div style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '0.85rem 1rem',
          background: 'var(--bg-subtle)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Quick lineup helpers:</span>
            {homeRecentLineup.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                onClick={() => handleLoadRecentLineup('home')}
                title={`Copy previous ${homeRecentLineup.length}-player team lineup for ${match.homeName}`}
              >
                📋 Load {match.homeName} previous lineup ({homeRecentLineup.length} players)
              </button>
            )}
            {awayRecentLineup.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                onClick={() => handleLoadRecentLineup('away')}
                title={`Copy previous ${awayRecentLineup.length}-player team lineup for ${match.awayName}`}
              >
                📋 Load {match.awayName} previous lineup ({awayRecentLineup.length} players)
              </button>
            )}
          </div>
        </div>
      )}

      {/* View Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          className={`btn ${activeTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('all')}
        >
          Both teams
        </button>
        <button
          type="button"
          className={`btn ${activeTab === 'home' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('home')}
        >
          {match.homeName} ({homePlayers.length})
        </button>
        <button
          type="button"
          className={`btn ${activeTab === 'away' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('away')}
        >
          {match.awayName} ({awayPlayers.length})
        </button>
      </div>

      {/* Main Save Form */}
      <form action={formAction} style={{ display: 'grid', gap: '1rem' }}>
        <input type="hidden" name="matchId" value={match.id} />
        <input type="hidden" name="payload" value={payloadString} />
        <input type="hidden" name="syncMatchScores" value="false" />

        {(activeTab === 'all' || activeTab === 'home') &&
          renderPlayerTable(homePlayers, match.homeName, match.homeClubId, homeSummary)}

        {(activeTab === 'all' || activeTab === 'away') &&
          renderPlayerTable(awayPlayers, match.awayName, match.awayClubId, awaySummary)}

        <div style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '1rem',
          display: 'grid',
          gap: '0.75rem',
        }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Team scores stay separate from player totals because rushed behinds are not attributed to a player.
            Use Match Details to edit the official team score.
          </p>

          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Verification / Audit note (optional)
            <input
              type="text"
              name="note"
              maxLength={2000}
              placeholder="e.g. Sourced from official AFL match report"
              style={{ maxWidth: '36rem', fontSize: '0.85rem' }}
            />
          </label>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem' }}>
            <button type="submit" disabled={isPending} style={{ padding: '0.6rem 1.25rem', fontSize: '0.95rem' }}>
              {isPending ? 'Saving match sheet & recalculating stats…' : 'Save match sheet & update player stats'}
            </button>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {players.length} total players ({homePlayers.length} home, {awayPlayers.length} away)
            </span>
          </div>
        </div>
      </form>

      {/* Danger Zone: Delete Match */}
      <div style={{
        marginTop: '2rem',
        borderTop: '1px dashed var(--border-subtle)',
        paddingTop: '1.25rem',
        display: 'grid',
        gap: '0.5rem',
      }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-warn)' }}>Match Management</h4>
        <DeleteMatchButton
          matchId={match.id}
          matchDescription={`${match.homeName} vs ${match.awayName} (${match.season} ${formatRoundShort(match.roundType, match.roundNumber)})`}
        />
      </div>
    </section>
  );
}
