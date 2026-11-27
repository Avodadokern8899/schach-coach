// Analysiert eine Partie Zug für Zug mit Stockfish und stuft die Züge ein.
import { Chess } from '../lib/chess.js';

export const CLASS = {
  best: { label: 'Bester Zug', short: '★' },
  good: { label: 'Guter Zug', short: '' },
  inaccuracy: { label: 'Ungenauigkeit', short: '?!' },
  mistake: { label: 'Fehler', short: '?' },
  blunder: { label: 'Patzer', short: '??' },
};

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME = { p: 'Bauer', n: 'Springer', b: 'Läufer', r: 'Turm', q: 'Dame', k: 'König' };

// Gewinnwahrscheinlichkeit (0–100) aus Centipawns, Formel wie bei Lichess.
export function winPercent(ev) {
  if (ev.mate !== null && ev.mate !== undefined) return ev.mate > 0 ? 100 : 0;
  const cp = Math.max(-1500, Math.min(1500, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatEval(ev) {
  if (ev.mate !== null && ev.mate !== undefined) {
    if (Math.abs(ev.mate) < 1) return '#'; // Stellung ist bereits matt
    return (ev.mate > 0 ? '+M' : '-M') + Math.abs(ev.mate);
  }
  const v = ev.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

function parseClocks(pgn) {
  const out = [];
  const re = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  let m;
  while ((m = re.exec(pgn))) out.push(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
  return out;
}

export function baseTime(timeControl) {
  if (!timeControl || timeControl.includes('/')) return null; // Tagespartie
  return parseInt(timeControl.split('+')[0], 10) || null;
}

function phaseOf(chess, moveNumber) {
  let material = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== 'p' && sq.type !== 'k') material += PIECE_VALUE[sq.type];
  if (material <= 26) return 'endgame';
  if (moveNumber <= 12) return 'opening';
  return 'middlegame';
}

function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return mv ? mv.san : null;
  } catch {
    return null;
  }
}

function pvToSan(fen, pv, max = 6) {
  const c = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, max)) {
    try {
      const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!mv) break;
      out.push(mv.san);
    } catch {
      break;
    }
  }
  return out;
}

// Stellung bei Partieende ohne Engine bewerten.
function terminalEval(chess) {
  if (chess.isCheckmate()) return { cp: null, mate: chess.turn() === 'w' ? -0.0001 : 0.0001, best: null, pv: [] };
  if (chess.isDraw() || chess.isStalemate()) return { cp: 0, mate: null, best: null, pv: [] };
  return null;
}

export async function analyseGame(game, engine, { depth = 12, onProgress } = {}) {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const moves = chess.history({ verbose: true });
  const clocks = parseClocks(game.pgn);

  // Alle Stellungen (Start + nach jedem Zug) bewerten.
  const fens = [moves.length ? moves[0].before : chess.fen(), ...moves.map((m) => m.after)];
  const evals = [];
  engine.newGame();
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]);
    evals.push(terminalEval(c) || (await engine.analyse(fens[i], depth)));
    onProgress && onProgress((i + 1) / fens.length);
  }

  const result = [];
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const before = evals[i];
    const after = evals[i + 1];
    const sign = mv.color === 'w' ? 1 : -1;
    const wpBefore = mv.color === 'w' ? winPercent(before) : 100 - winPercent(before);
    const wpAfter = mv.color === 'w' ? winPercent(after) : 100 - winPercent(after);
    const drop = Math.max(0, wpBefore - wpAfter);
    const playedUci = mv.from + mv.to + (mv.promotion || '');

    let cls = 'good';
    if (before.best && playedUci === before.best) cls = 'best';
    else if (drop >= 30) cls = 'blunder';
    else if (drop >= 20) cls = 'mistake';
    else if (drop >= 10) cls = 'inaccuracy';

    const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
    const moveNumber = Math.floor(i / 2) + 1;
    const posAfter = new Chess(mv.after);

    // Was hätte der Gegner nach einem Fehler spielen können?
    let refutation = null;
    if ((cls === 'blunder' || cls === 'mistake') && after.best) {
      const san = uciToSan(mv.after, after.best);
      const target = posAfter.get(after.best.slice(2, 4));
      refutation = {
        san,
        captures: target ? PIECE_NAME[target.type] : null,
        line: pvToSan(mv.after, after.pv),
      };
    }

    result.push({
      ply: i,
      moveNumber,
      color: mv.color,
      san: mv.san,
      from: mv.from,
      to: mv.to,
      fenBefore: mv.before,
      fenAfter: mv.after,
      evalBefore: before,
      evalAfter: after,
      wpBefore,
      wpAfter,
      drop,
      cls,
      accuracy,
      bestSan: before.best && cls !== 'best' ? uciToSan(mv.before, before.best) : null,
      bestUci: before.best,
      bestLine: before.best ? pvToSan(mv.before, before.pv) : [],
      refutation,
      clock: clocks[i] ?? null,
      phase: phaseOf(posAfter, moveNumber),
      cpSign: sign,
    });
  }

  return { gameId: game.id, depth, moves: result, evals: evals.map((e) => ({ cp: e.cp, mate: e.mate })) };
}

// Kennzahlen für einen Spieler (Farbe 'w' oder 'b') berechnen.
export function summarise(analysis, color, timeControl) {
  const mine = analysis.moves.filter((m) => m.color === color);
  const count = (c) => mine.filter((m) => m.cls === c).length;
  const accuracy = mine.length ? mine.reduce((s, m) => s + m.accuracy, 0) / mine.length : 0;
  const base = baseTime(timeControl);
  const errors = mine.filter((m) => m.cls === 'blunder' || m.cls === 'mistake');
  const byPhase = { opening: 0, middlegame: 0, endgame: 0 };
  const movesByPhase = { opening: 0, middlegame: 0, endgame: 0 };
  for (const m of mine) movesByPhase[m.phase]++;
  for (const m of errors) byPhase[m.phase]++;
  const lowTime = (m) => base && m.clock !== null && (m.clock < base * 0.1 || m.clock < 15);
  return {
    accuracy,
    best: count('best'),
    inaccuracies: count('inaccuracy'),
    mistakes: count('mistake'),
    blunders: count('blunder'),
    errors,
    byPhase,
    movesByPhase,
    timePressureErrors: errors.filter(lowTime).length,
    timePressureMoves: mine.filter(lowTime).length,
    hungPieces: errors.filter((m) => m.refutation && m.refutation.captures && m.refutation.captures !== 'Bauer').length,
  };
}

export const PHASE_NAME = { opening: 'Eröffnung', middlegame: 'Mittelspiel', endgame: 'Endspiel' };
