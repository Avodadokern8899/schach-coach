// Theoriemodus: Eröffnungen aus den eigenen Partien mit der Eröffnungstheorie vergleichen und üben.
import { Chess } from '../lib/chess.js';
import { winPercent, formatEval } from './analysis.js';
import { PlayBoard } from './board.js';
import { $, escapeHtml, kpi, store, moveNo, getAnalysis } from './util.js';
import { CLASS } from './analysis.js';

const MAX_PLY = 24; // die ersten 12 Züge
const START_FEN = new Chess().fen();

let bookPromise = null;
export function loadBook() {
  if (!bookPromise) bookPromise = fetch('data/openings.json').then((r) => r.json());
  return bookPromise;
}
const posKey = (fen) => fen.split(' ').slice(0, 3).join(' ');

function bookEntry(book, fen) {
  const v = book[posKey(fen)];
  if (!v) return null;
  const i = v.indexOf('|');
  return { eco: v.slice(0, i), name: v.slice(i + 1) };
}

// Theoriezüge in einer Stellung: alle legalen Züge, deren Ergebnis im Eröffnungsbuch steht.
function bookMoves(book, fen) {
  const c = new Chess(fen);
  return c.moves({ verbose: true })
    .map((m) => ({ san: m.san, uci: m.from + m.to + (m.promotion || ''), entry: bookEntry(book, m.after), after: m.after }))
    .filter((m) => m.entry)
    .map((m) => ({ ...m, weight: new Chess(m.after).moves({ verbose: true }).filter((r) => bookEntry(book, r.after)).length }))
    // Wichtige Hauptzüge zuerst: je mehr Theorie danach folgt, desto bekannter der Zug
    .sort((a, b) => b.weight - a.weight);
}

const POINTS = { win: 1, draw: 0.5, loss: 0 };

// Baut einen Baum aus den ersten Zügen aller Partien einer Farbe.
function buildTree(games, book, color) {
  const nodes = new Map(); // posKey -> { fen, count, points, moves: Map(san -> {uci, count, points, key}) }
  const node = (fen) => {
    const k = posKey(fen);
    if (!nodes.has(k)) nodes.set(k, { fen, key: k, count: 0, points: 0, moves: new Map() });
    return nodes.get(k);
  };
  const gamesInfo = [];
  for (const g of games) {
    if (g.color !== color) continue;
    const c = new Chess();
    try { c.loadPgn(g.pgn); } catch { continue; }
    const hist = c.history({ verbose: true }).slice(0, MAX_PLY);
    const pts = POINTS[g.outcome];
    let lastBook = -1;
    let name = null;
    let cur = node(START_FEN);
    cur.count++;
    cur.points += pts;
    hist.forEach((m, i) => {
      const e = bookEntry(book, m.after);
      if (e && lastBook === i - 1) {
        lastBook = i;
        name = e;
      }
      const mv = cur.moves.get(m.san) || { san: m.san, uci: m.from + m.to + (m.promotion || ''), count: 0, points: 0, key: posKey(m.after) };
      mv.count++;
      mv.points += pts;
      cur.moves.set(m.san, mv);
      cur = node(m.after);
      cur.count++;
      cur.points += pts;
    });
    const deviation = hist[lastBook + 1];
    const analysis = getAnalysis(g);
    const devCls = deviation && analysis && analysis.moves[lastBook + 1] ? analysis.moves[lastBook + 1].cls : null;
    const myTurn = (ply) => (ply % 2 === 0) === (color === 'white');
    gamesInfo.push({
      game: g,
      name: name ? name.name : 'Ohne Theorie',
      family: name ? name.name.split(':')[0] : 'Ohne Theorie',
      eco: name ? name.eco : '',
      bookPlies: lastBook + 1,
      deviation: deviation ? { ply: lastBook + 1, san: deviation.san, byMe: myTurn(lastBook + 1), fenBefore: deviation.before, cls: devCls } : null,
    });
  }
  return { nodes, gamesInfo };
}

