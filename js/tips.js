// Erzeugt verständliche Tipps auf Deutsch aus den Analysedaten.
import { summarise, PHASE_NAME, formatEval } from './analysis.js';
import { openingFamily } from './chesscom.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function moveLabel(m) {
  return `${m.moveNumber}${m.color === 'w' ? '.' : '…'} ${m.san}`;
}

// Tipps für eine einzelne Partie.
export function gameTips(game, analysis) {
  const color = game.color === 'white' ? 'w' : 'b';
  const s = summarise(analysis, color, game.timeControl);
  const tips = [];

  if (s.blunders + s.mistakes === 0) {
    tips.push({ kind: 'good', text: 'Keine groben Fehler in dieser Partie – stark gespielt!' });
  }

  // Größter Fehler mit Erklärung
  const worst = [...s.errors].sort((a, b) => b.drop - a.drop)[0];
  if (worst) {
    let t = `Der teuerste Zug war <b>${moveLabel(worst)}</b> (Bewertung ${formatEval(worst.evalBefore)} → ${formatEval(worst.evalAfter)}).`;
    if (worst.bestSan) t += ` Besser war <b>${worst.bestSan}</b>.`;
    if (worst.refutation && worst.refutation.san) {
      if (worst.refutation.san.endsWith('#')) t += ` Danach konnte dein Gegner mit <b>${worst.refutation.san}</b> sofort Schachmatt setzen.`;
      else {
        t += ` Danach hätte dein Gegner mit <b>${worst.refutation.san}</b> antworten können`;
        t += worst.refutation.captures ? ` und dabei ${artikel(worst.refutation.captures)} geschlagen.` : '.';
      }
    }
    tips.push({ kind: 'bad', text: t, ply: worst.ply });
  }

  if (s.hungPieces >= 1) {
    tips.push({
      kind: 'tip',
      text: `Du hast ${s.hungPieces === 1 ? 'einmal' : s.hungPieces + '-mal'} eine Figur ungeschützt gelassen. Gewöhn dir vor jedem Zug die Frage an: <i>„Was greift der Gegner nach meinem Zug an – und ist alles gedeckt?“</i>`,
    });
  }

  // Phase mit den meisten Fehlern
  const phases = Object.entries(s.byPhase).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (phases.length && s.errors.length >= 2) {
    const [phase, n] = phases[0];
    tips.push({ kind: 'tip', text: `${n} deiner ${s.errors.length} Fehler passierten im <b>${PHASE_NAME[phase]}</b>. ${PHASE_ADVICE[phase]}` });
  }

  if (s.timePressureErrors > 0) {
    tips.push({
      kind: 'tip',
      text: `${s.timePressureErrors} Fehler hast du unter Zeitdruck gemacht. Versuche, in der Eröffnung schneller zu spielen, damit dir später mehr Zeit bleibt.`,
    });
  }

  // Verpasste Chancen: Gegner patzt, ich nutze es nicht
  const missed = analysis.moves.filter((m, i) => {
    if (m.color !== color || i === 0) return false;
    const prev = analysis.moves[i - 1];
    return (prev.cls === 'blunder' || prev.cls === 'mistake') && m.drop >= 20;
  });
  if (missed.length) {
    const m = missed[0];
    tips.push({
      kind: 'tip',
      text: `Verpasste Chance bei <b>${moveLabel(m)}</b>: Dein Gegner hatte gerade einen Fehler gemacht. Mit <b>${m.bestSan}</b> hättest du ihn bestrafen können. Schau nach einem gegnerischen Zug immer zuerst: <i>Schach, Schlagen, Drohungen?</i>`,
      ply: m.ply,
    });
  }

  return { summary: s, tips };
}

const PHASE_ADVICE = {
  opening:
    'Tipp: Entwickle zuerst Springer und Läufer, bring den König per Rochade in Sicherheit und zieh dieselbe Figur nicht zweimal ohne Grund.',
  middlegame:
    'Tipp: Im Mittelspiel helfen Taktikaufgaben am meisten – schon 10 Minuten am Tag schärfen den Blick für Gabeln, Fesselungen und ungedeckte Figuren.',
  endgame:
    'Tipp: Lerne die Grundendspiele (König+Bauer gegen König, Turmendspiele). Aktiviere im Endspiel deinen König – er ist dann eine starke Figur.',
};

function artikel(piece) {
  return { Bauer: 'einen Bauern', Springer: 'einen Springer', Läufer: 'einen Läufer', Turm: 'einen Turm', Dame: 'die Dame', König: 'den König' }[piece] || piece;
}

// Statistik über alle geladenen Partien (ohne Engine).
export function overviewStats(games) {
  const stats = { total: games.length, win: 0, draw: 0, loss: 0, byColor: {}, byOpening: {}, lossReasons: {}, byTimeClass: {} };
  for (const g of games) {
    stats[g.outcome]++;
    for (const [key, map] of [
      [g.color, stats.byColor],
      [g.timeClass, stats.byTimeClass],
      [(g.color === 'white' ? 'Weiß: ' : 'Schwarz: ') + openingFamily(g.opening), stats.byOpening],
    ]) {
      map[key] = map[key] || { win: 0, draw: 0, loss: 0, total: 0 };
      map[key][g.outcome]++;
      map[key].total++;
    }
    if (g.outcome === 'loss') stats.lossReasons[g.howText] = (stats.lossReasons[g.howText] || 0) + 1;
  }
  return stats;
}

