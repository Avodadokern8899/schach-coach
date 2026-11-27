import { Chess } from '../lib/chess.js';
import { Engine } from './engine.js';
import { fetchRecentGames } from './chesscom.js';
import { analyseGame, summarise, CLASS, formatEval, winPercent } from './analysis.js';
import { gameTips, overviewStats, overviewTips } from './tips.js';

const $ = (sel, root = document) => root.querySelector(sel);
const content = $('#content');

const state = {
  username: '',
  games: [],
  filter: '',
  current: null, // { game, analysis, ply, view }
  engine: null,
  busy: false,
};

// ---------- Speicher (nur Bequemlichkeit, App funktioniert auch ohne) ----------
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* voll oder gesperrt */ }
  },
};
const analysisKey = (id) => 'sc-analysis:' + id;
const getAnalysis = (game) => store.get(analysisKey(game.id));

function engine() {
  if (!state.engine) state.engine = new Engine();
  return state.engine;
}

// ---------- Laden ----------
$('#load-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#username').value.trim();
  if (!name) return;
  await loadGames(name, +$('#months').value);
});

$('#filter-class').addEventListener('change', (e) => {
  state.filter = e.target.value;
  renderList();
  if (!state.current) renderOverview();
});
$('#show-overview').addEventListener('click', () => renderOverview());

async function loadGames(name, months) {
  state.username = name;
  store.set('sc-username', name);
  content.innerHTML = '<div class="welcome"><p>Lade Partien von chess.com …</p></div>';
  try {
    state.games = await fetchRecentGames(name, months);
  } catch (err) {
    content.innerHTML = `<div class="error-box"><b>Konnte Partien nicht laden.</b><br>${escapeHtml(err.message || String(err))}</div>`;
    return;
  }
  if (!state.games.length) {
    content.innerHTML = '<div class="welcome"><p>Keine Partien in diesem Zeitraum gefunden.</p></div>';
  } else {
    renderOverview();
  }
  renderList();
}

function visibleGames() {
  return state.filter ? state.games.filter((g) => g.timeClass === state.filter) : state.games;
}

// ---------- Partienliste ----------
const TIME_CLASS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Schnellschach', daily: 'Täglich' };

function renderList() {
  const list = $('#game-list');
  const games = visibleGames();
  $('#game-count').textContent = state.games.length ? `${games.length} Partien` : '';
  list.innerHTML = '';
  for (const g of games) {
    const li = document.createElement('li');
    li.dataset.id = g.id;
    if (state.current && state.current.game.id === g.id) li.classList.add('active');
    const a = getAnalysis(g);
    const acc = a ? Math.round(summarise(a, g.color === 'white' ? 'w' : 'b', g.timeControl).accuracy) : null;
    li.innerHTML = `
      <span class="dot ${g.outcome}"></span>
      <div class="gl-main">
        <div class="gl-opp">${g.color === 'white' ? '⚪' : '⚫'} ${escapeHtml(g.opp.name)} <span class="muted">(${g.opp.rating})</span></div>
        <div class="gl-sub">${fmtDate(g.endTime)} · ${TIME_CLASS[g.timeClass] || g.timeClass} · ${escapeHtml(g.opening)}</div>
      </div>
      ${acc !== null ? `<span class="gl-acc" title="Deine Genauigkeit">${acc}%</span>` : '<span></span>'}`;
    li.addEventListener('click', () => openGame(g));
    list.appendChild(li);
  }
}