export async function renderTheory(ctx) {
  const { content, games, engine } = ctx;
  content.innerHTML = '<div class="welcome"><p>Lade Eröffnungsdatenbank …</p></div>';
  const book = await loadBook();
  const st = { color: store.get('sc-theory-color') || 'white', path: [], mode: 'explore' };

  content.innerHTML = `
    <div class="mode-view theory">
      <div class="game-head">
        <div>
          <h2>Theorie</h2>
          <div class="sub muted">Deine Eröffnungen im Vergleich mit der Eröffnungstheorie: wo du die Theorie verlässt und was dort gespielt wird.</div>
        </div>
        <div class="game-actions seg" role="group" aria-label="Farbe">
          <button data-color="white">Mit Weiß</button>
          <button data-color="black">Mit Schwarz</button>
        </div>
      </div>
      <div class="kpis th-kpis"></div>
      <div class="cards th-cards"></div>
      <h3 class="section-title">Eröffnungsbaum</h3>
      <div class="th-explorer"></div>
    </div>`;
  content.querySelectorAll('[data-color]').forEach((b) =>
    b.addEventListener('click', () => {
      st.color = b.dataset.color;
      store.set('sc-theory-color', st.color);
      st.path = [];
      draw();
    })
  );

  let tree;
  function draw() {
    content.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === st.color));
    tree = buildTree(games(), book, st.color);
    const info = tree.gamesInfo;
    if (!info.length) {
      $('.th-kpis').innerHTML = '';
      $('.th-cards').innerHTML = `<div class="card">Keine Partien mit ${st.color === 'white' ? 'Weiß' : 'Schwarz'} geladen.</div>`;
      $('.th-explorer').innerHTML = '';
      return;
    }
    const avgBook = info.reduce((s, x) => s + x.bookPlies, 0) / info.length / 2;
    const myDev = info.filter((x) => x.deviation && x.deviation.byMe).length;
    $('.th-kpis').innerHTML = [
      kpi(info.length, 'Partien'),
      kpi(avgBook.toFixed(1), 'Züge in der Theorie (Ø)'),
      kpi(Math.round((myDev / info.length) * 100) + ' %', 'Du verlässt die Theorie zuerst'),
    ].join('');
    renderRepertoire(info);
    renderExplorer();
  }

  function renderRepertoire(info) {
    // Eröffnungen nach Name gruppieren
    const groups = new Map();
    for (const x of info) {
      const g = groups.get(x.family) || { name: x.family, eco: x.eco, n: 0, pts: 0, book: 0 };
      g.n++;
      g.pts += POINTS[x.game.outcome];
      g.book += x.bookPlies;
      groups.set(x.family, g);
    }
    const rows = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 10);

    // Häufigste eigene Abweichungen von der Theorie
    const devs = new Map();
    for (const x of info) {
      if (!x.deviation || !x.deviation.byMe) continue;
      const k = posKey(x.deviation.fenBefore) + '|' + x.deviation.san;
      const d = devs.get(k) || { ...x.deviation, name: x.name, n: 0, pts: 0 };
      d.n++;
      d.pts += POINTS[x.game.outcome];
      if (x.deviation.cls) d.cls = x.deviation.cls;
      devs.set(k, d);
    }
    const devList = [...devs.values()].sort((a, b) => b.n - a.n).slice(0, 6);

    $('.th-cards').innerHTML = `
      <div class="card">
        <h3>Dein Repertoire</h3>
        <div class="table-scroll"><table class="table">
          <tr><th>Eröffnung</th><th class="n">Partien</th><th class="n">Punkte</th><th class="n">Ø Theorie</th></tr>
          ${rows.map((r) => `<tr><td><span class="eco">${r.eco}</span> ${escapeHtml(r.name)}</td><td class="n">${r.n}</td><td class="n">${Math.round((r.pts / r.n) * 100)} %</td><td class="n">${(r.book / r.n / 2).toFixed(1)} Züge</td></tr>`).join('')}
        </table></div>
      </div>
      <div class="card">
        <h3>Hier verlässt du die Theorie</h3>
        ${devList.length ? `<ul class="dev-list">${devList.map((d, i) => `
          <li>
            <div><b>${moveNo(d.ply)} ${d.san}</b> <span class="muted">in ${escapeHtml(d.name)}</span></div>
            <div class="muted">${d.n}× gespielt · ${Math.round((d.pts / d.n) * 100)} % Punkte ${devVerdict(d.cls)}</div>
            <button class="link" data-dev="${i}">Stellung ansehen</button>
          </li>`).join('')}</ul>` : '<p class="muted">Du bleibst in deinen Partien bis zum Ende der bekannten Theorie oder dein Gegner weicht zuerst ab.</p>'}
      </div>`;
    $('.th-cards').querySelectorAll('[data-dev]').forEach((b) =>
      b.addEventListener('click', () => {
        const d = devList[+b.dataset.dev];
        st.path = pathTo(d.fenBefore);
        renderExplorer();
        $('.th-explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
    );
  }

  function devVerdict(cls) {
    if (!cls) return '';
    if (cls === 'best' || cls === 'good') return '· <span class="pill ok">Stockfish: guter Zug</span>';
    return `· <span class="pill off">Stockfish: ${CLASS[cls].label}</span>`;
  }

  // Zugfolge (SAN) bis zu einer Stellung über den Baum finden
  function pathTo(fen) {
    const target = posKey(fen);
    const search = (key, path) => {
      if (key === target) return path;
      if (path.length >= MAX_PLY) return null;
      const n = tree.nodes.get(key);
      if (!n) return null;
      for (const mv of n.moves.values()) {
        const r = search(mv.key, [...path, mv.san]);
        if (r) return r;
      }
      return null;
    };
    return search(posKey(START_FEN), []) || [];
  }

  function currentFen() {
    const c = new Chess();
    for (const san of st.path) c.move(san);
    return c.fen();
  }

  let board;
  let evalToken = 0;
  function renderExplorer() {
    const el = $('.th-explorer');
    if (!el.querySelector('.board')) {
      el.innerHTML = `
        <div class="game-grid">
          <div class="board-col">
            <div class="board-wrap"><div class="turn-ind"></div><div class="board"></div></div>
            <div class="nav">
              <button id="th-back" title="Zug zurück">◀ Zurück</button>
              <button id="th-reset" title="Zur Grundstellung">⏮ Anfang</button>
              <button id="th-drill" class="primary">Eröffnung üben</button>
            </div>
            <div class="move-info th-info"></div>
          </div>
          <div class="info-col">
            <div class="card th-node"></div>
          </div>
        </div>`;
      board = new PlayBoard($('.board', el), { flipped: st.color === 'black', onMove: (mv) => onBoardMove(mv) });
      $('#th-back').addEventListener('click', () => { st.path.pop(); if (st.mode === 'drill') stopDrill(); renderExplorer(); });
      $('#th-reset').addEventListener('click', () => { st.path = []; if (st.mode === 'drill') stopDrill(); renderExplorer(); });
      $('#th-drill').addEventListener('click', () => (st.mode === 'drill' ? stopDrill() : startDrill()));
    }
    board.flipped = st.color === 'black';
    const fen = currentFen();
    const c = new Chess(fen);
    const last = st.path.length ? new Chess(prevFen()).move(st.path[st.path.length - 1]) : null;
    board.set(fen, { highlights: last ? [last.from, last.to] : [] });
    board.lock(st.mode === 'drill' && !isMyTurn(fen));
    $('.turn-ind', el).className = 'turn-ind ' + c.turn();
    if (st.mode === 'drill') return;

    const entry = lastBookEntry();
    const node = tree.nodes.get(posKey(fen));
    const mine = isMyTurn(fen);
    const bm = bookMoves(book, fen);
    const myMoves = node ? [...node.moves.values()].sort((a, b) => b.count - a.count) : [];
    const bookSans = new Set(bm.map((m) => m.san));

    $('.th-info').innerHTML = `
      <div><b>${st.path.length ? formatPath(st.path) : 'Grundstellung'}</b></div>
      <div class="muted">${entry ? `<span class="eco">${entry.eco}</span> ${escapeHtml(entry.name)}` : ''}${node ? ` · ${node.count} deiner Partien` : ' · noch nie in deinen Partien'}</div>`;

    $('.th-node').innerHTML = `
      <h3>${mine ? 'Du bist am Zug' : 'Dein Gegner ist am Zug'}</h3>
      <div class="engine-line muted">Stockfish rechnet …</div>
      <h4>${mine ? 'Das hast du hier gespielt' : 'Das haben deine Gegner hier gespielt'}</h4>
      ${myMoves.length ? `<table class="table moves-table">
        <tr><th>Zug</th><th class="n">Partien</th><th class="n">Punkte</th><th>Theorie</th></tr>
        ${myMoves.map((m) => `<tr data-san="${escapeHtml(m.san)}" class="clickable"><td><b>${m.san}</b></td><td class="n">${m.count}</td><td class="n">${Math.round((m.points / m.count) * 100)} %</td><td>${bookSans.has(m.san) ? '<span class="pill ok">Theorie</span>' : '<span class="pill off">abseits</span>'}</td></tr>`).join('')}
      </table>` : '<p class="muted">Diese Stellung kam in deinen Partien nicht vor.</p>'}
      <h4>Theoriezüge in dieser Stellung</h4>
      ${bm.length ? `<ul class="book-list">${bm.slice(0, 8).map((m) => `<li data-san="${escapeHtml(m.san)}" class="clickable"><b>${m.san}</b> <span class="muted">${m.entry.eco} ${escapeHtml(m.entry.name)}</span></li>`).join('')}</ul>` : '<p class="muted">Hier endet die Eröffnungstheorie in der Datenbank. Ab jetzt zählen Pläne statt auswendig gelernter Züge.</p>'}
      <p class="muted small">Tipp: Du kannst auch direkt auf dem Brett ziehen.</p>`;
    $('.th-node').querySelectorAll('[data-san]').forEach((r) => r.addEventListener('click', () => { st.path.push(r.dataset.san); renderExplorer(); }));

    // Stockfish-Empfehlung für diese Stellung
    const token = ++evalToken;
    if (c.isGameOver()) { $('.engine-line').textContent = ''; return; }
    engine().analyse(fen, 14).then((ev) => {
      if (token !== evalToken || !ev.best) return;
      const san = new Chess(fen).move({ from: ev.best.slice(0, 2), to: ev.best.slice(2, 4), promotion: ev.best[4] }).san;
      const line = $('.engine-line');
      if (line) line.innerHTML = `Stockfish empfiehlt <b>${san}</b> (Bewertung ${formatEval(ev)}).`;
    });
  }

  function prevFen() {
    const c = new Chess();
    for (const san of st.path.slice(0, -1)) c.move(san);
    return c.fen();
  }
  function lastBookEntry() {
    const c = new Chess();
    let e = null;
    for (const san of st.path) {
      c.move(san);
      e = bookEntry(book, c.fen()) || e;
    }
    return e;
  }
  function isMyTurn(fen) {
    return (fen.split(' ')[1] === 'w') === (st.color === 'white');
  }
  function formatPath(path) {
    return path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');
  }

  function onBoardMove(mv) {
    if (st.mode === 'drill') return drillMove(mv);
    st.path.push(mv.san);
    renderExplorer();
  }

  // ---------- Üben: Die App spielt die Züge deiner Gegner, du antwortest ----------
  const drill = { score: 0, total: 0, busy: false };

  function startDrill() {
    st.mode = 'drill';
    st.path = [];
    drill.score = 0;
    drill.total = 0;
    $('#th-drill').textContent = 'Üben beenden';
    $('.th-node').innerHTML = `<h3>Eröffnung üben</h3>
      <p>Die App spielt die Züge, die deine Gegner gegen dich gespielt haben, am häufigsten zuerst. Du antwortest mit dem besten Zug. Gut ist ein Theoriezug oder ein Zug, den Stockfish für gleichwertig hält.</p>
      <div class="drill-score"></div>`;
    renderExplorer();
    drillStep();
  }

  function stopDrill() {
    st.mode = 'explore';
    $('#th-drill').textContent = 'Eröffnung üben';
    renderExplorer();
  }

  function setInfo(html, kind = '') {
    const i = $('.th-info');
    i.className = 'move-info th-info ' + kind;
    i.innerHTML = html;
  }

  function updateScore() {
    const el = $('.drill-score');
    if (el) el.innerHTML = kpi(`${drill.score} / ${drill.total}`, 'richtige Antworten');
  }

  function drillStep() {
    if (st.mode !== 'drill') return;
    updateScore();
    const fen = currentFen();
    if (st.path.length >= MAX_PLY) return finishDrill('Du hast die ersten 12 Züge geschafft.');
    if (isMyTurn(fen)) {
      board.lock(false);
      setInfo(`Du bist am Zug. ${lastBookEntry() ? `<span class="muted">${escapeHtml(lastBookEntry().name)}</span>` : ''}`);
      return;
    }
    // Gegnerzug aus deinen Partien, gewichtet nach Häufigkeit
    const node = tree.nodes.get(posKey(fen));
    const options = node ? [...node.moves.values()] : [];
    if (!options.length) return finishDrill('Ab hier gibt es keine Partien von dir mehr.');
    const total = options.reduce((s, m) => s + m.count, 0);
    let r = Math.random() * total;
    const pick = options.find((m) => (r -= m.count) < 0) || options[0];
    board.lock();
    setTimeout(() => {
      st.path.push(pick.san);
      renderExplorer();
      drillStep();
    }, 500);
  }

  async function drillMove(mv) {
    if (drill.busy) return;
    drill.busy = true;
    const fen = currentFen();
    board.set(mv.fenAfter, { highlights: [mv.from, mv.to] });
    board.lock();
    setInfo('Prüfe deinen Zug …');
    const inBook = !!bookEntry(book, mv.fenAfter);
    const [before, after] = await Promise.all([engine().analyse(fen, 12), engine().analyse(mv.fenAfter, 12)]);
    const sideW = fen.split(' ')[1] === 'w';
    const wpBefore = sideW ? winPercent(before) : 100 - winPercent(before);
    const wpAfter = sideW ? winPercent(after) : 100 - winPercent(after);
    const drop = wpBefore - wpAfter;
    const bestSan = before.best ? new Chess(fen).move({ from: before.best.slice(0, 2), to: before.best.slice(2, 4), promotion: before.best[4] }).san : null;
    const ok = mv.uci === before.best || drop < (inBook ? 5 : 4);
    drill.total++;
    drill.busy = false;
    if (ok) {
      drill.score++;
      const praise = inBook ? 'Theoriezug!' : 'Guter Zug (nicht in der Theorie, aber Stockfish ist zufrieden).';
      setInfo(`<b>✓ ${mv.san}</b> – ${praise}`, 'right');
      st.path.push(mv.san);
      renderExplorer();
      setTimeout(drillStep, 700);
    } else {
      const books = bookMoves(book, fen).map((m) => m.san);
      setInfo(`<b>✗ ${mv.san}</b> ist schwächer (Bewertung ${formatEval(after)}). Besser: <b>${bestSan}</b>${books.length ? `. Theorie: ${books.slice(0, 4).join(', ')}` : ''}. <button class="link" id="drill-go">Mit ${bestSan} weiter</button>`, 'wrong');
      board.set(fen);
      board.lock(false);
      $('#drill-go').addEventListener('click', () => {
        st.path.push(bestSan);
        renderExplorer();
        drillStep();
      });
    }
    updateScore();
  }

  function finishDrill(reason) {
    board.lock();
    setInfo(`${reason} Ergebnis: <b>${drill.score} von ${drill.total}</b> richtig. <button class="link" id="drill-again">Nochmal</button>`, drill.score === drill.total ? 'right' : '');
    $('#drill-again').addEventListener('click', startDrill);
  }

  draw();
}
