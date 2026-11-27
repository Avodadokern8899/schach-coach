// Trainingsmodus: Aufgaben aus den eigenen Fehlern.
import { Chess } from '../lib/chess.js';
import { winPercent, formatEval, PHASE_NAME, CLASS } from './analysis.js';
import { PlayBoard } from './board.js';
import { $, escapeHtml, fmtDate, kpi, store, getAnalysis, moveNo } from './util.js';

const PROGRESS_KEY = 'sc-puzzles';

export function buildPuzzles(games) {
  const puzzles = [];
  for (const game of games) {
    const analysis = getAnalysis(game);
    if (!analysis) continue;
    const me = game.color === 'white' ? 'w' : 'b';
    for (const m of analysis.moves) {
      if (m.color !== me || !m.bestUci) continue;
      if (m.cls !== 'mistake' && m.cls !== 'blunder') continue;
      puzzles.push({ id: game.id + ':' + m.ply, game, m });
    }
  }
  return puzzles;
}

function loadProgress() {
  return store.get(PROGRESS_KEY) || {};
}

export function renderTraining(ctx) {
  const { content, games, engine, onAnalyse } = ctx;
  const all = buildPuzzles(games());
  const progress = loadProgress();
  const st = { filter: store.get('sc-puzzle-filter') || 'open', index: 0, puzzle: null, tries: 0, solved: false, hintLevel: 0 };

  content.innerHTML = `
    <div class="mode-view training">
      <div class="game-head">
        <div>
          <h2>Training</h2>
          <div class="sub muted">Aufgaben aus deinen eigenen Fehlern: Finde den Zug, den du in der Partie übersehen hast.</div>
        </div>
        <div class="game-actions">
          <select id="puzzle-filter" title="Welche Aufgaben?">
            <option value="open">Noch nicht gelöst</option>
            <option value="all">Alle Aufgaben</option>
            <option value="blunder">Nur Patzer</option>
          </select>
        </div>
      </div>
      <div class="kpis train-kpis"></div>
      <div class="train-body"></div>
    </div>`;
  const filterSel = $('#puzzle-filter');
  filterSel.value = st.filter;
  filterSel.addEventListener('change', () => {
    st.filter = filterSel.value;
    store.set('sc-puzzle-filter', st.filter);
    st.index = 0;
    start();
  });

  function list() {
    let l = all;
    if (st.filter === 'open') l = l.filter((p) => !(progress[p.id] && progress[p.id].solved));
    if (st.filter === 'blunder') l = l.filter((p) => p.m.cls === 'blunder');
    return l;
  }

  function renderKpis() {
    const solved = all.filter((p) => progress[p.id] && progress[p.id].solved).length;
    const firstTry = all.filter((p) => progress[p.id] && progress[p.id].firstTry).length;
    $('.train-kpis').innerHTML = [
      kpi(all.length, 'Aufgaben'),
      kpi(solved, 'Gelöst', 'c-best'),
      kpi(all.length - solved, 'Offen'),
      kpi(solved ? Math.round((firstTry / solved) * 100) + ' %' : '–', 'Beim ersten Versuch'),
    ].join('');
  }

  function start() {
    renderKpis();
    const body = $('.train-body');
    const l = list();
    if (!all.length) {
      body.innerHTML = `<div class="card empty-state">
        <h3>Noch keine Aufgaben</h3>
        <p>Aufgaben entstehen aus deinen Fehlern und Patzern in analysierten Partien. Lass ein paar Partien von Stockfish prüfen, dann geht es los.</p>
        <div class="batch"><button class="primary" id="train-analyse">Letzte 5 Partien analysieren</button><span class="muted" id="train-status"></span></div>
      </div>`;
      $('#train-analyse').addEventListener('click', (e) => onAnalyse(e.target, $('#train-status')));
      return;
    }
    if (!l.length) {
      body.innerHTML = `<div class="card empty-state"><h3>Alles gelöst!</h3><p>Du hast alle Aufgaben in dieser Auswahl gelöst. Analysiere weitere Partien für neue Aufgaben oder wiederhole sie unter „Alle Aufgaben“.</p>
        <div class="batch"><button class="primary" id="train-analyse">Weitere 5 Partien analysieren</button><span class="muted" id="train-status"></span></div></div>`;
      $('#train-analyse').addEventListener('click', (e) => onAnalyse(e.target, $('#train-status')));
      return;
    }
    if (st.index >= l.length) st.index = 0;
    showPuzzle(l[st.index]);
  }

  let board;
  function showPuzzle(p) {
    st.puzzle = p;
    st.tries = 0;
    st.solved = false;
    st.hintLevel = 0;
    const { game, m } = p;
    const side = m.color === 'w' ? 'Weiß' : 'Schwarz';
    const body = $('.train-body');
    body.innerHTML = `
      <div class="game-grid">
        <div class="board-col">
          <div class="board-wrap">
            <div class="turn-ind ${m.color}" title="${side} ist am Zug"></div>
            <div class="board"></div>
          </div>
          <div class="nav">
            <button id="pz-hint">Tipp</button>
            <button id="pz-solution">Lösung zeigen</button>
            <button id="pz-next" class="primary">Nächste Aufgabe ▶</button>
          </div>
          <div class="move-info pz-feedback"></div>
        </div>
        <div class="info-col">
          <div class="card task">
            <div class="task-title">${side} am Zug – finde den besten Zug</div>
            <div class="muted">Aufgabe ${st.index + 1} von ${list().length} · ${PHASE_NAME[m.phase]} · ${CLASS[m.cls].label} in der Partie</div>
          </div>
          <div class="card">
            <h3>Aus deiner Partie</h3>
            <p>${fmtDate(game.endTime)} gegen <b>${escapeHtml(game.opp.name)}</b> (${game.opp.rating}) · ${escapeHtml(game.opening)}</p>
            <p class="pz-context muted">Was du in der Partie gespielt hast, siehst du nach der Lösung.</p>
            <button class="link" id="pz-open">Ganze Partie ansehen</button>
          </div>
        </div>
      </div>`;
    board = new PlayBoard($('.board', body), { flipped: game.color === 'black', onMove: (mv) => check(mv) });
    board.set(m.fenBefore);
    setFeedback('Klicke eine Figur an und dann das Zielfeld.', '');
    $('#pz-hint').addEventListener('click', hint);
    $('#pz-solution').addEventListener('click', () => reveal(false));
    $('#pz-next').addEventListener('click', next);
    $('#pz-open').addEventListener('click', () => ctx.openGame(game, m.ply));
  }

  function setFeedback(html, kind) {
    const fb = $('.pz-feedback');
    fb.className = 'move-info pz-feedback ' + (kind || '');
    fb.innerHTML = html;
  }

  function hint() {
    const { m } = st.puzzle;
    if (st.solved) return;
    st.hintLevel++;
    const from = m.bestUci.slice(0, 2);
    const piece = new Chess(m.fenBefore).get(from);
    const names = { p: 'einem Bauern', n: 'einem Springer', b: 'einem Läufer', r: 'einem Turm', q: 'der Dame', k: 'dem König' };
    if (st.hintLevel === 1) {
      const thema = m.bestSan.includes('#') ? 'Es gibt ein Matt!' : m.bestSan.includes('x') ? 'Der beste Zug schlägt etwas.' : m.bestSan.includes('+') ? 'Der beste Zug gibt Schach.' : 'Achte auf die Drohungen des Gegners.';
      setFeedback(`💡 ${thema} Ziehe mit ${names[piece.type]}.`, 'hint');
    } else {
      board.set(m.fenBefore, { best: [from] });
      setFeedback(`💡 Die Figur auf <b>${from}</b> muss ziehen.`, 'hint');
    }
  }

  async function check(mv) {
    const { m } = st.puzzle;
    st.tries++;
    board.set(mv.fenAfter, { highlights: [mv.from, mv.to] });
    board.lock();
    let ok = mv.uci === m.bestUci;
    let note = '';
    if (!ok) {
      const after = new Chess(mv.fenAfter);
      if (after.isCheckmate()) ok = true;
      else {
        setFeedback('Stockfish prüft deinen Zug …', '');
        const ev = await engine().analyse(mv.fenAfter, 12);
        const wp = m.color === 'w' ? winPercent(ev) : 100 - winPercent(ev);
        // Gleichwertige Alternativen zählen auch, wenn sie klar besser sind als der Partiezug
        ok = m.wpBefore - wp < 6 && wp > m.wpAfter + 10;
        note = ` Bewertung nach deinem Zug: ${formatEval(ev)}.`;
        if (ok) note = ` Stockfish hatte ${m.bestSan} vorgeschlagen, dein Zug ist aber genauso gut.`;
      }
    }
    if (ok) {
      solve(true, mv, note);
    } else {
      board.set(mv.fenAfter, { highlights: [mv.from], mark: { sq: mv.to, cls: 'no' }, bad: [mv.to] });
      setFeedback(`<b>${mv.san}</b> ist nicht der beste Zug.${note} Versuch es noch einmal.`, 'wrong');
      setTimeout(() => {
        if (st.puzzle && !st.solved) {
          board.set(m.fenBefore);
          board.lock(false);
        }
      }, 1200);
    }
  }

  function solve(byUser, mv, note = '') {
    const { m, id } = st.puzzle;
    st.solved = true;
    const p = progress[id] || {};
    if (byUser) {
      p.solved = true;
      if (st.tries === 1 && st.hintLevel === 0 && p.firstTry === undefined) p.firstTry = true;
    } else if (p.firstTry === undefined) p.firstTry = false;
    p.last = Date.now();
    progress[id] = p;
    store.set(PROGRESS_KEY, progress);
    renderKpis();
    reveal(byUser, mv, note);
  }

  function reveal(byUser, mv, note = '') {
    const { m } = st.puzzle;
    if (!st.solved) {
      // Lösung angesehen: zählt nicht als gelöst
      solve(false);
      return;
    }
    const best = { from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4) };
    const shown = mv || best;
    const fenShown = mv ? mv.fenAfter : new Chess(m.fenBefore).move({ from: best.from, to: best.to, promotion: m.bestUci[4] }).after;
    board.set(fenShown, { highlights: [shown.from, shown.to], good: [shown.to], mark: { sq: shown.to, cls: 'ok' } });
    board.lock();
    // Fortsetzung nur zeigen, wenn sie zum gezeigten Zug passt
    const exact = !mv || mv.uci === m.bestUci;
    const line = exact && m.bestLine.length > 1 ? `<div class="muted">Mögliche Fortsetzung: ${m.bestLine.join(' ')}</div>` : '';
    if (byUser) {
      setFeedback(`<b>Richtig!</b>${mv ? ' ' + mv.san : ''}${note}${line}`, 'right');
    } else {
      setFeedback(`Die Lösung ist <b>${m.bestSan}</b>.${line}`, 'hint');
    }
    let ctxText = `In der Partie hast du <b>${moveNo(m.ply)} ${m.san}</b> gespielt (Bewertung ${formatEval(m.evalBefore)} → ${formatEval(m.evalAfter)}).`;
    if (m.refutation && m.refutation.san) {
      ctxText += m.refutation.san.endsWith('#')
        ? ` Danach konnte dein Gegner mit ${m.refutation.san} matt setzen.`
        : ` Danach war ${m.refutation.san} stark${m.refutation.captures ? ` (schlägt ${m.refutation.captures})` : ''}.`;
    }
    $('.pz-context').innerHTML = ctxText;
    $('.pz-context').classList.remove('muted');
  }

  function next() {
    const l = list();
    // Bei Filter "offen" fällt die gelöste Aufgabe aus der Liste, der Index zeigt dann schon auf die nächste.
    if (!(st.filter === 'open' && st.solved && progress[st.puzzle.id] && progress[st.puzzle.id].solved)) st.index++;
    if (st.index >= l.length) st.index = 0;
    start();
  }

  start();
}