// ---------- Übersicht ----------
function renderOverview() {
  state.current = null;
  document.querySelectorAll('.game-list li.active').forEach((li) => li.classList.remove('active'));
  const games = visibleGames();
  if (!games.length) return;
  const node = $('#tpl-overview').content.cloneNode(true);
  const st = overviewStats(games);
  const pct = (a) => Math.round((a / st.total) * 100);
  const ratings = games.filter((g) => g.rated).map((g) => g.me.rating);
  $('.kpis', node).innerHTML = [
    kpi(st.total, 'Partien'),
    kpi(pct(st.win) + ' %', 'Siege'),
    kpi(pct(st.draw) + ' %', 'Remis'),
    kpi(pct(st.loss) + ' %', 'Niederlagen'),
    ratings.length ? kpi(ratings[0], 'Aktuelle Wertung') : '',
  ].join('');

  const analysed = games.map((g) => ({ game: g, analysis: getAnalysis(g) })).filter((x) => x.analysis);
  $('.overview-tips', node).innerHTML = renderTips(overviewTips(games, analysed));

  const openings = Object.entries(st.byOpening).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  $('.openings', node).innerHTML =
    '<tr><th>Eröffnung</th><th class="n">Partien</th><th class="n">Siege</th><th></th></tr>' +
    openings.map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td class="n">${v.total}</td><td class="n">${Math.round((v.win / v.total) * 100)} %</td><td>${wdl(v)}</td></tr>`).join('');

  const reasons = Object.entries(st.lossReasons).sort((a, b) => b[1] - a[1]);
  const maxR = reasons.length ? reasons[0][1] : 1;
  $('.loss-reasons', node).innerHTML = reasons.length
    ? reasons.map(([r, n]) => `<li><span>${escapeHtml(r)}</span><span class="b" style="width:${(n / maxR) * 100}%"></span><span>${n}</span></li>`).join('')
    : '<li class="muted">Keine Niederlagen – weiter so!</li>';

  const btn = $('.batch-btn', node);
  const status = $('.batch-status', node);
  btn.addEventListener('click', () => batchAnalyse(btn, status));

  content.innerHTML = '';
  content.appendChild(node);
}

async function batchAnalyse(btn, status) {
  if (state.busy) return;
  const todo = visibleGames().filter((g) => !getAnalysis(g) && g.timeClass !== 'daily').slice(0, 5);
  if (!todo.length) {
    status.textContent = 'Die letzten Partien sind schon analysiert.';
    return;
  }
  state.busy = true;
  btn.disabled = true;
  try {
    for (let i = 0; i < todo.length; i++) {
      const a = await analyseGame(todo[i], engine(), {
        depth: 10,
        onProgress: (p) => (status.textContent = `Partie ${i + 1} von ${todo.length}: ${Math.round(p * 100)} %`),
      });
      store.set(analysisKey(todo[i].id), a);
      renderList();
    }
  } finally {
    state.busy = false;
  }
  if (!state.current) renderOverview();
}

// ---------- Partieansicht ----------
function openGame(game) {
  const analysis = getAnalysis(game);
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const history = chess.history({ verbose: true });
  state.current = { game, analysis, history, ply: -1 };

  document.querySelectorAll('.game-list li').forEach((li) => li.classList.toggle('active', li.dataset.id === game.id));
  const node = $('#tpl-game').content.cloneNode(true);
  const resultWord = { win: 'Sieg', draw: 'Remis', loss: 'Niederlage' }[game.outcome];
  $('.title', node).textContent = `${resultWord} gegen ${game.opp.name} (${game.opp.rating})`;
  $('.sub', node).innerHTML = `${fmtDate(game.endTime)} · ${TIME_CLASS[game.timeClass] || game.timeClass} · du spielst ${game.color === 'white' ? 'Weiß' : 'Schwarz'} · ${escapeHtml(game.opening)} · ${escapeHtml(game.howText)} · <a href="${game.url}" target="_blank" rel="noopener">auf chess.com öffnen</a>`;

  $('.analyse-btn', node).addEventListener('click', () => runAnalysis());
  node.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));

  content.innerHTML = '';
  content.appendChild(node);
  if (analysis) $('.analyse-btn').textContent = 'Neu analysieren';
  renderGamePanels();
  goTo(history.length - 1);
  window.scrollTo({ top: 0 });
}

async function runAnalysis() {
  if (state.busy) return;
  const cur = state.current;
  const btn = $('.analyse-btn');
  const prog = $('.progress');
  state.busy = true;
  btn.disabled = true;
  prog.classList.remove('hidden');
  try {
    const a = await analyseGame(cur.game, engine(), {
      depth: +$('.depth').value,
      onProgress: (p) => {
        $('.bar', prog).style.width = p * 100 + '%';
        $('span', prog).textContent = `Stockfish analysiert … ${Math.round(p * 100)} %`;
      },
    });
    store.set(analysisKey(cur.game.id), a);
    if (state.current === cur) {
      cur.analysis = a;
      renderGamePanels();
      goTo(cur.ply);
    }
    renderList();
  } catch (err) {
    console.error(err);
    alert('Analyse fehlgeschlagen: ' + err.message);
  } finally {
    state.busy = false;
    btn.disabled = false;
    btn.textContent = 'Neu analysieren';
    prog.classList.add('hidden');
  }
}

function renderGamePanels() {
  const { game, analysis, history } = state.current;
  const myColor = game.color === 'white' ? 'w' : 'b';

  if (analysis) {
    const { summary: s, tips } = gameTips(game, analysis);
    $('.summary').innerHTML = [
      kpi(Math.round(s.accuracy) + ' %', 'Genauigkeit'),
      kpi(s.best, 'Beste Züge', 'c-best'),
      kpi(s.inaccuracies, 'Ungenauigkeiten', 'c-inaccuracy'),
      kpi(s.mistakes, 'Fehler', 'c-mistake'),
      kpi(s.blunders, 'Patzer', 'c-blunder'),
    ].join('');
    $('.game-tips').innerHTML = renderTips(tips);
    $('.game-tips').querySelectorAll('[data-ply]').forEach((li) => li.addEventListener('click', () => goTo(+li.dataset.ply)));
    renderGraph(analysis);
  } else {
    $('.summary').innerHTML = '';
    $('.graph').classList.add('hidden');
    $('.game-tips').innerHTML = '<li class="info">Klicke auf <b>„Mit Stockfish analysieren“</b>, um jeden Zug bewerten zu lassen. Das dauert je nach Länge der Partie etwa eine Minute.</li>';
  }

  // Zugliste
  const moves = $('.moves');
  moves.innerHTML = '';
  for (let i = 0; i < history.length; i += 2) {
    const no = document.createElement('div');
    no.className = 'no';
    no.textContent = i / 2 + 1 + '.';
    moves.appendChild(no);
    for (const j of [i, i + 1]) {
      const cell = document.createElement('div');
      if (j < history.length) {
        const am = analysis && analysis.moves[j];
        const cls = am ? am.cls : null;
        const mine = history[j].color === myColor;
        cell.className = 'mv' + (cls && cls !== 'good' && cls !== 'best' ? ' c-' + cls : '');
        cell.dataset.ply = j;
        cell.innerHTML = `<span>${history[j].san}</span>${cls && cls !== 'best' && CLASS[cls].short ? `<span class="tag" title="${CLASS[cls].label}">${CLASS[cls].short}</span>` : ''}`;
        if (!mine) cell.style.opacity = analysis ? '0.75' : '1';
        cell.addEventListener('click', () => goTo(j));
      }
      moves.appendChild(cell);
    }
  }
}

function renderGraph(analysis) {
  const g = $('.graph');
  g.classList.remove('hidden');
  const n = analysis.evals.length;
  const W = 600, H = 110;
  const x = (i) => (i / Math.max(1, n - 1)) * W;
  const y = (ev) => H - (winPercent(ev) / 100) * H;
  let d = `M0,${H} `;
  analysis.evals.forEach((ev, i) => (d += `L${x(i).toFixed(1)},${y(ev).toFixed(1)} `));
  d += `L${W},${H} Z`;
  const dots = analysis.moves
    .filter((m) => m.cls === 'blunder' || m.cls === 'mistake')
    .map((m) => `<circle cx="${x(m.ply + 1)}" cy="${y(analysis.evals[m.ply + 1])}" r="4" class="${m.cls}" fill="var(--${m.cls})" />`)
    .join('');
  g.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Bewertungsverlauf">
    <rect width="${W}" height="${H}" fill="#403d39" />
    <path d="${d}" fill="#f5f5f5" />
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#999" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke" />
    <line class="cursor" x1="0" x2="0" y1="0" y2="${H}" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" />
    ${dots}
  </svg>`;
  const svg = $('svg', g);
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    goTo(i - 1);
  });
}

