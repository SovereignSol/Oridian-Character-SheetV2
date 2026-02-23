# Development Notes

## File structure
- `index.html`: Main app shell and tabs.
- `battle.html`: Battle tracker UI.
- `js/app.js`: Main UI logic and state management.
- `js/engine/`: Rules engines (5e 2014), spell engines, etc.
- `data/`: JSON datasets (classes, feats, spells, spellcasting progression).

## Local hosting
Service workers require HTTP(S). For local testing:

- `python -m http.server 8000`
- Open `http://localhost:8000/`