export function overviewTips(games, analysed) {
  const st = overviewStats(games);
  const tips = [];
  if (!games.length) return tips;

  // Schwächste Eröffnung (mind. 3 Partien)
  const openings = Object.entries(st.byOpening).filter(([, v]) => v.total >= 3);
  openings.sort((a, b) => a[1].win / a[1].total - b[1].win / b[1].total || b[1].total - a[1].total);
  if (openings.length) {
    const [name, v] = openings[0];
    if (pct(v.win, v.total) < 45) {
      tips.push({ kind: 'tip', text: `Deine schwächste Eröffnung: <b>${name}</b> – nur ${pct(v.win, v.total)} % Siege in ${v.total} Partien. Hier lohnt es sich, die ersten 5–8 Züge und die typischen Pläne zu lernen.` });
    }
    const bestO = [...openings].sort((a, b) => b[1].win / b[1].total - a[1].win / a[1].total)[0];
    if (bestO && bestO[0] !== name && pct(bestO[1].win, bestO[1].total) >= 55) {
      tips.push({ kind: 'good', text: `Stark bist du mit <b>${bestO[0]}</b>: ${pct(bestO[1].win, bestO[1].total)} % Siege in ${bestO[1].total} Partien.` });
    }
  }

  const w = st.byColor.white, b = st.byColor.black;
  if (w && b && w.total >= 3 && b.total >= 3) {
    const dw = pct(w.win, w.total), db = pct(b.win, b.total);
    if (Math.abs(dw - db) >= 15) {
      tips.push({ kind: 'tip', text: `Mit ${dw > db ? 'Schwarz' : 'Weiß'} gewinnst du deutlich seltener (${Math.min(dw, db)} % gegenüber ${Math.max(dw, db)} %). Schau dir dein Repertoire mit dieser Farbe an.` });
    }
  }

  const timeouts = st.lossReasons['Zeit überschritten'] || 0;
  if (st.loss >= 4 && timeouts / st.loss >= 0.25) {
    tips.push({ kind: 'tip', text: `${pct(timeouts, st.loss)} % deiner Niederlagen kommen durch Zeitüberschreitung. Spiel einfache Stellungen schneller oder probiere eine längere Bedenkzeit bzw. Partien mit Inkrement (z. B. 10+5).` });
  }

  // Muster aus den mit Stockfish analysierten Partien
  if (analysed.length >= 2) {
    const agg = { errors: 0, blunders: 0, hung: 0, tp: 0, moves: 0, acc: 0, phase: { opening: 0, middlegame: 0, endgame: 0 }, phaseMoves: { opening: 0, middlegame: 0, endgame: 0 } };
    for (const { game, analysis } of analysed) {
      const s = summarise(analysis, game.color === 'white' ? 'w' : 'b', game.timeControl);
      agg.errors += s.errors.length;
      agg.blunders += s.blunders;
      agg.hung += s.hungPieces;
      agg.tp += s.timePressureErrors;
      agg.acc += s.accuracy;
      for (const p in agg.phase) {
        agg.phase[p] += s.byPhase[p];
        agg.phaseMoves[p] += s.movesByPhase[p];
      }
    }
    const n = analysed.length;
    tips.push({ kind: 'info', text: `In ${n} analysierten Partien: durchschnittliche Genauigkeit <b>${Math.round(agg.acc / n)} %</b>, ${(agg.blunders / n).toFixed(1)} Patzer pro Partie.` });
    // Fehlerrate je Phase (Fehler pro 10 Züge)
    const rates = Object.keys(agg.phase).filter((p) => agg.phaseMoves[p] >= 10).map((p) => [p, (agg.phase[p] / agg.phaseMoves[p]) * 10]);
    rates.sort((a, b) => b[1] - a[1]);
    if (rates.length >= 2 && rates[0][1] > 0) {
      tips.push({ kind: 'tip', text: `Die meisten Fehler pro Zug machst du im <b>${PHASE_NAME[rates[0][0]]}</b>. ${PHASE_ADVICE[rates[0][0]]}` });
    }
    if (agg.errors && agg.hung / agg.errors >= 0.3) {
      tips.push({ kind: 'tip', text: `Bei ${pct(agg.hung, agg.errors)} % deiner Fehler konnte der Gegner direkt eine Figur gewinnen. Das ist das wichtigste Trainingsfeld: Prüfe vor jedem Zug, ob alle deine Figuren gedeckt sind.` });
    }
    if (agg.errors && agg.tp / agg.errors >= 0.3) {
      tips.push({ kind: 'tip', text: `${pct(agg.tp, agg.errors)} % deiner Fehler passieren mit wenig Restzeit. Zeitmanagement ist bei dir ein großer Hebel.` });
    }
  } else {
    tips.push({ kind: 'info', text: 'Analysiere mindestens zwei Partien mit Stockfish, um auch Muster in deinen Fehlern zu sehen.' });
  }

  return tips;
}