function navigate(dir) {
  const cur = state.current;
  if (!cur) return;
  const last = cur.history.length - 1;
  const isError = (m) => m.color === (cur.game.color === 'white' ? 'w' : 'b') && (m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'inaccuracy');
  switch (dir) {
    case 'start': return goTo(-1);
    case 'prev': return goTo(Math.max(-1, cur.ply - 1));
    case 'next': return goTo(Math.min(last, cur.ply + 1));
    case 'end': return goTo(last);
    case 'next-error': {
      if (!cur.analysis) return;
      const m = cur.analysis.moves.find((m) => m.ply > cur.ply && isError(m));
      if (m) goTo(m.ply);
      return;
    }
    case 'prev-error': {
      if (!cur.analysis) return;
      const m = [...cur.analysis.moves].reverse().find((m) => m.ply < cur.ply && isError(m));
      if (m) goTo(m.ply);
      return;
    }
  }
}

document.addEventListener('keydown', (e) => {
  if (!state.current || e.target.matches('input, select')) return;
  if (e.key === 'ArrowLeft') navigate('prev');
  else if (e.key === 'ArrowRight') navigate('next');
  else if (e.key === 'ArrowUp') navigate('start');
  else if (e.key === 'ArrowDown') navigate('end');
  else return;
  e.preventDefault();
});

