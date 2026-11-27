// Kleine Helfer, die von mehreren Ansichten genutzt werden.

export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function kpi(v, l, cls = '') {
  return `<div class="kpi"><div class="v ${cls}">${v}</div><div class="l">${l}</div></div>`;
}

// Speicher im Browser (nur Bequemlichkeit, App funktioniert auch ohne)
export const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* voll oder gesperrt */ }
  },
};

export const analysisKey = (id) => 'sc-analysis:' + id;
export const getAnalysis = (game) => store.get(analysisKey(game.id));

// Zugnummer im üblichen Format: "12." für Weiß, "12…" für Schwarz (ply ab 0)
export function moveNo(ply) {
  return Math.floor(ply / 2) + 1 + (ply % 2 === 0 ? '.' : '…');
}
