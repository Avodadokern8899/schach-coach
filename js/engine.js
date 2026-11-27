// Kleiner Wrapper um Stockfish (läuft als Web Worker im Browser).

export class Engine {
  constructor(url = 'engine/stockfish-nnue-16-single.js') {
    this.worker = new Worker(url);
    this.listeners = new Set();
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    this._queue = Promise.resolve();
    this.ready = this._init();
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  _waitFor(predicate) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async _init() {
    const uciok = this._waitFor((l) => l === 'uciok');
    this.send('uci');
    await uciok;
    this.send('setoption name Hash value 32');
    const ready = this._waitFor((l) => l === 'readyok');
    this.send('isready');
    await ready;
  }

  // Bewertet eine Stellung. Ergebnis immer aus Sicht von Weiß.
  // Aufrufe werden nacheinander abgearbeitet (die Engine kann nur eine Stellung gleichzeitig rechnen).
  analyse(fen, depth = 12) {
    const run = this._queue.then(() => this._analyse(fen, depth));
    this._queue = run.catch(() => {});
    return run;
  }

  async _analyse(fen, depth) {
    await this.ready;
    const whiteToMove = fen.split(' ')[1] === 'w';
    let last = null;
    const collect = (line) => {
      if (line.startsWith('info') && line.includes(' score ') && !line.includes('lowerbound') && !line.includes('upperbound')) {
        const m = line.match(/score (cp|mate) (-?\d+)/);
        const pv = line.match(/ pv (.+)$/);
        if (m) last = { type: m[1], value: parseInt(m[2], 10), pv: pv ? pv[1].split(' ') : [] };
      }
    };
    this.listeners.add(collect);
    const done = this._waitFor((l) => l.startsWith('bestmove'));
    this.send('position fen ' + fen);
    this.send('go depth ' + depth);
    const bm = await done;
    this.listeners.delete(collect);

    const best = bm.split(' ')[1];
    const sign = whiteToMove ? 1 : -1;
    if (!last) return { cp: 0, mate: null, best: null, pv: [] };
    if (last.type === 'mate') {
      return { cp: null, mate: sign * last.value, best: best === '(none)' ? null : best, pv: last.pv };
    }
    return { cp: sign * last.value, mate: null, best: best === '(none)' ? null : best, pv: last.pv };
  }

  newGame() {
    this.send('ucinewgame');
  }

  stop() {
    this.send('stop');
  }
}
