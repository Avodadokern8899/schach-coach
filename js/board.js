// Schachbrett: Anzeige und Variante zum Ziehen per Klick.
import { Chess } from '../lib/chess.js';
import { CLASS } from './analysis.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

// Zeichnet eine Stellung. opts: highlights, best, mark ({sq, cls}), selected, targets, good, bad
export function renderBoard(el, fen, flipped, opts = {}) {
  const { highlights = [], best = [], mark = null, selected = null, targets = [], good = [], bad = [] } = opts;
  const board = new Chess(fen).board();
  let html = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rr = flipped ? 7 - r : r;
      const ff = flipped ? 7 - f : f;
      const sq = FILES[ff] + (8 - rr);
      const piece = board[rr][ff];
      const cls = ['sq', (rr + ff) % 2 === 0 ? 'l' : 'd'];
      if (highlights.includes(sq)) cls.push('hl');
      if (best.includes(sq)) cls.push('best');
      if (sq === selected) cls.push('sel');
      if (targets.includes(sq)) cls.push(piece ? 'target capture' : 'target');
      if (good.includes(sq)) cls.push('good');
      if (bad.includes(sq)) cls.push('bad');
      let inner = piece ? `<span class="pc ${piece.color}">${GLYPH[piece.type]}&#xFE0E;</span>` : '';
      if (r === 7) inner += `<span class="coord f">${FILES[ff]}</span>`;
      if (f === 0) inner += `<span class="coord r">${8 - rr}</span>`;
      if (mark && mark.sq === sq) {
        const label = mark.cls === 'best' ? '★' : CLASS[mark.cls] ? CLASS[mark.cls].short : mark.cls === 'ok' ? '✓' : mark.cls === 'no' ? '✗' : '';
        if (label) inner += `<span class="mark bg-${mark.cls}">${label}</span>`;
      }
      html += `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
    }
  }
  el.innerHTML = html;
}

// Brett, auf dem man Züge per Klick (Figur, dann Zielfeld) ausführen kann.
export class PlayBoard {
  constructor(el, { flipped = false, onMove } = {}) {
    this.el = el;
    this.flipped = flipped;
    this.onMove = onMove;
    this.fen = new Chess().fen();
    this.locked = false;
    this.selected = null;
    this.extra = {};
    el.classList.add('playable');
    el.addEventListener('click', (e) => {
      const sqEl = e.target.closest('[data-sq]');
      if (sqEl) this._click(sqEl.dataset.sq);
    });
  }

  set(fen, extra = {}) {
    this.fen = fen;
    this.extra = extra;
    this.selected = null;
    this.draw();
  }

  lock(v = true) {
    this.locked = v;
    this.selected = null;
    this.draw();
  }

  draw() {
    const targets = this.selected ? this._legal(this.selected).map((m) => m.to) : [];
    renderBoard(this.el, this.fen, this.flipped, { ...this.extra, selected: this.selected, targets });
  }

  _legal(from) {
    return new Chess(this.fen).moves({ square: from, verbose: true });
  }

  _click(sq) {
    if (this.locked) return;
    const chess = new Chess(this.fen);
    if (this.selected) {
      const move = this._legal(this.selected).find((m) => m.to === sq);
      if (move) {
        // Umwandlung immer in eine Dame (reicht für fast alle Fälle)
        const played = chess.move({ from: move.from, to: move.to, promotion: move.promotion ? 'q' : undefined });
        this.selected = null;
        this.onMove && this.onMove({ from: played.from, to: played.to, san: played.san, uci: played.from + played.to + (played.promotion || ''), fenAfter: played.after });
        return;
      }
    }
    const piece = chess.get(sq);
    this.selected = piece && piece.color === chess.turn() && sq !== this.selected ? sq : null;
    this.draw();
  }
}