function goTo(ply) {
  const cur = state.current;
  cur.ply = ply;
  const { history, analysis, game } = cur;
  const fen = ply < 0 ? (history[0] ? history[0].before : new Chess().fen()) : history[ply].after;
  const mv = ply >= 0 ? history[ply] : null;
  const am = analysis && ply >= 0 ? analysis.moves[ply] : null;
  const flipped = game.color === 'black';

  const highlights = mv ? [mv.from, mv.to] : [];
  const best = am && am.bestUci && am.cls !== 'best' && am.cls !== 'good' ? [am.bestUci.slice(0, 2), am.bestUci.slice(2, 4)] : [];
  renderBoard($('.board'), fen, flipped, highlights, best, am);

  // Bewertungsbalken
  const ev = analysis ? analysis.evals[ply + 1] : null;
  const bar = $('.evalbar');
  bar.classList.toggle('flipped', flipped);
  if (ev) {
    const wp = winPercent(ev);
    $('.evalfill').style.height = wp + '%';
    $('.evaltext').textContent = formatEval(ev).replace('+', '');
    bar.classList.toggle('black-better', wp < 50);
  } else {
    $('.evalfill').style.height = '50%';
    $('.evaltext').textContent = '';
  }

  // Zuginfo
  const info = $('.move-info');
  if (!mv) info.innerHTML = '<span class="muted">Ausgangsstellung</span>';
  else if (!am) info.innerHTML = `<b>${mv.color === 'w' ? Math.floor(ply / 2) + 1 + '.' : Math.floor(ply / 2) + 1 + '…'} ${mv.san}</b>`;
  else info.innerHTML = describeMove(am, game);

  document.querySelectorAll('.moves .mv').forEach((c) => c.classList.toggle('cur', +c.dataset.ply === ply));
  const curCell = $('.moves .mv.cur');
  if (curCell) curCell.scrollIntoView({ block: 'nearest' });
  const cursor = $('.graph .cursor');
  if (cursor && analysis) {
    const xPos = ((ply + 1) / Math.max(1, analysis.evals.length - 1)) * 600;
    cursor.setAttribute('x1', xPos);
    cursor.setAttribute('x2', xPos);
  }
}

