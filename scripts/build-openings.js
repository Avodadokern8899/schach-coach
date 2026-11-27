// Erzeugt data/openings.json aus der ECO-Datei des npm-Pakets "chess-openings" (Lizenz: WTFPL).
// Die Datei wird nur als Text gelesen, nicht ausgeführt.
// Aufruf: node scripts/build-openings.js <pfad/zu/eco.js>
// Schlüssel: Stellung (Brett, Zugrecht, Rochaderechte), Wert: "ECO|Name".
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(process.argv[2], 'utf8');
const re = /'([^']+)':\s*\{\s*eco:\s*'([^']+)',\s*name:\s*(['"])((?:\\.|(?!\3).)*)\3/g;
const out = {};
let m;
while ((m = re.exec(src))) {
  const key = m[1].split(' ').slice(0, 3).join(' ');
  out[key] = m[2] + '|' + m[4].replace(/\\(.)/g, '$1');
}
fs.writeFileSync(path.join(__dirname, '..', 'data', 'openings.json'), JSON.stringify(out));
console.log(Object.keys(out).length, 'Stellungen geschrieben');
