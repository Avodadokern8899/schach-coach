# Schach-Coach

Web-App, die deine Partien von chess.com lädt, sie mit Stockfish im Browser bewertet und dir Tipps für dein Spiel gibt.

## Funktionen
- Partien der letzten 1–6 Monate über die öffentliche chess.com-API laden (kein Login nötig)
- Übersicht: Sieg-/Remis-/Niederlagenquote, Eröffnungsstatistik, wie du Partien verlierst
- Analyse einer Partie mit Stockfish 16 (läuft komplett im Browser): Genauigkeit, Ungenauigkeiten, Fehler, Patzer, bester Zug, Bewertungsverlauf
- Tipps pro Partie und Muster über mehrere analysierte Partien (Spielphase, Zeitnot, eingestellte Figuren, schwache Eröffnungen)

## Starten
Die App braucht einen kleinen Webserver (wegen Stockfish als WebAssembly), ein Doppelklick auf `index.html` reicht nicht.

- **Online:** Ordner auf GitHub hochladen und GitHub Pages aktivieren.
- **Lokal:** im Ordner `python3 -m http.server 8000` ausführen und http://localhost:8000 öffnen.

Mit `?user=NAME` in der Adresse werden die Partien direkt geladen.

## Aufbau
- `index.html`, `css/style.css` – Oberfläche
- `js/app.js` – Bedienung, Brett, Zugliste
- `js/chesscom.js` – Laden der Partien von chess.com
- `js/engine.js` – Stockfish-Anbindung (Web Worker)
- `js/analysis.js` – Zugbewertung (Gewinnwahrscheinlichkeit, Einstufung, Genauigkeit)
- `js/tips.js` – Tipps und Statistiken
- `lib/chess.js` – Schachregeln (chess.js, BSD-Lizenz)
- `engine/` – Stockfish 16 (GPLv3)