function describeMove(am, game) {
  const label = `${am.moveNumber}${am.color === 'w' ? '.' : '…'} ${am.san}`;
  const mine = am.color === (game.color === 'white' ? 'w' : 'b');
  const who = mine ? 'Dein Zug' : 'Zug des Gegners';
  let html = `<div><b>${label}</b> · <span class="muted">${who}</span> · <span class="cls ${am.cls !== 'good' ? 'c-' + am.cls : ''}">${CLASS[am.cls].label}</span> · Bewertung ${formatEval(am.evalAfter)}</div>`;
  if (am.bestSan && am.cls !== 'good') {
    html += `<div>Besser war <b>${am.bestSan}</b> (grün markiert)${am.bestLine.length > 1 ? `, z. B. <span class="muted">${am.bestLine.join(' ')}</span>` : ''}.</div>`;
  }
  if (am.refutation && am.refutation.san) {
    html += am.refutation.san.endsWith('#') ? `<div>Gefahr: Der Gegner setzt mit <b>${am.refutation.san}</b> matt.</div>` : `<div>Gefahr: Der Gegner kann mit <b>${am.refutation.san}</b> antworten${am.refutation.captures ? ` (schlägt ${am.refutation.captures})` : ''}.</div>`;
  }
  if (am.clock !== null) html += `<div class="muted">Restzeit: ${fmtClock(am.clock)}</div>`;
  return html;
}

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function renderBoard(el, fen, flipped, highlights, best, am) {
  const c = new Chess(fen);
  const board = c.board();
  const files = 'abcdefgh';
  let html = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rr = flipped ? 7 - r : r;
      const ff = flipped ? 7 - f : f;
      const sqName = files[ff] + (8 - rr);
      const piece = board[rr][ff];
      const light = (rr + ff) % 2 === 0;
      const cls = ['sq', light ? 'l' : 'd'];
      if (highlights.includes(sqName)) cls.push('hl');
      if (best.includes(sqName)) cls.push('best');
      let inner = piece ? `<span class="pc ${piece.color}">${GLYPH[piece.type]}&#xFE0E;</span>` : '';
      if (r === 7) inner += `<span class="coord f">${files[ff]}</span>`;
      if (f === 0) inner += `<span class="coord r">${8 - rr}</span>`;
      if (am && sqName === am.to && CLASS[am.cls].short && am.cls !== 'best') inner += `<span class="mark bg-${am.cls}">${CLASS[am.cls].short}</span>`;
      if (am && sqName === am.to && am.cls === 'best') inner += `<span class="mark bg-best">★</span>`;
      html += `<div class="${cls.join(' ')}">${inner}</div>`;
    }
  }
  el.innerHTML = html;
}

// ---------- Helfer ----------
function kpi(v, l, cls = '') {
  return `<div class="kpi"><div class="v ${cls}">${v}</div><div class="l">${l}</div></div>`;
}
function wdl(v) {
  const p = (n) => (n / v.total) * 100 + '%';
  return `<div class="wdl"><span style="width:${p(v.win)}"></span><span style="width:${p(v.draw)}"></span><span style="width:${p(v.loss)}"></span></div>`;
}
function renderTips(tips) {
  return tips.map((t) => `<li class="${t.kind}"${t.ply !== undefined ? ` data-ply="${t.ply}"` : ''}>${t.text}</li>`).join('');
}
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtClock(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Zuletzt benutzten Namen vorausfüllen
const params = new URLSearchParams(location.search);
const initial = params.get('user') || store.get('sc-username') || 'test1231987';
$('#username').value = initial;
if (params.get('user')) loadGames(initial, +$('#months').value);
