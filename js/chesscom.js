// Partien über die öffentliche chess.com-API laden (kein Login nötig).

const API = 'https://api.chess.com/pub/player/';

export async function fetchArchives(username) {
  const res = await fetch(API + encodeURIComponent(username.toLowerCase()) + '/games/archives');
  if (res.status === 404) throw new Error(`Spieler „${username}“ wurde auf chess.com nicht gefunden.`);
  if (!res.ok) throw new Error(`chess.com antwortet mit Fehler ${res.status}.`);
  const data = await res.json();
  return data.archives || [];
}

// Lädt die Partien der letzten `months` Monate (neueste zuerst).
export async function fetchRecentGames(username, months = 2) {
  const archives = await fetchArchives(username);
  const recent = archives.slice(-months).reverse();
  const games = [];
  for (const url of recent) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    games.push(...(data.games || []));
  }
  const me = username.toLowerCase();
  return games
    .filter((g) => g.rules === 'chess' && g.pgn)
    .map((g) => normalizeGame(g, me))
    .sort((a, b) => b.endTime - a.endTime);
}

const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

const RESULT_TEXT = {
  win: 'Sieg',
  checkmated: 'schachmatt gesetzt',
  resigned: 'aufgegeben',
  timeout: 'Zeit überschritten',
  abandoned: 'Partie verlassen',
  agreed: 'Remis vereinbart',
  repetition: 'Remis durch Wiederholung',
  stalemate: 'Patt',
  insufficient: 'Remis (zu wenig Material)',
  '50move': 'Remis (50-Züge-Regel)',
  timevsinsufficient: 'Remis (Zeit vs. zu wenig Material)',
};

function normalizeGame(g, me) {
  const color = g.white.username.toLowerCase() === me ? 'white' : 'black';
  const mine = g[color];
  const opp = g[color === 'white' ? 'black' : 'white'];
  let outcome = 'loss';
  if (mine.result === 'win') outcome = 'win';
  else if (DRAW_RESULTS.has(mine.result)) outcome = 'draw';

  // Wie endete die Partie? (Bei Niederlage zählt mein Ergebnis, bei Sieg das des Gegners.)
  const how = outcome === 'win' ? opp.result : mine.result;

  return {
    id: g.uuid || g.url,
    url: g.url,
    pgn: g.pgn,
    endTime: g.end_time * 1000,
    timeClass: g.time_class, // bullet, blitz, rapid, daily
    timeControl: g.time_control,
    rated: g.rated,
    color,
    me: { name: mine.username, rating: mine.rating },
    opp: { name: opp.username, rating: opp.rating },
    outcome,
    how,
    howText: RESULT_TEXT[how] || how,
    opening: openingFromGame(g),
  };
}

function openingFromGame(g) {
  const url = g.eco || (g.pgn.match(/\[ECOUrl "([^"]+)"\]/) || [])[1];
  if (!url) return 'Unbekannte Eröffnung';
  const slug = url.split('/openings/')[1] || '';
  // Zugfolgen am Ende abschneiden (z. B. "...-3.Nc3-Nf6")
  const name = slug.replace(/-\d+\..*$/, '').replace(/-/g, ' ').trim();
  return name || 'Unbekannte Eröffnung';
}

// Kurzer Eröffnungsname für Statistiken (erste 2–3 Wörter, z. B. "Sicilian Defense").
export function openingFamily(name) {
  const words = name.split(' ');
  const stop = words.findIndex((w, i) => i >= 1 && /^(Defense|Game|Opening|Gambit|Attack|System)$/.test(w));
  return stop >= 0 ? words.slice(0, stop + 1).join(' ') : words.slice(0, 3).join(' ');
}
